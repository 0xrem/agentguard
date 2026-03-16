# Historical Code Issues Note

This file is preserved only for historical context.

It documented a one-time cleanup pass from 2026-03-15 and should not be used to infer current repository health.

Current code health should be checked with:

```bash
cd apps/desktop && cargo check -p agentguard-desktop
cd apps/desktop && pnpm exec tsc --noEmit
pnpm verify:reality
```

Current implementation status lives in:

- docs/STATUS.md
- docs/REALITY_CHECKLIST.md
- docs/ROADMAP.md

Historical note:

- the `RuleImport` unused warning may still appear in desktop Rust builds
- that warning is low priority and not the deciding signal for repository readiness
