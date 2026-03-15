# AgentGuard Python SDK

Python wrappers and client helpers for talking to the local AgentGuard daemon.

## What it covers

- evaluate events against the daemon before execution
- surface pending approvals and policy denials as explicit exceptions
- wrap file reads, file writes, HTTP requests, and shell commands

## Example CLI agent

Run a minimal Python tool runner that reports every file read, HTTP request, and shell command to AgentGuard:

```bash
PYTHONPATH=sdks/python/src python3 sdks/python/examples/cli_agent.py read-file README.md
PYTHONPATH=sdks/python/src python3 sdks/python/examples/cli_agent.py fetch https://example.com --method POST --data '{"hello":"world"}'
PYTHONPATH=sdks/python/src python3 sdks/python/examples/cli_agent.py list-approvals --status pending
```

## Run tests

```bash
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -v
```

## Run the real daemon integration check

```bash
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -p 'test_daemon_integration.py' -v
```
