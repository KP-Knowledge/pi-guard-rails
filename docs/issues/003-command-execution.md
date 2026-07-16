## Blocked by

- [001-config-schema](./001-config-schema.md)

## Question

How does the extension execute the configured shell command and determine pass/fail?

- What API does the extension use to run the command — `pi.exec()` from the ExtensionAPI, or `child_process` directly?
- How is stdout/stderr captured and structured for injection?
- What constitutes "pass" vs "fail" — exit code 0 only, or configurable exit codes? Should stdout pattern matching be supported?
- Is there a timeout for command execution? What happens if the command hangs?
- How is the working directory determined — the session's cwd, or configurable?
- Should environment variables be injectable from config?

## Resolution

**Execution API:** `pi.exec(command, args, opts)` from the ExtensionAPI. The command string from config is split into command + args (simple shell-token split). The `opts` object passes `cwd` from the guard config.

**Pass/fail criteria:** Exit code `0` = pass. Any non-zero exit code = fail. No configurable exit codes, no stdout pattern matching.

**Timeout behavior:** Each guard has a `timeout` field (default `60000`ms). If the command exceeds the timeout, the process is killed, treated as a failure, and the partial output (stdout + stderr captured so far) plus a timeout notice is injected.

**Output capture:** Both `stdout` and `stderr` are captured. For injection, they are concatenated: stdout first, then stderr. The `ExecResult` from `pi.exec()` provides both fields.

**Working directory:** The `cwd` field from the guard config (default `"."`) is resolved relative to the session's `ctx.cwd`. Passed to `pi.exec()` via the `opts.cwd` parameter.

**Environment variables:** Not supported in this version. The command inherits the extension's environment. (Ruled out in 001-config-schema.)
