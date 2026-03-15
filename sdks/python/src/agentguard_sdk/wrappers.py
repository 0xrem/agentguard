from __future__ import annotations

import sys
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

from .client import (
    AgentGuardClient,
    command_target,
    domain_target,
    path_target,
    with_metadata,
)
from .types import AgentLike, GuardEventInput, GuardedResult, RiskLevel

DEFAULT_WAIT_FOR_APPROVAL_MS = 30_000
UrlOpenLike = Callable[..., Any]


def guarded_read_file(
    client: AgentGuardClient,
    file_path: str | Path,
    *,
    encoding: Optional[str] = None,
    agent: Optional[AgentLike] = None,
    metadata: Optional[Mapping[str, str]] = None,
    risk_hint: Optional[RiskLevel] = None,
    wait_for_approval_ms: int = DEFAULT_WAIT_FOR_APPROVAL_MS,
) -> GuardedResult[str | bytes]:
    resolved_path = str(Path(file_path).expanduser().resolve())
    audit_record = client.guard_event(
        GuardEventInput(
            layer="tool",
            operation="read_file",
            target=path_target(resolved_path),
            risk_hint=risk_hint,
            agent=agent,
            wait_for_approval_ms=wait_for_approval_ms,
            metadata=with_metadata(
                metadata,
                {
                    "requested_path": resolved_path,
                    "encoding": encoding,
                    "cwd": str(Path.cwd()),
                    "script_path": str(Path(sys.argv[0]).expanduser().resolve()),
                },
            ),
        )
    )

    path = Path(resolved_path)
    value = path.read_text(encoding=encoding) if encoding else path.read_bytes()
    return GuardedResult(audit_record=audit_record, value=value)


def guarded_write_file(
    client: AgentGuardClient,
    file_path: str | Path,
    data: str | bytes,
    *,
    encoding: str = "utf-8",
    agent: Optional[AgentLike] = None,
    metadata: Optional[Mapping[str, str]] = None,
    risk_hint: Optional[RiskLevel] = None,
    wait_for_approval_ms: int = DEFAULT_WAIT_FOR_APPROVAL_MS,
) -> GuardedResult[None]:
    resolved_path = str(Path(file_path).expanduser().resolve())
    audit_record = client.guard_event(
        GuardEventInput(
            layer="tool",
            operation="write_file",
            target=path_target(resolved_path),
            risk_hint=risk_hint,
            agent=agent,
            wait_for_approval_ms=wait_for_approval_ms,
            metadata=with_metadata(
                metadata,
                {
                    "requested_path": resolved_path,
                    "encoding": encoding if isinstance(data, str) else None,
                    "byte_length": str(len(data.encode(encoding) if isinstance(data, str) else data)),
                    "cwd": str(Path.cwd()),
                    "script_path": str(Path(sys.argv[0]).expanduser().resolve()),
                },
            ),
        )
    )

    path = Path(resolved_path)
    if isinstance(data, str):
        path.write_text(data, encoding=encoding)
    else:
        path.write_bytes(data)

    return GuardedResult(audit_record=audit_record, value=None)


def guarded_fetch(
    client: AgentGuardClient,
    url_or_request: str | urllib.request.Request,
    *,
    method: Optional[str] = None,
    data: Optional[bytes] = None,
    headers: Optional[Mapping[str, str]] = None,
    timeout: Optional[float] = None,
    opener: Optional[UrlOpenLike] = None,
    agent: Optional[AgentLike] = None,
    metadata: Optional[Mapping[str, str]] = None,
    risk_hint: Optional[RiskLevel] = None,
    wait_for_approval_ms: int = DEFAULT_WAIT_FOR_APPROVAL_MS,
) -> GuardedResult[Any]:
    request = _normalize_request(
        url_or_request,
        method=method,
        data=data,
        headers=headers,
    )
    parsed_url = urllib.parse.urlparse(request.full_url)
    request_method = request.get_method().upper()
    network_direction = "download" if request_method in {"GET", "HEAD"} else "upload"

    audit_record = client.guard_event(
        GuardEventInput(
            layer="tool",
            operation="http_request",
            target=domain_target(parsed_url.netloc or parsed_url.path),
            risk_hint=risk_hint,
            agent=agent,
            wait_for_approval_ms=wait_for_approval_ms,
            metadata=with_metadata(
                metadata,
                {
                    "method": request_method,
                    "url": request.full_url,
                    "network_direction": network_direction,
                    "cwd": str(Path.cwd()),
                    "script_path": str(Path(sys.argv[0]).expanduser().resolve()),
                },
            ),
        )
    )

    response = (opener or urllib.request.urlopen)(request, timeout=timeout or client.timeout)
    return GuardedResult(audit_record=audit_record, value=response)


def guarded_exec_command(
    client: AgentGuardClient,
    command: str,
    *,
    cwd: Optional[str | Path] = None,
    env: Optional[Mapping[str, str]] = None,
    shell: bool = True,
    executable: Optional[str] = None,
    timeout: Optional[float] = None,
    agent: Optional[AgentLike] = None,
    metadata: Optional[Mapping[str, str]] = None,
    risk_hint: Optional[RiskLevel] = None,
    wait_for_approval_ms: int = DEFAULT_WAIT_FOR_APPROVAL_MS,
) -> GuardedResult[subprocess.CompletedProcess[str]]:
    resolved_cwd = str(Path(cwd).expanduser().resolve()) if cwd else str(Path.cwd())
    audit_record = client.guard_event(
        GuardEventInput(
            layer="command",
            operation="exec_command",
            target=command_target(command),
            risk_hint=risk_hint,
            agent=agent,
            wait_for_approval_ms=wait_for_approval_ms,
            metadata=with_metadata(
                metadata,
                {
                    "cwd": resolved_cwd,
                    "script_path": str(Path(sys.argv[0]).expanduser().resolve()),
                },
            ),
        )
    )

    completed = subprocess.run(
        command,
        cwd=resolved_cwd,
        env=dict(env) if env is not None else None,
        shell=shell,
        executable=executable,
        timeout=timeout,
        capture_output=True,
        text=True,
        check=False,
    )
    return GuardedResult(audit_record=audit_record, value=completed)


def _normalize_request(
    url_or_request: str | urllib.request.Request,
    *,
    method: Optional[str],
    data: Optional[bytes],
    headers: Optional[Mapping[str, str]],
) -> urllib.request.Request:
    if isinstance(url_or_request, urllib.request.Request):
        request = urllib.request.Request(
            url_or_request.full_url,
            data=data if data is not None else url_or_request.data,
            headers={**dict(url_or_request.header_items()), **dict(headers or {})},
            method=method or url_or_request.get_method(),
        )
        return request

    return urllib.request.Request(
        url_or_request,
        data=data,
        headers=dict(headers or {}),
        method=method,
    )


__all__ = [
    "DEFAULT_WAIT_FOR_APPROVAL_MS",
    "guarded_exec_command",
    "guarded_fetch",
    "guarded_read_file",
    "guarded_write_file",
]
