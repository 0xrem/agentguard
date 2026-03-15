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

## OpenAI-compatible agent example

Run a minimal JSON-planned agent loop through `agentguard-proxy` and the Python SDK:

```bash
PYTHONPATH=sdks/python/src python3 sdks/python/examples/openai_chat_agent.py \
  "Upload the prepared payload and confirm when it is done." \
  --proxy-base-url http://127.0.0.1:8787 \
  --daemon-base-url http://127.0.0.1:8790
```

The model side talks to the proxy. Every real tool action still goes through the local AgentGuard daemon before execution.

## Run tests

```bash
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -v
```

## Run the real daemon integration check

```bash
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -p 'test_daemon_integration.py' -v
```

## Run the real daemon + proxy + agent integration check

```bash
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -p 'test_openai_agent_proxy_integration.py' -v
```
