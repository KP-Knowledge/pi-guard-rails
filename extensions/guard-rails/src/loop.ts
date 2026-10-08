import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { GuardConfig } from "./config.ts";
import { runGuard, formatOutput, type GuardResult } from "./guard.ts";

export interface LoopState {
  iterationCounts: number[];
  isRunningGuards: boolean;
}

export type GuardEval =
  | { status: "passed"; iteration: 0 }
  | { status: "failed"; result: GuardResult; iteration: number }
  | { status: "maxIterations"; result: GuardResult; iteration: number };

export type AppendHistory = (data: { lines: string[] }) => void;

export function createLoopState(guardCount: number): LoopState {
  return {
    iterationCounts: new Array(guardCount).fill(0),
    isRunningGuards: false,
  };
}

export function resetCounters(state: LoopState): void {
  state.iterationCounts.fill(0);
}

export async function evaluateGuards(
  pi: ExtensionAPI,
  guards: GuardConfig[],
  state: LoopState,
  ui: Pick<ExtensionUIContext, "notify">,
  appendHistory: AppendHistory,
): Promise<GuardEval> {
  if (state.isRunningGuards || guards.length === 0) {
    return { status: "passed", iteration: 0 };
  }

  state.isRunningGuards = true;
  try {
    return await runFrom(0);
  } finally {
    state.isRunningGuards = false;
  }

  async function runFrom(index: number): Promise<GuardEval> {
    const guard = guards[index];
    appendHistory({
      lines: [`▸ ${guard.command}  (cwd: ${guard.cwd}, timeout: ${guard.timeout}ms, maxIter: ${guard.maxIterations})`],
    });
    ui.notify(`Running: ${guard.command}`, "info");
    const result = await runGuard(pi, guard);
    if (result.passed) {
      if (result.stdout) ui.notify(result.stdout, "info");
      const next = index + 1;
      return next < guards.length
        ? runFrom(next)
        : { status: "passed", iteration: 0 };
    }

    state.iterationCounts[index]++;
    const iteration = state.iterationCounts[index];
    return iteration >= guard.maxIterations
      ? { status: "maxIterations", result, iteration }
      : { status: "failed", result, iteration };
  }
}

export async function runGuardLoop(
  pi: ExtensionAPI,
  guards: GuardConfig[],
  state: LoopState,
  ui: ExtensionUIContext,
): Promise<void> {
  if (state.isRunningGuards) {
    return;
  }

  ui.notify(`Running guards: ${guards.map(g => g.command).join(", ")}`, "info");

  const evalResult = await evaluateGuards(pi, guards, state, ui, (data) => {
    pi.appendEntry("guard-rails-history", data);
  });

  if (evalResult.status === "passed") {
    ui.notify("All guards passed", "info");
    pi.appendEntry("guard-rails-history", { lines: ["✓ All guards passed"] });
    resetCounters(state);
    return;
  }

  const message = evalResult.status === "failed"
    ? buildFailureMessage(evalResult.result, evalResult.iteration)
    : buildMaxIterationsMessage(evalResult.result, evalResult.iteration);
  pi.sendUserMessage(message, { deliverAs: "followUp" });
}

export function buildFailureMessage(result: GuardResult, current: number): string {
  const output = formatOutput(result);
  const exitInfo = result.timedOut
    ? `timed out after ${result.guard.timeout}ms`
    : `exit code ${result.code}`;

  const lines = [
    `--- Guard Rails: iteration ${current}/${result.guard.maxIterations} ---`,
    `Command: ${result.guard.command} (${exitInfo})`,
    "",
    "Output:",
    output,
    "",
    "Please fix the failing command output above and try again.",
  ];

  if (result.guard.instructions && result.guard.instructions.trim() !== "") {
    lines.push("", "Additional instructions:", result.guard.instructions);
  }

  return lines.join("\n");
}

export function buildMaxIterationsMessage(result: GuardResult, iterations: number): string {
  const output = formatOutput(result);
  const exitInfo = result.timedOut
    ? `timed out after ${result.guard.timeout}ms`
    : `exit code ${result.code}`;

  return [
    `--- Guard Rails: max iterations (${iterations}) reached ---`,
    `Command: ${result.guard.command} (${exitInfo})`,
    "",
    `The guard command has not passed after ${iterations} iterations. Here is the last output:`,
    "",
    "Output:",
    output,
    "",
    "Please review the failures and fix them manually.",
  ].join("\n");
}