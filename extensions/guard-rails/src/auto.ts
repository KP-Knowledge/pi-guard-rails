import type {
	AgentBeforeSettleEvent,
	BoundaryResult,
	CustomEntryDraft,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadGuardConfig } from "./config.ts";
import { readTreeState, type TreeState } from "./detect.ts";
import {
	buildFailureMessage,
	buildMaxIterationsMessage,
	createLoopState,
	evaluateGuards,
	resetCounters,
	type LoopState,
} from "./loop.ts";

interface AutoState {
	baseline: TreeState | undefined;
	loopState: LoopState;
	noGitNotified: boolean;
}

export const registerAutoTrigger = (pi: ExtensionAPI): void => {
	const auto: AutoState = {
		baseline: undefined,
		loopState: createLoopState(0),
		noGitNotified: false,
	};

	pi.on("session_start", async (_event, ctx) => {
		auto.baseline = await readTreeState(pi, ctx.cwd);
	});

	pi.on("agent_before_settle", async (event, ctx) =>
		handleSettle(pi, auto, event, ctx));
};

const handleSettle = async (
	pi: ExtensionAPI,
	auto: AutoState,
	event: AgentBeforeSettleEvent,
	ctx: ExtensionContext,
): Promise<BoundaryResult | undefined> => {
	if (event.outcome !== "completed") {
		resetCounters(auto.loopState);
		return undefined;
	}

	const { guards, auto: autoEnabled } = loadGuardConfig(ctx.cwd);
	if (!autoEnabled || guards.length === 0) {
		return undefined;
	}

	if (auto.baseline === null) {
		if (!auto.noGitNotified) {
			ctx.ui.notify(
				"[guard-rails] auto mode needs a git repository; staying off",
				"warning",
			);
			auto.noGitNotified = true;
		}
		return undefined;
	}

	const tree = await readTreeState(pi, ctx.cwd);
	if (tree === auto.baseline || tree === null) {
		return undefined;
	}

	if (auto.loopState.iterationCounts.length !== guards.length) {
		auto.loopState = createLoopState(guards.length);
	}

	const historyDrafts: CustomEntryDraft[] = [];
	const evalResult = await evaluateGuards(pi, guards, auto.loopState, ctx.ui, (data) => {
		historyDrafts.push({ type: "custom", customType: "guard-rails-history", data });
	});

	if (evalResult.status === "passed") {
		ctx.ui.notify("All guards passed", "info");
		historyDrafts.push({
			type: "custom",
			customType: "guard-rails-history",
			data: { lines: ["✓ All guards passed"] },
		});
		auto.baseline = tree;
		resetCounters(auto.loopState);
		return { entries: historyDrafts };
	}

	const message = evalResult.status === "failed"
		? buildFailureMessage(evalResult.result, evalResult.iteration)
		: buildMaxIterationsMessage(evalResult.result, evalResult.iteration);

	if (evalResult.status === "maxIterations") {
		ctx.ui.notify(
			`[guard-rails] max iterations (${evalResult.iteration}) reached for ${evalResult.result.guard.command}`,
			"error",
		);
		return {
			entries: [
				...historyDrafts,
				{
					type: "custom_message",
					customType: "guard-rails-failure",
					content: message,
					display: true,
				},
			],
		};
	}

	return {
		entries: [
			...historyDrafts,
			{
				type: "custom_message",
				customType: "guard-rails-failure",
				content: message,
				display: true,
			},
		],
		continue: true,
	};
};