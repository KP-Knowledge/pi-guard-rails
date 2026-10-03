import type {
	ExtensionAPI,
	ExtensionFactory,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { loadGuardConfig, type GuardConfig } from "./src/config.ts";
import { createLoopState, resetCounters, runGuardLoop, type LoopState } from "./src/loop.ts";
import { renderHistoryEntry } from "./src/history.ts";

const guardRailsExtension: ExtensionFactory = (pi: ExtensionAPI) => {
	console.log("[guard-rails] extension loaded");

	pi.registerEntryRenderer("guard-rails-history", renderHistoryEntry);

	const loadGuards = (cwd: string): { guards: GuardConfig[]; loopState: LoopState } => {
		const result = loadGuardConfig(cwd);
		const guards = result.guards;
		const loopState = createLoopState(guards.length);
		return { guards, loopState };
	};

	pi.registerCommand("guard", {
		description: "Run configured guard commands (lint/test/build) in a feedback loop",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			console.log("[guard-rails] /guard command invoked");

			const { guards, loopState } = loadGuards(ctx.cwd);

			if (guards.length === 0) {
				ctx.ui.notify("[guard-rails] no guards configured. Add a .guard-rails.json file.", "warning");
				return;
			}

			console.log(`[guard-rails] loaded ${guards.length} guard(s) from ${ctx.cwd}`);

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
				ctx.ui.notify(`[guard-rails] loop error: ${msg}`, "error");
			}
		},
	});
};

export default guardRailsExtension;