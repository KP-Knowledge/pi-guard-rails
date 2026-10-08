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
- **Mutation flag** — session state set when a file-mutating tool call
  (`edit`/`write`, maybe `bash` — ADR-0001 Q1) completes; gates whether the
  settle handler runs guards.
- **`fixPending`** — session state meaning a failure was injected and the loop
  awaits a fix; forces guards to re-run on the next settle regardless of the
  mutation flag (ADR-0001 Q2).
- **`/guard`** — manual slash command that runs the same guard loop on demand.