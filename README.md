# pi-guard-rails

A [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension that runs guard commands in a feedback loop after the agent finishes. If a guard command fails, the output is injected back into the session so the agent can fix it — looping until all guards pass or a configurable max iteration count is reached.

## How it works

1. The extension is **always-on**. It subscribes to the `agent_end` lifecycle hook.
2. When the agent finishes a turn, the extension runs each configured guard command (e.g. `nx run test`).
3. If all guards pass, the session ends normally.
4. If any guard fails, the failure output is injected as a user message via `pi.sendUserMessage()`, triggering a new agent turn to fix the issue.
5. The loop repeats until all guards pass or `maxIterations` is reached for a failing guard.
6. If max iterations is hit, a final summary is injected and the loop stops.
7. Pressing **Escape** to abort the agent resets all iteration counters.

## Installation

Add the extension to your pi-coding-agent configuration:

```json
{
  "extensions": ["@kingpower/pi-guard-rails"]
}
```

## Configuration

Create a `.guard-rails.json` file in your project root. The file is a JSON array of guard objects:

```json
[
  {
    "command": "nx run lint",
    "cwd": ".",
    "maxIterations": 2,
    "timeout": 30000
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
| `command` | `string` | yes | — | Shell command to run (e.g. `"nx run test"`) |
| `cwd` | `string` | no | `"."` | Working directory, relative to project root |
| `maxIterations` | `number` | no | `3` | Max loop iterations before giving up (minimum 1) |
| `timeout` | `number` | no | `60000` | Command execution timeout in milliseconds |

### Behavior

- **Missing config file**: extension does nothing (no-op).
- **Malformed JSON**: extension does nothing (no-op, logs a warning).
- **Multiple guards**: all guards run in sequence each iteration. All must pass for the loop to stop. The first failing guard's output is injected.
- **Timeout**: if a command exceeds its timeout, the process is killed and treated as a failure with partial output.
- **Pass/fail**: exit code `0` = pass, any non-zero = fail.

### Minimal example

```json
[
  { "command": "npm test" }
]
```

This runs `npm test` after every `agent_end`, up to 3 iterations, with a 60-second timeout.

### Multiple commands example

```json
[
  { "command": "nx run lint", "maxIterations": 2, "timeout": 30000 },
  { "command": "nx run test", "maxIterations": 5, "timeout": 120000 },
  { "command": "nx run build", "cwd": "packages/api", "maxIterations": 3 }
]
```

## Failure message format

When a guard fails, the injected message looks like:

```
--- Guard Rails: iteration 1/3 ---
Command: nx run test (exit code 1)

Output:
<stdout + stderr>

Please fix the failing command output above and try again.
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

## Development

```bash
npm test          # run tests once
npm run test:watch # run tests in watch mode
```

## License

MIT