import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { loadGuardConfig, type GuardConfig } from "./config.ts";
import { createLoopState, resetCounters, runGuardLoop, type LoopState } from "./loop.ts";

const guardRailsExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  console.log("[guard-rails] extension loaded");
  let guards: GuardConfig[] = [];
  let loopState: LoopState = createLoopState(0);

  pi.on("session_start", (_event, ctx) => {
    const cwd = process.cwd();
    const result = loadGuardConfig(cwd);
    guards = result.guards;
    loopState = createLoopState(guards.length);
    console.log(`[guard-rails] loaded ${guards.length} guard(s) from ${cwd}`);
    for (const warning of result.warnings) {
      ctx.ui.notify(warning, "warning");
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    console.log("[guard-rails] agent_end fired");

    if (guards.length === 0) {
      console.log("[guard-rails] no guards configured, skipping");
      return;
    }

    if (ctx.signal?.aborted) {
      console.log("[guard-rails] agent aborted, resetting counters");
      resetCounters(loopState);
      return;
    }

    if (loopState.isRunningGuards) {
      console.log("[guard-rails] guards already running, skipping re-entrant call");
      return;
    }

    console.log("[guard-rails] running guard loop...");
    try {
      await runGuardLoop(pi, guards, loopState, ctx.ui);
      console.log("[guard-rails] guard loop completed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[guard-rails] loop error: ${msg}`);
    }
  });
};

export default guardRailsExtension;
