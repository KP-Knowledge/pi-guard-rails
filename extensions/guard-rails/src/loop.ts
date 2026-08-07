import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { GuardConfig } from "./config.ts";
import { runGuard, formatOutput, type GuardResult } from "./guard.ts";

export interface LoopState {
  iterationCounts: number[];
  isRunningGuards: boolean;
}

export function createLoopState(guardCount: number): LoopState {
  return {
    iterationCounts: new Array(guardCount).fill(0),
    isRunningGuards: false,
  };
}

export function resetCounters(state: LoopState): void {
  state.iterationCounts.fill(0);
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

  state.isRunningGuards = true;

  ui.notify(`Running guards: ${guards.map(g => g.command).join(", ")}`, "info");

  try {
    for (let i = 0; i < guards.length; i++) {
      const guard = guards[i];
      pi.appendEntry("guard-rails-history", {
        lines: [`▸ ${guard.command}  (cwd: ${guard.cwd}, timeout: ${guard.timeout}ms, maxIter: ${guard.maxIterations})`],
      });
      ui.notify(`Running: ${guard.command}`, "info");
      const result = await runGuard(pi, guard);
      if (result.passed) {
        if (result.stdout) ui.notify(result.stdout, "info");
        continue;
      }

      state.iterationCounts[i]++;

      if (state.iterationCounts[i] >= guard.maxIterations) {
        if (result.stdout) ui.notify(result.stdout, "error");
        await injectMaxIterationsMessage(pi, result, state.iterationCounts[i]);
        return;
      }

      if (result.stdout) ui.notify(result.stdout, "warning");
      if (result.guard.instructions && result.guard.instructions.trim() !== "") {
        ui.notify(`Instructions: ${result.guard.instructions}`, "info");
      }
      await injectFailureMessage(pi, result, state.iterationCounts[i]);
      return;
    }

    ui.notify("All guards passed", "info");
    pi.appendEntry("guard-rails-history", { lines: ["✓ All guards passed"] });
    resetCounters(state);
  } finally {
    state.isRunningGuards = false;
  }
}

async function injectFailureMessage(
  pi: ExtensionAPI,
  result: GuardResult,
  current: number,
): Promise<void> {
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

  pi.sendUserMessage(lines.join("\n"), { deliverAs: "followUp" });
}

async function injectMaxIterationsMessage(
  pi: ExtensionAPI,
  result: GuardResult,
  iterations: number,
): Promise<void> {
  const output = formatOutput(result);
  const exitInfo = result.timedOut
    ? `timed out after ${result.guard.timeout}ms`
    : `exit code ${result.code}`;

  const message = [
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

  pi.sendUserMessage(message, { deliverAs: "followUp" });
}
