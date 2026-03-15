# AgentGuard Architecture

This document is the implementation guardrail for AgentGuard's MVP.

The goal is not to build a generic desktop shell first. The goal is to build the best local control plane for AI agents:

1. observe what an agent is trying to do
2. normalize that into a consistent event model
3. decide whether the action is safe
4. block, ask, or allow before damage happens
5. leave behind a clear audit trail

## North Star

AgentGuard should become the default runtime safety layer for AI agents on developer machines and personal desktops.

That means our implementation priorities are:

- runtime enforcement before analytics
- clear policy decisions before rich UI
- local-first trust and auditability before cloud features
- semantic visibility before deep platform-specific hardening

## Technology Decisions

### Core runtime: Rust

Rust is the right center of gravity for AgentGuard because the project needs:

- low-latency interception and decision-making
- strong memory safety in a security-sensitive daemon
- clean cross-platform abstractions for process, file, and network observers
- a single language for the runtime, prompt proxy, and most shared logic

Rust should own:

- the canonical event model
- the policy engine
- the local daemon
- prompt proxy services
- platform adapters

### Desktop app: Tauri + TypeScript

The desktop app should be a Tauri shell with a TypeScript UI.

Why:

- Tauri v2 gives us a small, native-feeling desktop shell and a capability model for limiting desktop-side privileges
- the frontend can move quickly in TypeScript without putting core enforcement logic in JavaScript
- we keep the browser layer focused on visibility and consent, not policy truth

### SDKs and wrappers: TypeScript and Python

MVP cannot rely only on deep OS hooks.

We need lightweight wrappers for the agent ecosystems most likely to adopt first:

- Node.js / TypeScript agent tools
- Python agent frameworks

Those wrappers should emit high-signal semantic events such as:

- `read_file`
- `write_file`
- `http_request`
- `database_query`
- `browser_open`
- `exec_command`

This gives us semantic coverage before we achieve full system-wide coverage.

## Platform Strategy

### Phase 1: semantic enforcement first

The first shipping line should be:

- local daemon in Rust
- prompt proxy in Rust
- policy engine in Rust
- Node/Python wrappers
- desktop app for alerts, logs, and rules

This gets us a real product without depending on platform entitlements that are hard to obtain on day one.

### Phase 2: OS-level observers

We will add deeper platform adapters behind stable Rust traits:

- macOS: process and file/network observation where available, with a longer-term path to Endpoint Security–backed monitoring
- Linux: stronger sandboxing and observation using kernel primitives
- Windows: file-system and process/network integration using the platform's filter-driver model

### Important constraint

Inference from official platform docs: macOS deep endpoint-style interception should not be the MVP dependency. Apple gates Endpoint Security access through a dedicated entitlement, so the first version must still be strong without assuming that entitlement is available.

## Service Boundaries

### `agentguard-daemon`

Owns:

- local policy evaluation
- event ingestion
- alert generation
- rule loading
- audit persistence
- agent identity and trust state
- the local service API other components talk to

Should run headlessly and be the only source of truth for decisions.

### `agentguard-policy`

Owns:

- the normalized rule model
- matching and prioritization
- default security rules
- fallback heuristics for unknown behavior

This crate must stay pure and easily testable.

### `agentguard-models`

Owns:

- event schemas
- rule schemas
- decisions
- agent identity data structures
- risk levels and action enums

This is the contract between every other subsystem.

### `agentguard-store`

Owns:

- SQLite-backed audit persistence
- SQLite-backed approval queue persistence
- schema initialization and migrations
- loading recent records and pending approvals for the desktop app and CLI tooling

This crate should stay storage-focused and avoid absorbing policy logic.

### `agentguard-proxy`

Owns:

- OpenAI-compatible local proxy endpoints
- prompt and model-response inspection before forwarding output to clients
- translating proxy traffic into normalized prompt events for the daemon

The first version should support a narrow but real MVP path before expanding to streaming and more providers.

### Future crates

- `agentguard-platform`: OS-specific observation adapters behind shared traits
- `agentguard-client`: Rust client for talking to the daemon

### Applications and SDKs

- `apps/desktop`: Tauri UI for alerts, dashboard, approval modals, rules, and audit logs
- `sdks/node`: TypeScript wrapper for Node-based agents with approval-aware guard calls
- `sdks/python`: Python wrapper for Python-based agents with approval-aware guard calls

## Event Flow

1. An agent or platform adapter emits a raw event.
2. The adapter normalizes it into `agentguard-models::Event`.
3. `agentguard-daemon` enriches the event with agent identity, trust, and metadata.
4. `agentguard-policy` returns a decision.
5. The daemon enforces the decision:
   - allow
   - warn
   - ask
   - block
   - kill
6. If the decision is `ask`, the daemon creates an approval request and exposes it over the local API.
7. The desktop app surfaces the approval as a modal and resolves it back to the daemon.
8. The daemon updates the canonical audit record with the final decision.

## MVP Scope

Ship these first:

- command-risk detection and blocking
- sensitive path protection
- basic prompt injection and secret-pattern detection
- approval workflow for risky actions
- audit logging
- per-agent and per-target rules

Do not optimize for these yet:

- cloud sync
- enterprise IAM
- broad data visualizations
- deep system-level hooks on every OS
- polished plugin ecosystems

## Repo Layout

```text
.
├── Cargo.toml
├── docs/
│   └── architecture.md
├── crates/
│   ├── agentguard-daemon/
│   ├── agentguard-models/
│   ├── agentguard-policy/
│   ├── agentguard-proxy/
│   └── agentguard-store/
├── apps/
│   └── desktop/
└── sdks/
    ├── node/
    └── python/
```

## Immediate Implementation Sequence

1. Lock the shared event and rule model.
2. Build the policy engine with tests for critical behaviors.
3. Stand up a daemon that can evaluate sample events and emit decisions.
4. Add a daemon API and local SQLite audit store.
5. Ship the interactive desktop approval loop.
6. Add agent wrappers for Python.

## Reference Links

- [Tauri v2 security capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri v2 homepage](https://v2.tauri.app/)
- [Apple Endpoint Security `es_new_client`](https://developer.apple.com/documentation/endpointsecurity/es_new_client%28_%3A_%3A%29)
- [Linux Landlock userspace API](https://docs.kernel.org/userspace-api/landlock.html)
- [Windows file-system filter driver guidance](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/about-file-system-filter-drivers)
