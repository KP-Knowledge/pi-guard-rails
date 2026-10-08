# branch-guard

Pi extension that protects branches like `main`/`master`: before any file edit lands on a protected branch it creates a task branch instead, and on task settle it nudges summarize-and-commit.

Entry point: `index.ts` (default export = `createBranchGuardExtension(realFileReader)`).

## How it works

### `tool_call` — branch boundary

Intercepts `edit` and `write` tools:

1. Skip when disabled (`config.enabled === false`) or already skipped this session.
2. Skip when not on a protected branch, or on a worktree branch (`worktree-*`-style names are already isolated).
3. Derive a branch name from the task prompt (LLM intent summarizer → phrase → `type/slug`; falls back to keyword-based naming when the model call fails).
4. **`mode: "auto"`** — create the branch and show a Pi notification.
   **`mode: "ask"`** — UI prompt: create branch / proceed unprotected this session. Headless ask-mode blocks the edit with instructions instead of asking.

When running in Herdr (`HERDR_ENV=1`), a successful creation also sends a `herdr notification show` desktop notification. It is best-effort; failure never blocks the edit. Branch creation failure (e.g. branch exists) blocks the tool call with the git error.

### `before_agent_start` — prompt capture

Stores the user prompt so it can be used for branch-name derivation.

### `agent_settled` — commit on change

When `commitOnSettle` is on and the current branch was guard-created, compares the git tree-state fingerprint (`git status --porcelain` + `git diff HEAD`) against the one captured at `before_agent_start`. Only when the tree changed during the agent run it commits everything (`git add -A`, message derived from the branch name, no push). A pre-existing dirty tree with no agent changes is left alone.

### `/branch` command

`/branch "fix the login bug"` — creates an LLM-named task branch from the argument (or the captured prompt when no argument). Use `/branch --name fix/cart-total-rounding` to create exactly that name. Both are recorded as guard-created so the settle nudge applies.

## Configuration

`.pi/branch-guard.json` (per project), all keys optional:

```json
{
  "enabled": true,
  "mode": "auto",
  "protectedBranches": ["main", "master"],
  "commitOnSettle": true
}
```

Defaults come from `config.ts` (`DEFAULT_PROTECTED_BRANCHES = ["main", "master"]`).

## Exported factories

| Export | Purpose |
|--------|---------|
| `createBranchGuardExtension(readFile)` | Production extension factory (real file reader, model-backed intent summarizer). |
| `createBranchGuardExtensionWithIntent(readFile, summarizeIntent)` | Test/seam variant with an injected `IntentSummarizer`. |
| `default` | Ready-to-register extension instance. |

## Module layout

| File | Role |
|------|------|
| `config.ts` | Config load + normalization, `FileReader` type. |
| `git.ts` | `GitRunner`-based git ops: current branch, tree-state fingerprint, `git switch -c`. |
| `guard.ts` | Immutable `GuardState` transitions, protected/worktree branch checks, prompt resolution. |
| `naming.ts` | Task-type + slug derivation for branch names. |
| `intent.ts` | LLM prompt that summarizes the task into a 3–5 word branch phrase. |
| `lifecycle.ts` | Settle-nudge decision (`shouldNudge`) and nudge message builder. |
| `index.ts` | Event wiring: `before_agent_start`, `tool_call`, `agent_end`, `/branch`. |