from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from agentguard_sdk import (
    AgentGuardClient,
    PendingApprovalError,
    PolicyDeniedError,
    ResolveApprovalInput,
    guarded_exec_command,
    guarded_fetch,
    guarded_read_file,
    guarded_write_file,
)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    client = AgentGuardClient(
        base_url=args.base_url,
        agent=args.agent,
    )

    try:
        if args.command == "read-file":
            result = guarded_read_file(
                client,
                args.path,
                encoding=args.encoding,
                wait_for_approval_ms=args.wait_for_approval_ms,
            )
            payload = result.value
            if isinstance(payload, bytes):
                print(payload.decode(args.encoding or "utf-8"))
            else:
                print(payload)
            print_audit(record_to_json(result.audit_record), stream=sys.stderr)
            return 0

        if args.command == "write-file":
            data: str | bytes = (
                args.data.encode(args.encoding) if args.binary else args.data
            )
            result = guarded_write_file(
                client,
                args.path,
                data,
                encoding=args.encoding,
                wait_for_approval_ms=args.wait_for_approval_ms,
            )
            print("write complete")
            print_audit(record_to_json(result.audit_record), stream=sys.stderr)
            return 0

        if args.command == "fetch":
            request_data = args.data.encode("utf-8") if args.data is not None else None
            result = guarded_fetch(
                client,
                args.url,
                method=args.method,
                data=request_data,
                wait_for_approval_ms=args.wait_for_approval_ms,
            )
            response = result.value
            body = response.read().decode("utf-8")
            response.close()
            print(body)
            print_audit(record_to_json(result.audit_record), stream=sys.stderr)
            return 0

        if args.command == "exec":
            result = guarded_exec_command(
                client,
                args.shell_command,
                wait_for_approval_ms=args.wait_for_approval_ms,
            )
            if result.value.stdout:
                print(result.value.stdout, end="")
            if result.value.stderr:
                print(result.value.stderr, end="", file=sys.stderr)
            print_audit(record_to_json(result.audit_record), stream=sys.stderr)
            return int(result.value.returncode)

        if args.command == "list-audit":
            print(
                json.dumps(
                    [record_to_json(record) for record in client.list_audit(args.limit)],
                    indent=2,
                )
            )
            return 0

        if args.command == "list-approvals":
            print(
                json.dumps(
                    [
                        approval_to_json(approval)
                        for approval in client.list_approvals(
                            limit=args.limit,
                            status=args.status,
                        )
                    ],
                    indent=2,
                )
            )
            return 0

        if args.command == "resolve-approval":
            approval = client.resolve_approval_request(
                args.approval_id,
                ResolveApprovalInput(
                    action=args.action,
                    decided_by=args.decided_by,
                    reason=args.reason,
                ),
            )
            print(json.dumps(approval_to_json(approval), indent=2))
            return 0

        parser.error(f"unknown command: {args.command}")
        return 1
    except PendingApprovalError as error:
        print(
            json.dumps(
                {
                    "error": "approval_pending",
                    "reason": error.outcome.audit_record.decision.reason,
                    "approval_request_id": error.outcome.approval_request.id
                    if error.outcome.approval_request is not None
                    else None,
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        return 2
    except PolicyDeniedError as error:
        print(
            json.dumps(
                {
                    "error": "policy_denied",
                    "reason": error.record.decision.reason,
                    "decision": error.record.decision.action,
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        return 3


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Minimal CLI agent that routes tool calls through AgentGuard.",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="AgentGuard daemon base URL. Defaults to AGENTGUARD_DAEMON_URL or http://127.0.0.1:8790.",
    )
    parser.add_argument(
        "--agent",
        default="agentguard-python-cli",
        help="Agent identity name reported to the daemon.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    read_file = subparsers.add_parser("read-file", help="Read a file through AgentGuard.")
    read_file.add_argument("path")
    read_file.add_argument("--encoding", default="utf-8")
    add_wait_argument(read_file)

    write_file = subparsers.add_parser("write-file", help="Write a file through AgentGuard.")
    write_file.add_argument("path")
    write_file.add_argument("data")
    write_file.add_argument("--encoding", default="utf-8")
    write_file.add_argument(
        "--binary",
        action="store_true",
        help="Treat the positional data argument as text to encode before writing bytes.",
    )
    add_wait_argument(write_file)

    fetch = subparsers.add_parser("fetch", help="Make an HTTP request through AgentGuard.")
    fetch.add_argument("url")
    fetch.add_argument("--method", default="GET")
    fetch.add_argument("--data", default=None)
    add_wait_argument(fetch)

    exec_command = subparsers.add_parser("exec", help="Run a shell command through AgentGuard.")
    exec_command.add_argument("shell_command")
    add_wait_argument(exec_command)

    list_audit = subparsers.add_parser("list-audit", help="Show recent audit records.")
    list_audit.add_argument("--limit", type=int, default=25)

    list_approvals = subparsers.add_parser(
        "list-approvals",
        help="Show daemon approval requests.",
    )
    list_approvals.add_argument("--limit", type=int, default=25)
    list_approvals.add_argument("--status", choices=["all", "pending"], default="all")

    resolve_approval = subparsers.add_parser(
        "resolve-approval",
        help="Resolve a pending approval request.",
    )
    resolve_approval.add_argument("approval_id", type=int)
    resolve_approval.add_argument("action", choices=["allow", "warn", "block", "kill"])
    resolve_approval.add_argument("--decided-by", default="agentguard-python-cli")
    resolve_approval.add_argument("--reason", default=None)

    return parser


def add_wait_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--wait-for-approval-ms",
        type=int,
        default=30_000,
        help="How long to wait for operator approval before returning approval_pending.",
    )


def record_to_json(record: Any) -> dict[str, Any]:
    return {
        "id": record.id,
        "recorded_at_unix_ms": record.recorded_at_unix_ms,
        "layer": record.event.layer,
        "operation": record.event.operation,
        "target": record.event.target.to_dict(),
        "agent": record.event.agent.to_dict(),
        "decision": record.decision.to_dict(),
        "metadata": record.event.metadata,
    }


def approval_to_json(approval: Any) -> dict[str, Any]:
    return {
        "id": approval.id,
        "status": approval.status,
        "created_at_unix_ms": approval.created_at_unix_ms,
        "resolved_at_unix_ms": approval.resolved_at_unix_ms,
        "decided_by": approval.decided_by,
        "resolution_note": approval.resolution_note,
        "audit_record": record_to_json(approval.audit_record),
    }


def print_audit(payload: dict[str, Any], *, stream: Any) -> None:
    print(json.dumps({"audit_record": payload}, indent=2), file=stream)


if __name__ == "__main__":
    raise SystemExit(main())
