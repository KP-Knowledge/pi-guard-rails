# wayfinder:map

## Destination

A detailed implementation spec for a pi-coding-agent extension ("pi-guard-rails") that hooks into `agent_end`, runs a configurable shell command, and if it fails, injects the failure back into the same session as a user message — looping until the command passes or a configurable max iteration count is reached. The spec is complete when every decision is resolved and the way to implementation is clear.

## Notes

- **Domain:** pi-coding-agent extensions (`@earendil-works/pi-coding-agent` v0.78.0)
- **Reference project:** `/Users/tostyle/Project/Kingpower/poc/pi-extension-sand-harness-workflow` — follow its conventions for extension structure, testing patterns, and issue format
- **Skills:** `/grilling` and `/domain-modeling` for every ticket
- **Tracker:** file-system under `docs/issues/`, same format as reference project
- **Always-on:** extension activates automatically on every session (no slash command to toggle)
- **Hook:** `agent_end` (not `turn_end`)
- **Loop mechanism:** inject user message into same session (not spawn new sessions)
- **Config:** project-level config file (not global)

## Decisions so far

- [001-config-schema](./001-config-schema.md) — `.guard-rails.json` in project root; array of guard objects with `command` (required), `cwd` (default `"."`), `maxIterations` (default `3`), `timeout` (default `60000`ms); no-op if missing/malformed
- [002-agent-end-hook-integration](./002-agent-end-hook-integration.md) — subscribe via `pi.on("agent_end", handler)` at load; only run on clean agent_end (skip if `willRetry` or aborted); `isRunningGuards` flag prevents re-entrancy during command execution; iteration counter prevents infinite loops; reset counters on abort; all guards must pass each iteration
- [003-command-execution](./003-command-execution.md) — use `pi.exec()` with guard's `cwd`; exit code 0 = pass; timeout kills process and treats as failure with partial output; stdout + stderr concatenated for injection; no env injection
- [004-failure-injection](./004-failure-injection.md) — structured preamble with iteration/command/exit code + full output (no truncation); inject via `pi.sendUserMessage()` after `ctx.waitForIdle()`; message is visible in session history; only first failing guard's output injected per iteration
- [005-loop-control](./005-loop-control.md) — per-guard iteration counters in module scope; reset on fresh (non-injection) agent_end; max iterations reached → inject final summary then stop; default 3, min 1 (0 → default); no cooldown; Escape to abort (no slash command); all guards pass → loop stops silently
- [006-extension-structure](./006-extension-structure.md) — `extensions/guard-rails/` with 4 modules: `config.ts` (load+validate), `guard.ts` (execute via `pi.exec()`), `loop.ts` (iteration tracking+injection), `index.ts` (factory+`agent_end` handler); minimal deps (pi-coding-agent peer dep + vitest); testing follows reference project's mock pattern

## Not yet specified

- **Concurrent session handling** — module-scope state is shared across sessions; if pi supports multiple concurrent sessions, guard iteration counters would conflict. Not a blocker for the spec, but a known limitation to revisit if needed.

## Out of scope

- **Mid-session toggle** — no slash command to enable/disable guard-rails mid-session; Escape to abort is the only break mechanism (decided in 005-loop-control)
- **Config hot-reload** — config is loaded at extension load time only; changes require a session reload (decided in 006-extension-structure)
- **Multi-step workflows** — that's harness-workflow's domain, not guard-rails
- **Custom test runners beyond shell commands** — guard-rails runs shell commands only
- **Test result aggregation/reporting** — guard-rails injects failures back, doesn't produce reports
- **Integration with CI/CD** — guard-rails is a local development tool
