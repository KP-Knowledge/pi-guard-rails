# ADR-0001: Automatic guard triggering via `agent_before_settle`

**Status:** Accepted
**Date:** 2026-02-14
**Supersedes:** docs/issues/002-agent-end-hook-integration.md (its `willRetry` assumption
does not exist in the API; `agent_end` can fire multiple times per run)

## Context

Guards ran only via the manual `/guard` command. We want them to run automatically
whenever the agent implements code, with failure output fed back into the session
(the extension's core feedback loop).

The `agent_end` hook assumed by issue-002 was rejected after reading the actual
`ExtensionAPI` types: `AgentEndEvent` has no `willRetry` field, and retries,
recovery, compaction, or queued work can continue after `agent_end`, so it can
fire several times per user-visible run.

## Decision

**Hook: `agent_before_settle`** — documented as "the final actionable boundary".
It carries `outcome: "completed" | "aborted" | "error"` (gates on clean
completion for free) and its handlers may append `custom_message` entry drafts
and return `continue: true` for exactly one next model request. Our
`maxIterations` counter is the continuation-condition guard the Pi docs require.

**Trigger: git tree-state fingerprint** (`src/detect.ts`). At `session_start` we
capture the baseline fingerprint: `git rev-parse --is-inside-work-tree` gate plus
`git status --porcelain=v1 -uall` + `git diff HEAD` (content-sensitive, so
re-editing the same file still counts). At settle:

- `outcome !== "completed"` → reset counters, settle.
- auto disabled (`"auto": false`) or no guards → settle.
- not a git repo → notify once, settle (accepted limitation — non-git projects
  are out of scope).
- fingerprint unchanged → settle (pure read-only turns cost two fast git calls).
- fingerprint changed → run guards:
  - pass → update baseline to the current fingerprint, settle;
  - fail → append history entries + a `guard-rails-failure` custom_message with
    the output, return `{ continue: true }` — the agent fixes, the next settle
    sees a differing fingerprint, guards re-run;
  - max iterations → append the failure message and notify, settle without
    continuing.

The baseline updates **only on pass**, so a still-failing tree keeps differing
from the baseline and the loop re-fires every settle until pass or `maxIterations`
— no separate `fixPending` flag is needed.

**Injection: boundary contract, not `sendUserMessage`.** Auto mode appends
`custom_message`/`custom` entry drafts and returns `continue: true` (the
documented boundary mechanism; no fake user message). The `/guard` command keeps
its existing `sendUserMessage(deliverAs: "followUp")` path.

**Config:** `.guard-rails.json` accepts the legacy array shape (auto defaults to
on) or `{ "auto": false, "guards": [...] }` to disable auto triggering.
Non-boolean `auto` values are treated as enabled.

`/guard` stays as a manual re-run sharing the same `evaluateGuards` core.

## Consequences

- Guards run at most once per settled agent run; chat-only turns cost two git
  subprocess calls.
- Detection covers edit/write **and** bash-based mutations (sed, git apply,
  generators) and manual edits — git sees all of them, which is why it was
  chosen over per-tool-call tracking.
- Guard commands that themselves mutate the tree (e.g. builds writing dist/)
  leave the baseline stale; the next settle re-runs guards once and refreshes
  the baseline. Accepted.
- Manual `/guard` runs do not refresh the auto baseline; a subsequent settle may
  re-run passing guards once. Accepted.
- Requires pi ≥ 1.0 (`agent_before_settle`); dev dependency updated to 1.1.0.