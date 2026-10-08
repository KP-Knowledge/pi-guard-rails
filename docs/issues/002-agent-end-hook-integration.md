## Blocked by

- [001-config-schema](./001-config-schema.md)

> **Superseded:** resolved by [ADR-0001](../adr/0001-auto-trigger-hook.md) —
> `agent_end` was rejected in favor of `agent_before_settle` + git tree-state
> detection; the `willRetry` field assumed below does not exist in the API.

## Question

How does the extension integrate with the `agent_end` lifecycle hook? Specifically:

- How does the extension subscribe to `agent_end` (always-on, so this happens at extension load time)?
- What information does the extension extract from the `agent_end` event (messages, willRetry status)?
- Should the extension distinguish between "agent finished successfully" vs "agent exhausted retries" before deciding to run the guard command?
- How does the extension prevent re-entrancy — if the guard command injects a user message that triggers another agent_end, how do we avoid infinite loops outside the iteration count?
- What happens if the agent is aborted mid-session (user presses Escape)?

## Resolution

**Subscription:** The extension calls `pi.on("agent_end", handler)` at load time (in the factory function). The handler receives the `agent_end` event and the `ExtensionContext`.

**Gating — only on clean agent_end:**
- The handler checks the event for agent failure (retry-exhausted, aborted). If the agent did not finish cleanly, the handler does nothing.
- The `agent_end` event from `AgentSessionEvent` includes `willRetry: boolean`. If `willRetry` is `true`, skip — the agent will retry on its own.
- If the agent was aborted (user pressed Escape), the `ctx.signal` will be aborted. Check `ctx.signal?.aborted` — if true, reset state and skip.

**Re-entrancy guard:**
- A module-level boolean flag `inGuardLoop` is set to `true` before injecting any user message via `pi.sendUserMessage()`.
- At the start of the `agent_end` handler, if `inGuardLoop` is `true`, the handler returns immediately — this agent_end was triggered by our own injected message, so the loop logic (which is already running) handles it.
- The flag is cleared when the guard loop completes (all guards pass, or max iterations reached).

**Wait — actually, reconsider:** The `inGuardLoop` flag approach has a subtlety. When we inject a user message at agent_end, it triggers a new agent turn. That turn will produce its own `agent_end`. We need to catch that `agent_end` to run the guards again. So the flag should not block the next agent_end — it should prevent double-entry into the loop logic.

**Revised re-entrancy approach:**
- The `agent_end` handler runs the guard loop synchronously (within the handler). It runs all guards, checks results, and either injects a message (triggering a new turn) or stops.
- When a message is injected, the handler returns. The new turn runs, produces a new `agent_end`, and the handler fires again.
- The iteration counter (tracked per-guard) prevents infinite loops — not a flag.
- A separate `isRunningGuards` flag prevents re-entrancy only if `agent_end` fires while the guard command is still executing (edge case).

**Abort behavior:**
- If `ctx.signal?.aborted` is true at the start of the handler, reset all guard iteration counters to 0 and return. The next clean agent_end starts fresh.

**Multiple guards:**
- All guards run in sequence at each agent_end. All must pass for the loop to stop. If any guard fails, the first failing guard's output is injected as a user message, and the loop continues to the next iteration.
