# ADR-0001: Automatic guard triggering via `agent_before_settle`

**Status:** Draft (open questions below)
**Date:** 2026-02-14
**Supersedes:** docs/issues/002-agent-end-hook-integration.md (its `willRetry` assumption is wrong — see below)

## Context

Today guards only run via the manual `/guard` command. We want them to run
automatically whenever the agent implements code, with the failure output fed
back into the session (the extension's core feedback loop) — no manual command.

The PRD/issue-002 assumed the `agent_end` hook with a `willRetry` field. Reading
the actual `ExtensionAPI` types (`dist/core/extensions/types.d.ts`):

- `AgentEndEvent` is `{ type: "agent_end"; messages: AgentMessage[] }` — **no
  `willRetry`**, and docs say retries/recovery/compaction/queued work can
  continue *after* `agent_end`, so it can fire several times per user-visible
  run.
- `AgentBeforeSettleEvent` extends `BoundaryState`: it carries
  `outcome: "completed" | "aborted" | "error"`, a `context` preview, and is
  documented as "the final actionable boundary": handlers may append
  `custom_message`/`custom` entry drafts and return `continue: true` to request
  exactly one next model request. Pi docs explicitly warn to guard continuation
  conditions — our `maxIterations` counter is that guard.

## Decision

Subscribe to `agent_before_settle` (always-on, registered at extension load):

1. **Gate on outcome.** `outcome !== "completed"` → reset iteration counters,
   return (settle normally).
2. **Gate on activity.** Skip unless the run mutated files (see detection)
   OR `fixPending` is set (see open question 2).
3. **Run guards sequentially.** On first failure:
   - increment that guard's counter; if `>= maxIterations` → notify + settle;
   - else append a `custom_message` entry with the failure output and
     return `{ continue: true }` → the agent gets one more request with the
     failure in context → it fixes → settle fires again → guards re-run.
4. **All pass** → reset counters, settle.

Mutation detection: track mutating tool calls via `tool_result` events
(toolName `edit`/`write`/`bash`? — open question 1) in session state; the flag
is consumed by the settle handler. Alternative considered and rejected:
`git status --porcelain` at settle time (breaks in non-git dirs; fires on manual
edits outside the agent).

`/guard` remains as a manual trigger sharing the same loop code.

Replaces the `sendUserMessage(deliverAs: "followUp")` injection with the
boundary contract (`custom_message` entries + `continue: true`), which is the
documented mechanism for boundary handlers. This also removes the fake
"user message" framing of failure output.

## Consequences

- Guards run at most once per settled agent run; per-turn noise is avoided.
- The loop terminates via `maxIterations` even though each failure requests a
  continuation (guards the documented "unconditional continuation can loop"
  hazard).
- Session state must be reconstructed across extension reloads only if we want
  counters to survive reloads (currently: fresh on reload — acceptable).

## Open questions

1. Which tool calls count as "implemented code"? `edit` + `write` only, or
   `bash` too (sed -i, git apply, generators mutate via bash)?
2. `fixPending`: once a failure is injected, re-run guards on every settle
   until pass/maxIter even if the fix turn edited nothing — otherwise a
   no-op "fix" escapes the loop. Confirm?
3. Config opt-out (`"auto": true|false` in `.guard-rails.json`), or always-on
   when a config file exists?
4. Keep `/guard` manual command? (proposed: yes)