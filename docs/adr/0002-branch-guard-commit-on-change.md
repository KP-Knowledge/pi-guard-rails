# ADR-0002: branch-guard commits only when the tree changed during the run

**Status:** Accepted
**Date:** 2026-02-14
**Related:** ADR-0001 (same detection method, different baseline scope)

## Context

branch-guard's `agent_settled` handler committed whenever the worktree was dirty
(`git status --porcelain` non-empty) on a guard-created branch. That commits
pre-existing user WIP even when the agent changed nothing — e.g. ask a
question on a branch with uncommitted local edits and the extension silently
commits them.

## Decision

Reuse the guard-rails detection method, scoped to a single agent run:

- `before_agent_start` (awaited by pi before the run proceeds) captures the
  tree-state fingerprint: `git status --porcelain=v1 -uall` plus `git diff HEAD`
  (content-sensitive, so re-editing the same file still counts). `null` when
  git is unavailable.
- `agent_settled` commits only when `commitOnSettle` is on, the branch was
  guard-created, and the fingerprint differs from the run's baseline.
- On a successful commit the baseline resets to clean, so a duplicate settled
  event cannot double-commit.

The baseline is per-run, not per-session: the question is "did *this agent
run* do work worth committing", which is precisely what a run-scoped diff
answers. (guard-rails uses a session-level baseline updated on pass because
its loop re-runs guards across settles; branch-guard acts once per run.)

`getDirtyFiles` was removed — dead after the switch.

## Consequences

- Pre-existing WIP + agent changes still lands in one commit (`git add -A`) —
  same as before; only the no-agent-change case is fixed.
- If the agent edits a file back to its exact original content, the diff
  content makes the fingerprint equal the baseline → no commit (status alone
  would miss this; `git diff HEAD` catches it except for byte-identical
  reverts, which are genuinely no-change).
- `lifecycle.ts` no longer carries the old summarize-and-commit nudge
  (`shouldNudge`, `MAX_NUDGE_ATTEMPTS`); it now exports `COMMIT_GUIDELINE`,
  which `before_agent_start` appends to the system prompt so the agent does
  not ask for commit confirmation.