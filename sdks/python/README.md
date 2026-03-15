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

## Live local approval demo

Run a harmless local command through the real daemon approval loop:

```bash
PYTHONPATH=sdks/python/src python3 sdks/python/examples/live_demo_agent.py \
  --daemon-base-url http://127.0.0.1:8790 \
  --wait-for-approval-ms 30000
```

This is the same fallback path the desktop app can launch from its "Run real agent demo" action when no `OPENAI_API_KEY` is available.
The SDK also forwards runtime process context such as PID, executable path, working directory, and script path when it can infer them, so desktop approvals and audit records have more than just a wrapper-level agent name.

## OpenAI Responses / tools example

Run a minimal Responses-style tool runner through the Python SDK:

```bash
OPENAI_API_KEY=sk-... \
PYTHONPATH=sdks/python/src python3 sdks/python/examples/openai_responses_agent.py \
  "Upload the prepared payload and confirm when it is done." \
  --daemon-base-url http://127.0.0.1:8790
```

This example talks directly to an OpenAI-compatible `/v1/responses` endpoint. Tool execution still goes through the local AgentGuard daemon, so desktop approvals and audit logging work the same way.

To route the same Responses runner through the local proxy, point it at the proxy base URL:

```bash
PYTHONPATH=sdks/python/src python3 sdks/python/examples/openai_responses_agent.py \
  "Read the project README and confirm when it is done." \
  --responses-base-url http://127.0.0.1:8787 \
  --daemon-base-url http://127.0.0.1:8790
```

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

## Run the real daemon + Responses agent integration check

```bash
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -p 'test_responses_agent_integration.py' -v
```

## Run the real daemon + proxy + Responses agent integration check

```bash
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -p 'test_responses_agent_proxy_integration.py' -v
```
