# pi-guard-rails

A [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension that runs guard commands in a feedback loop via the `/guard` command. If a guard command fails, the output is injected back into the session so the agent can fix it — looping until all guards pass or a configurable max iteration count is reached.

## How it works

1. Run the `/guard` command in your pi session.
2. The extension loads guard commands from your config file.
3. Each configured guard command (e.g. `nx run test`) runs in sequence.
4. If all guards pass, the session ends normally and iteration counters reset.
5. If any guard fails, the failure output is injected as a follow-up user message via `pi.sendUserMessage()`, triggering a new agent turn to fix the issue.
6. The loop repeats (re-run `/guard`) until all guards pass or `maxIterations` is reached for a failing guard.
7. If max iterations is hit, a final summary is injected and the loop stops for that guard.
8. Guard runs and results are appended to a custom `guard-rails-history` entry in the session history.

## Installation

Add the extension to your pi-coding-agent configuration:

```json
{
  "extensions": ["@kingpower/pi-guard-rails"]
}
```

## Configuration

Create a `.guard-rails.json` file in your project root, or at `.ai-passport/guard-rails.json`. The file is a JSON array of guard objects. `.guard-rails.json` takes precedence when both exist.

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
- **Malformed JSON / non-array**: extension does nothing (no-op, logs a warning).
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