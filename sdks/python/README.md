# AgentGuard Python SDK

Python wrappers and client helpers for talking to the local AgentGuard daemon.

## What it covers

- evaluate events against the daemon before execution
- surface pending approvals and policy denials as explicit exceptions
- wrap file reads, file writes, HTTP requests, and shell commands

## Run tests

```bash
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -v
```
