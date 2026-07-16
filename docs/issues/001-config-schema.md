## Question

What is the schema for the guard-rails configuration file? Where does it live, what fields are required vs optional, and what are the valid values?

This must cover:
- File name and location (project-level, per the destination)
- The command to run (required)
- Max iteration count (optional, with a sensible default)
- Any other configuration fields the extension needs
- Whether the file is auto-created with defaults on first load
- Fallback behavior if the file is missing or malformed

## Resolution

**File:** `.guard-rails.json` in the project root.

**Schema:** A top-level JSON array of guard objects. Each guard object has:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `command` | `string` | yes | — | Shell command to run (e.g. `"nx run test"`) |
| `cwd` | `string` | no | `"."` | Working directory for the command, relative to project root |
| `maxIterations` | `number` | no | `3` | Maximum loop iterations before giving up |
| `timeout` | `number` | no | `60000` | Command execution timeout in milliseconds |

**Example:**
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

**Fallback behavior:**
- If the file is missing: extension is a no-op (does nothing, logs a warning).
- If the file is malformed JSON: extension is a no-op (logs a warning, does not overwrite the file).
- No auto-creation of the config file.

**Out of scope for this schema:** `env`, `messageTemplate`, `cooldownMs`, `passExitCodes` — none of these are supported. The schema is deliberately minimal.
