# pi-guard-rails

A [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension that runs guard commands (lint/test/build) in a feedback loop. When the agent finishes a turn that changed the codebase, guards run automatically; if a guard fails, the output is injected back into the session so the agent can fix it — looping until all guards pass or a configurable max iteration count is reached. A `/guard` command is also available for manual runs.

## How it works

### Automatic mode (default)

1. At session start the extension captures a git tree-state fingerprint of your project (`git status --porcelain` + `git diff HEAD`).
2. When the agent settles after a turn, the fingerprint is re-read. If nothing changed (read-only turns), nothing runs.
3. If the tree changed, each configured guard command runs in sequence.
4. If a guard fails, the failure output is appended to the session as a `guard-rails-failure` message and the agent continues with one more request to fix it.
5. On the next settle the fingerprint still differs from the baseline, so guards re-run — until all pass (baseline refreshes) or `maxIterations` is reached (loop gives up).

Automatic mode requires the project to be a git repository.

### Manual mode

Run the `/guard` command in your pi session. Guards run the same way; failures are injected as a follow-up user message via `pi.sendUserMessage()`. Guard runs and results are appended to a custom `guard-rails-history` entry in the session history.

## Installation

Add the extension to your pi-coding-agent configuration:

```json
{
  "extensions": ["@kingpower/pi-guard-rails"]
}
```

## Configuration

Create a `.guard-rails.json` file in your project root, or at `.ai-passport/guard-rails.json`. The file is either a JSON array of guard objects (auto mode defaults to on) or an object with `guards` and an optional `auto` flag. `.guard-rails.json` takes precedence when both exist.

```json
[
  {
    "command": "nx run lint",
    "cwd": ".",
    "maxIterations": 2,
    "timeout": 30000,
    "instructions": "Fix TypeScript errors first."
  },
  {
    "command": "nx run test",
    "cwd": ".",
    "maxIterations": 3,
    "timeout": 60000
  }
]
```

### Schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `command` | `string` | yes | — | Shell command to run (e.g. `"nx run test"`). Run via `sh -c`, so pipes, quotes, and redirects work. |
| `cwd` | `string` | no | `"."` | Working directory, relative to project root |
| `maxIterations` | `number` | no | `3` | Max loop iterations before giving up (minimum 1; non-numeric values fall back to default) |
| `timeout` | `number` | no | `60000` | Command execution timeout in milliseconds (must be > 0) |
| `instructions` | `string` | no | — | Extra guidance appended to the failure message for the agent |

### Behavior

- **Missing config file**: extension does nothing (no-op, reports a warning).
- **Malformed JSON / invalid shape**: extension does nothing (no-op, logs a warning).
- **Auto mode off** (`"auto": false`) or non-git project: only the `/guard` command runs guards.
- **Agent aborted/errored**: counters reset; guards do not run.
- **Multiple guards**: all guards run in sequence each iteration. All must pass for the loop to stop. The loop stops at the first failing guard and injects its output.
- **Timeout**: if a command exceeds its timeout, the process is killed and treated as a failure with partial output. The failure message reports `timed out after <n>ms`.
- **Pass/fail**: exit code `0` = pass, any non-zero = fail.
- **Re-entrancy**: concurrent `/guard` invocations are ignored while a guard run is in progress.
- **Counters**: iteration counters reset to zero once all guards pass.

### Minimal example

```json
[
  { "command": "npm test" }
]
```

### Disabling automatic mode

```json
{
  "auto": false,
  "guards": [{ "command": "npm test" }]
}
```

With `"auto": false` guards only run when you invoke `/guard`.

This runs `npm test` when `/guard` is invoked, up to 3 iterations, with a 60-second timeout.

### Multiple commands example

```json
[
  { "command": "nx run lint", "maxIterations": 2, "timeout": 30000 },
  { "command": "nx run test", "maxIterations": 5, "timeout": 120000 },
  { "command": "nx run build", "cwd": "packages/api", "maxIterations": 3 }
]
```

### Custom instructions example

```json
[
  {
    "command": "nx run test",
    "instructions": "Focus on the TypeScript compilation errors before runtime errors."
  }
]
```

When this guard fails, the injected message includes an `Additional instructions:` section with the provided text.

## Failure message format

When a guard fails, the injected message looks like:

```
--- Guard Rails: iteration 1/3 ---
Command: nx run test (exit code 1)

Output:
<stdout + stderr>

Please fix the failing command output above and try again.
```

With custom `instructions`:

```
--- Guard Rails: iteration 1/3 ---
Command: nx run test (exit code 1)

Output:
<stdout + stderr>

Please fix the failing command output above and try again.

Additional instructions:
Focus on the TypeScript errors first.
```

When max iterations is reached:

```
--- Guard Rails: max iterations (3) reached ---
Command: nx run test (exit code 1)

The guard command has not passed after 3 iterations. Here is the last output:

Output:
<stdout + stderr>

Please review the failures and fix them manually.
```

Timeout failures report `timed out after <n>ms` instead of `exit code <n>`.

## Development

```bash
npm test          # run tests once
npm run test:watch # run tests in watch mode
npx tsc --noEmit   # type check
```

## License

MIT