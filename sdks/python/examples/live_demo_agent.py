from __future__ import annotations

import argparse
import json
import sys

from agentguard_sdk import AgentGuardClient, guarded_exec_command


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a live local AgentGuard SDK demo that waits on desktop approval.",
    )
    parser.add_argument("--daemon-base-url", default=None)
    parser.add_argument("--agent-name", default="agentguard-python-live-demo-agent")
    parser.add_argument("--wait-for-approval-ms", type=int, default=30_000)
    parser.add_argument(
        "--command",
        default="printf 'agentguard-live-demo'",
        help="Harmless local command that still exercises the command approval path.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    client = AgentGuardClient(base_url=args.daemon_base_url, agent=args.agent_name)
    result = guarded_exec_command(
        client,
        args.command,
        wait_for_approval_ms=args.wait_for_approval_ms,
    )

    if result.value.stdout:
        print(result.value.stdout, end="")
    if result.value.stderr:
        print(result.value.stderr, end="", file=sys.stderr)

    print(
        json.dumps(
            {
                "audit": {
                    "action": result.audit_record.decision.action,
                    "risk": result.audit_record.decision.risk,
                    "reason": result.audit_record.decision.reason,
                    "operation": result.audit_record.event.operation,
                    "target": result.audit_record.event.target.to_dict(),
                }
            },
            indent=2,
        ),
        file=sys.stderr,
    )
    return int(result.value.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
