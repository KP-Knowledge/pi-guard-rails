# Glossary — guard-rails

- **Guard** — a configured shell command (lint/test/build) that must pass before
  the agent's work is considered done. Defined in `.guard-rails.json`.
- **Guard loop** — run guards → inject first failure into the session → agent
  fixes → repeat, until all pass or a guard hits `maxIterations`.
- **Iteration counter** — per-guard count of consecutive failures; caps the loop.
- **Settle / `agent_before_settle`** — the final actionable moment of an agent
  run, after retries/compaction; handlers may append entries and return
  `continue: true` for one more model request.
- **Boundary entry drafts** — `custom` / `custom_message` / `context_edit` /
  `compaction` entries a boundary handler proposes; `custom_message` reaches
  both transcript and model.
- **Mutation flag / tree-state fingerprint** — the git-based detection signal:
  `git status --porcelain` + `git diff HEAD` output captured at `session_start`
  (baseline) and compared at every settle. Unchanged → skip; changed → run
  guards. The baseline updates only when all guards pass (see ADR-0001).
- **Baseline** — the last tree-state fingerprint at which all guards passed;
  a still-failing tree keeps differing from it, driving the fix loop.
- **`fixPending`** — considered and dropped: the baseline-only-updates-on-pass
  rule gives the same re-run-until-pass semantics without extra state.
- **`/guard`** — manual slash command that runs the same guard loop on demand.
- **Run-start baseline** — branch-guard's per-run variant of the fingerprint:
  captured at `before_agent_start`, compared at `agent_settled` to decide
  whether the agent's work needs committing (ADR-0002).