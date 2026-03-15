# AgentGuard

> The runtime firewall for AI agents.

AI agents can read files, run shell commands, open browsers, call APIs, and touch sensitive data. That means the real risk is no longer only "the model said something wrong." The risk is "the agent did something wrong."

**AgentGuard** adds an independent safety layer between an AI agent and your machine. It watches what agents try to do in real time, scores the risk, and lets the user allow, deny, or kill dangerous behavior before damage happens.

Our long-term goal is simple: if you run AI agents locally, AgentGuard should feel as normal and necessary as a firewall, password manager, or endpoint protection tool.

## Why Now

AI is moving from chat to execution.

Tools like Cursor, Claude Code, Copilot CLI, local LLM agents, automation bots, and custom internal agents can already:

- read and modify files
- execute shell commands
- browse the web
- call APIs and databases
- access local credentials and environment variables

Today, most users rely on prompts, best-effort sandboxing, or blind trust.

That is not a real control plane.

Common failure modes include:

- prompt injection from webpages, documents, or RAG content
- destructive commands like `rm -rf ~`
- secret exfiltration from `.env`, `~/.ssh`, or credential stores
- agents writing outside approved project directories
- unauthorized uploads to external services
- "normal" processes doing dangerous things that traditional AV and firewalls do not understand

## What AgentGuard Is

AgentGuard is an **AI Agent Runtime Firewall** for desktops and developer machines.

It is built around three protection layers:

| Layer | What it watches | Typical action |
| --- | --- | --- |
| `Prompt Guard` | Prompts, retrieved content, model outputs, tool arguments | warn, mask, block, ask |
| `Tool Guard` | File access, browser actions, HTTP requests, database calls, emails | allow, deny, ask, sandbox |
| `Command Guard` | Shell / CMD / PowerShell execution | suspend, block, confirm, kill |

And a set of control-plane features:

- `Smart Alerts`: clear, real-time approval dialogs
- `Privacy Sandbox`: locked-down paths, secrets, env vars, and sensitive resources
- `Rules Manager`: per-agent, per-path, per-command policies
- `Audit Log`: local, searchable security history
- `Dashboard`: what is running, what was blocked, and why

## What It Feels Like

When an agent tries something risky, AgentGuard should explain it in plain English in under three seconds.

```text
Claude Code wants to read ~/.ssh/id_rsa

Reason: sensitive credential path
Risk: Critical
Target: /Users/alice/.ssh/id_rsa

[Allow once] [Always allow for this app] [Deny] [Deny and kill agent]
```

Not "something suspicious happened."
Not "trust us."

The user should always understand:

- who is acting
- what they are trying to do
- why it is risky
- what will happen next

## Threat Model

AgentGuard is designed for the risks that appear when models gain execution power:

- prompt injection and role override
- RAG poisoning and malicious documents
- dangerous shell commands
- secret and credential exposure
- tool abuse and overreach
- file, network, and database actions outside the intended scope

It is not trying to be:

- a replacement for antivirus or a full EDR platform
- a judge of factual correctness for every model response
- a complete enterprise IAM layer on day one

## Who Should Install This

- Developers using Cursor, Claude Code, Copilot CLI, or custom coding agents
- People running local LLM agents with filesystem or shell access
- Power users automating work on laptops or workstations
- Security-conscious teams that want visibility before agents get broader permissions

If an agent can touch your machine, your data, or your credentials, AgentGuard is relevant.

## Example Policies

```text
[Agent: Unknown] -> [Tool: ReadFile] -> [Path: ~/.ssh/*] -> [Action: Block]
[Agent: Coding Assistant] -> [Tool: FileWrite] -> [Path: ~/Projects/*] -> [Action: Allow]
[Agent: Any] -> [Command: rm -rf ~] -> [Action: Block]
[Agent: Any] -> [HTTP Upload] -> [Domain: unknown] -> [Action: Ask]
```

## Architecture Direction

AgentGuard is being designed as a local-first system with a clear split between UX, monitoring, and policy enforcement.

Planned components:

- `Desktop App` for the dashboard, alerts, rules, and logs
- `Core Runtime` in Rust for process monitoring, attribution, scoring, and enforcement
- `Local Prompt Proxy` for prompt and response inspection without forcing a cloud dependency
- `SDK / Wrappers` for Python and Node.js agent frameworks
- `Rule Engine` for policy matching, trust levels, and actions

Key technical challenges:

- process attribution: deciding whether a `curl` came from the user or an agent
- low-latency interception: blocking risky behavior before it executes
- clear defaults: protecting normal users without overwhelming them
- cross-platform behavior: starting with developer-friendly desktop workflows and expanding carefully

## MVP

The first version is focused on the shortest path to real value:

- high-risk command interception
- sensitive path protection
- basic prompt injection and secret pattern detection
- desktop approval dialogs
- local rules and audit logs

Success means:

- dangerous commands are reliably intercepted
- sensitive resource access is visible and controllable
- users understand why something was blocked
- false positives can be reviewed and tuned

## Product Principles

- Local first. Logs and decisions should stay on the machine by default.
- Human readable. Every block needs a reason a normal person can understand.
- Secure by default. Sensitive paths and destructive actions should not require expert configuration.
- Minimal friction. Normal work should flow; only risky behavior should interrupt.
- Independent control plane. AgentGuard should protect users even when the agent, model, or prompt chain is wrong.

## Roadmap

1. `MVP`
   - Command monitoring and blacklist-based blocking
   - Basic approval dialogs
   - Minimal rules engine
   - Audit log
2. `Beta`
   - Local prompt proxy
   - Python and Node.js wrappers
   - Dashboard
   - More granular rules and trust levels
3. `Production`
   - richer system-level monitoring
   - rule updates and sharing
   - stronger privacy sandboxing
   - team and commercial features

## Project Status

AgentGuard is early. This repository is the foundation for the product vision, threat model, and first implementation milestones.

Current end-to-end proof:

- `cargo test -p agentguard-proxy --test approval_flow`
- this spins up a mock upstream model API, a local AgentGuard proxy, and a local daemon on the same SQLite control plane
- it verifies both paths: prompt responses stay pending until operator approval, and approved responses are released cleanly afterward
- `PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -v`
- this verifies the Python SDK follows the same allow, pending-approval, deny, and approval-resolution semantics as the Node wrappers
- `PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -p 'test_daemon_integration.py' -v`
- this boots the real Rust daemon binary, drives it through the Python SDK, and resolves approvals through the same daemon API contract the desktop app uses

The most useful contributions right now are:

- runtime monitoring and OS-level interception design
- Rust systems programming
- desktop UX for trust, alerts, and auditability
- rule engine design
- real-world agent integration examples
- threat research and attack samples

## Why This Project Matters

The next wave of software will not only answer questions. It will act.

That makes a new default layer necessary: something that sits between "the model decided" and "the machine obeyed."

AgentGuard is building that layer.

If we get this right, running an AI agent without an agent firewall will eventually feel as strange as browsing the web without HTTPS.

## Contributing

Open an issue if you want to:

- share real attack or failure cases
- propose an integration target
- help design the MVP
- contribute code as the first implementation lands

Star the repo if you think every agent deserves a seatbelt.
