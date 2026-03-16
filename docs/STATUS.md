# AgentGuard Current Status

Last updated: 2026-03-16

This file is the current source of truth for collaborators.
If README, roadmap notes, or historical summaries disagree with this file, trust this file first.

## Product Focus

Current focus is not SDK surface expansion.
Current focus is firewall UX first:

- zero-config proxy onboarding
- real process visibility
- actionable protection alerts
- clear proof of what is real vs preview-only

## What Is Real Today

These paths are implemented and validated in the current repository:

- Rust daemon for event ingestion, decisions, approvals, and audit persistence
- Rust proxy for OpenAI-compatible traffic interception
- Desktop app with:
  - dashboard
  - audit query and pagination
  - rules management
  - setup wizard
  - process monitoring
  - protection alerts
- Python SDK with live daemon integration
- Node SDK core wrappers for file, command, and HTTP operations
- Real desktop runtime path:
  - start local stack
  - run live demo
  - generate real audit records
  - resolve desktop-driven approvals

## What Is Still Partial

These capabilities exist but are not yet production-strong:

- process network metric:
  - prefers nettop delta throughput
  - falls back to lsof socket count when needed
  - good enough for visibility, not kernel-grade accounting
- unprotected-session detection:
  - useful today
  - still heuristic, not full system attribution
- real demo reliability:
  - core flow works
  - occasional timeout still happens during demo runs

## What Is Not Implemented Yet

- system-level full coverage outside AgentGuard-integrated traffic
- macOS Endpoint Security style interception
- first-class direct integrations for Claude Code, Cursor, LangChain, LlamaIndex
- Node browser wrapper
- Node OpenAI Agents SDK integration
- rule conflict detection
- stronger audit workflow features such as false-positive labeling and review state

## Current Validation Commands

Use these commands to confirm real behavior:

```bash
pnpm stack:up
pnpm desktop:dev
pnpm verify:reality
```

See docs/REALITY_CHECKLIST.md for the manual verification checklist.

## Near-Term Priority Order

1. Demo reliability and clearer failure handling
2. Coverage proof:
   show which active agent processes are actually protected
3. More direct framework coverage:
   Claude Code and Cursor first
4. Policy UX hardening:
   rule conflict detection and review workflow improvements

## Collaboration Rule

Before adding new features, check whether the change improves one of these:

- less setup
- more real visibility
- more trustworthy protection decisions
- clearer proof that protection is active

If not, it is probably not a priority right now.
