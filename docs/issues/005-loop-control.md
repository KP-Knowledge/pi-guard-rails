## Blocked by

- [001-config-schema](./001-config-schema.md)
- [002-agent-end-hook-integration](./002-agent-end-hook-integration.md)
- [004-failure-injection](./004-failure-injection.md)

## Question

How does the extension control the iteration loop — counting iterations, enforcing the max, and handling the terminal case?

- How is the iteration counter tracked — a simple variable in the extension's module scope, or something persisted?
- What happens when max iterations is reached and the command still fails — does the extension inject a final summary? Does it stop silently?
- Should the extension notify the user (toast, status bar) about iteration progress?
- Should there be a way for the user to manually break the loop (e.g., a keyboard shortcut or slash command)?
- What is the default max iteration count? Is 0 a valid value (meaning "run once, report, don't loop")?
- Should there be a cooldown/delay between iterations to avoid thrashing?

## Resolution

**Counter scope:** Per-guard iteration counters in module scope. Each guard object gets its own counter that tracks how many times that specific guard has failed in the current loop. Counters are stored in a `Map<GuardConfig, number>` or a parallel array.

**Counter reset:** All counters reset to 0 when a fresh `agent_end` happens from a user-initiated turn (i.e., not triggered by our own `pi.sendUserMessage()` injection). The `isRunningGuards` flag from 002 distinguishes the two cases: if the flag is false at the start of `agent_end`, it's a fresh turn — reset counters.

**Max iterations reached:** Inject a final summary message via `pi.sendUserMessage()`:

```
--- Guard Rails: max iterations ({max}) reached ---
Command: {command} (exit code {exitCode})

The guard command has not passed after {max} iterations. Here is the last output:

Output:
{stdout + stderr}

Please review the failures and fix them manually.
```

Then stop the loop. The `isRunningGuards` flag is cleared.

**Default max iterations:** `3` (already set in 001-config-schema).

**Is 0 valid?** No — `maxIterations` must be >= 1. If 0 or negative is in the config, treat it as the default (3). This is a validation step during config loading.

**User break:** No explicit break mechanism. The user presses Escape to abort the agent, which resets all counters and stops the loop (per 002-agent-end-hook-integration). No slash command, no keyboard shortcut.

**Cooldown/delay:** No delay between iterations. The agent should fix and retry immediately.

**All guards pass:** When all guards pass in a single iteration, the loop stops. The `isRunningGuards` flag is cleared. No success message is injected — the agent session simply ends normally.
