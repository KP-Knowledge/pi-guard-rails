## Blocked by

- [002-agent-end-hook-integration](./002-agent-end-hook-integration.md)
- [003-command-execution](./003-command-execution.md)

## Question

When the guard command fails, how is the failure output formatted and injected back into the session?

- What format should the injected user message take? Raw command output, or a structured preamble + output?
- Should the message include metadata (iteration count, command that was run, exit code, duration)?
- Should the message instruct the agent on what to do (e.g. "Fix the failing tests above") or just present the facts?
- How does the extension inject the message — `pi.sendUserMessage()`?
- Should the extension wait for the agent to become idle before injecting?
- What happens to the injected message in the session history — is it visible to the user? Should it be?

## Resolution

**Message format:** Structured preamble with metadata + raw output. The injected user message looks like:

```
--- Guard Rails: iteration {current}/{max} ---
Command: {command} (exit code {exitCode})

Output:
{stdout + stderr concatenated}

Please fix the failing command output above and try again.
```

For timeout failures, the preamble includes `(timed out after {timeout}ms)` instead of the exit code, and the output is whatever was captured before the kill.

**Injection API:** `pi.sendUserMessage(content)` — sends the formatted message as a user message, which triggers a new agent turn. The message is visible in the session history to the user (it's a user message, not a hidden injection).

**Idle wait:** Call `ctx.waitForIdle()` before injecting. Although `agent_end` means the agent finished, `waitForIdle()` is a safety check to ensure no streaming is in progress.

**Output truncation:** No truncation. The full command output (stdout + stderr) is injected as-is. The agent's own context management (compaction) handles context overflow.

**Multiple guards:** When multiple guards are configured and one fails, only the first failing guard's output is injected (per the decision in 002 — all guards run in sequence, first failure stops the round and triggers the next iteration).
