# Reality Checklist

This checklist is used to verify desktop behavior is backed by real daemon/proxy/runtime data instead of browser preview mocks.

## Quick Run

```bash
pnpm stack:doctor
pnpm verify:reality
```

Use `pnpm stack:doctor` first when troubleshooting startup/readiness issues. It reports port occupancy, process ownership, readiness probe payloads, and recent failure reasons from runtime logs.

What this does:

1. Ensures local daemon and proxy are up.
2. Confirms runtime readiness probes (`/readyz`, fallback `/healthz`) are reachable.
3. Runs live demo to trigger real runtime activity.
4. Pulls daemon audit records from `/v1/audit`.
5. Verifies recent records are real events and not `browser_preview` mock source.

## Manual Spot Checks

1. Open desktop app via Tauri (`pnpm desktop:dev`).
2. Go to Processes page:
   - `threads` should be non-zero for many active processes.
   - `open files` should be non-zero for active processes.
   - `network` should show near-window throughput in `KB/s` when source is `nettop delta`.
   - If `nettop` is unavailable, source may fall back to `lsof socket count`.
3. Go to Audit page:
   - New events should appear after running `pnpm demo:live`.
   - Records should not include `event.metadata.source=browser_preview`.

## Current Known Limits

- Network throughput is derived from `nettop` delta samples (`~1s` window) and can be noisy.
- If `nettop` cannot be read, network throughput falls back to `0 KB/s`.
- Live demo may timeout in some environments; checklist still validates via fresh daemon audit records.
