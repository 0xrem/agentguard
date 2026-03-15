from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from .client import AgentGuardClient, infer_runtime_agent_identity
from .errors import AgentGuardHttpError
from .types import GuardedResult
from .wrappers import (
    DEFAULT_WAIT_FOR_APPROVAL_MS,
    guarded_exec_command,
    guarded_fetch,
    guarded_read_file,
    guarded_write_file,
)

DEFAULT_PROXY_BASE_URL = "http://127.0.0.1:8787"
DEFAULT_MODEL = "gpt-5"
SYSTEM_PROMPT = """You are a local coding agent.
Return strict JSON only.

When you need a tool, respond with:
{"type":"tool_call","tool":"read_file|write_file|fetch|exec_command","arguments":{...},"reason":"short reason"}

When the task is complete, respond with:
{"type":"final","output":"final answer"}
"""


@dataclass(slots=True)
class ToolCall:
    tool: str
    arguments: dict[str, Any]
    reason: str


def run_agent(
    task: str,
    *,
    model: str = DEFAULT_MODEL,
    proxy_base_url: Optional[str] = None,
    daemon_base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    agent_name: str = "agentguard-python-openai-agent",
    max_steps: int = 6,
    approval_wait_ms: int = DEFAULT_WAIT_FOR_APPROVAL_MS,
) -> str:
    client = AgentGuardClient(base_url=daemon_base_url, agent=agent_name)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": task},
    ]

    for _ in range(max_steps):
        response_content = chat_completion(
            base_url=proxy_base_url or os.environ.get("AGENTGUARD_PROXY_URL") or DEFAULT_PROXY_BASE_URL,
            model=model,
            messages=messages,
            agent_name=agent_name,
            api_key=api_key or os.environ.get("OPENAI_API_KEY"),
        )
        agent_step = parse_agent_step(response_content)

        if agent_step["type"] == "final":
            output = agent_step.get("output")
            if not isinstance(output, str):
                raise ValueError("final agent response must include a string output")
            return output

        tool_call = ToolCall(
            tool=agent_step["tool"],
            arguments=dict(agent_step.get("arguments", {})),
            reason=str(agent_step.get("reason", "")),
        )
        tool_result = execute_tool_call(
            client,
            tool_call,
            approval_wait_ms=approval_wait_ms,
        )
        messages.append({"role": "assistant", "content": response_content})
        messages.append(
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "type": "tool_result",
                        "tool": tool_call.tool,
                        "reason": tool_call.reason,
                        "result": tool_result,
                    }
                ),
            }
        )

    raise RuntimeError(f"agent did not finish after {max_steps} steps")


def chat_completion(
    *,
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    agent_name: str,
    api_key: Optional[str] = None,
    timeout: float = 30.0,
) -> str:
    headers = build_proxy_headers(agent_name)
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/v1/chat/completions",
        data=json.dumps(
            {
                "model": model,
                "messages": messages,
                "stream": False,
            }
        ).encode("utf-8"),
        method="POST",
        headers=headers,
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        raise build_upstream_http_error(error.code, body) from error

    content = (
        payload.get("choices", [{}])[0]
        .get("message", {})
        .get("content")
    )
    if not isinstance(content, str):
        raise ValueError("chat completion did not return string content")

    return content


def parse_agent_step(content: str) -> dict[str, Any]:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as error:
        raise ValueError(f"agent response was not valid JSON: {content}") from error

    if not isinstance(payload, dict):
        raise ValueError("agent response must be a JSON object")
    step_type = payload.get("type")
    if step_type not in {"tool_call", "final"}:
        raise ValueError(f"unsupported agent step type: {step_type}")

    return payload


def build_upstream_http_error(status_code: int, body_text: str) -> Exception:
    try:
        details = json.loads(body_text)
    except json.JSONDecodeError:
        return RuntimeError(f"chat completion request failed with {status_code}: {body_text}")

    error = details.get("error") if isinstance(details, dict) else None
    message = error.get("message") if isinstance(error, dict) else None
    if isinstance(message, str):
        return AgentGuardHttpError(message=message, status=status_code, details=details)

    return RuntimeError(f"chat completion request failed with {status_code}: {body_text}")


def execute_tool_call(
    client: AgentGuardClient,
    tool_call: ToolCall,
    *,
    approval_wait_ms: int,
) -> dict[str, Any]:
    if tool_call.tool == "read_file":
        result = guarded_read_file(
            client,
            tool_call.arguments["path"],
            encoding=tool_call.arguments.get("encoding", "utf-8"),
            wait_for_approval_ms=approval_wait_ms,
        )
        return format_tool_result(result)

    if tool_call.tool == "write_file":
        result = guarded_write_file(
            client,
            tool_call.arguments["path"],
            tool_call.arguments["content"],
            encoding=tool_call.arguments.get("encoding", "utf-8"),
            wait_for_approval_ms=approval_wait_ms,
        )
        return format_tool_result(result)

    if tool_call.tool == "fetch":
        data = tool_call.arguments.get("data")
        result = guarded_fetch(
            client,
            tool_call.arguments["url"],
            method=tool_call.arguments.get("method", "GET"),
            data=data.encode("utf-8") if isinstance(data, str) else data,
            wait_for_approval_ms=approval_wait_ms,
        )
        try:
            body = result.value.read().decode("utf-8")
        finally:
            result.value.close()
        return format_tool_result(result, body=body)

    if tool_call.tool == "exec_command":
        result = guarded_exec_command(
            client,
            tool_call.arguments["command"],
            wait_for_approval_ms=approval_wait_ms,
        )
        return format_tool_result(
            result,
            returncode=result.value.returncode,
            stdout=result.value.stdout,
            stderr=result.value.stderr,
        )

    raise ValueError(f"unsupported tool: {tool_call.tool}")


def format_tool_result(result: GuardedResult[Any], **extra: Any) -> dict[str, Any]:
    payload = {
        "audit": {
            "action": result.audit_record.decision.action,
            "risk": result.audit_record.decision.risk,
            "reason": result.audit_record.decision.reason,
            "operation": result.audit_record.event.operation,
            "target": result.audit_record.event.target.to_dict(),
        }
    }
    if result.value is not None and not extra:
        payload["value"] = normalize_value(result.value)
    payload.update(extra)
    return payload


def normalize_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, Path):
        return str(value)
    return value


def build_proxy_headers(agent_name: str) -> dict[str, str]:
    runtime_agent = infer_runtime_agent_identity(agent_name)
    return {
        "content-type": "application/json",
        "x-agentguard-agent-name": runtime_agent.name,
        "x-agentguard-agent-pid": str(runtime_agent.process_id or ""),
        "x-agentguard-agent-ppid": str(runtime_agent.parent_process_id or ""),
        "x-agentguard-agent-executable": runtime_agent.executable_path or "",
        "x-agentguard-agent-cwd": os.getcwd(),
        "x-agentguard-agent-script": str(Path(sys.argv[0]).expanduser().resolve()),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a minimal OpenAI-compatible Python agent through AgentGuard.",
    )
    parser.add_argument("task", help="The user task the agent should solve.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--proxy-base-url", default=None)
    parser.add_argument("--daemon-base-url", default=None)
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--agent-name", default="agentguard-python-openai-agent")
    parser.add_argument("--max-steps", type=int, default=6)
    parser.add_argument("--wait-for-approval-ms", type=int, default=DEFAULT_WAIT_FOR_APPROVAL_MS)
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    output = run_agent(
        args.task,
        model=args.model,
        proxy_base_url=args.proxy_base_url,
        daemon_base_url=args.daemon_base_url,
        api_key=args.api_key,
        agent_name=args.agent_name,
        max_steps=args.max_steps,
        approval_wait_ms=args.wait_for_approval_ms,
    )
    print(output)
    return 0


__all__ = [
    "ToolCall",
    "chat_completion",
    "execute_tool_call",
    "main",
    "parse_agent_step",
    "run_agent",
]
