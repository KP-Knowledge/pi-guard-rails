import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	createLoopState,
	resetCounters,
	runGuardLoop,
} from "../loop.ts";
import type { GuardConfig } from "../config.ts";

function makePi(): ExtensionAPI {
	return {
		exec: vi.fn(),
		sendUserMessage: vi.fn(),
		appendEntry: vi.fn(),
	} as unknown as ExtensionAPI;
}

function makeUi(): ExtensionUIContext {
	return { notify: vi.fn() } as unknown as ExtensionUIContext;
}

function makeGuard(overrides?: Partial<GuardConfig>): GuardConfig {
	return {
		command: "nx run test",
		cwd: ".",
		maxIterations: 3,
		timeout: 60000,
		...overrides,
	};
}

function mockExecPass(pi: ExtensionAPI): void {
	(pi.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
		stdout: "passed",
		stderr: "",
		code: 0,
		killed: false,
	});
}

function mockExecFail(pi: ExtensionAPI, stdout = "", stderr = "failing"): void {
	(pi.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
		stdout,
		stderr,
		code: 1,
		killed: false,
	});
}

describe("createLoopState", () => {
	it("creates state with zeroed iteration counts", () => {
		const state = createLoopState(3);
		expect(state.iterationCounts).toEqual([0, 0, 0]);
		expect(state.isRunningGuards).toBe(false);
	});

	it("creates state for zero guards", () => {
		const state = createLoopState(0);
		expect(state.iterationCounts).toEqual([]);
		expect(state.isRunningGuards).toBe(false);
	});
});

describe("resetCounters", () => {
	it("resets all counters to zero", () => {
		const state = createLoopState(3);
		state.iterationCounts = [2, 1, 3];
		resetCounters(state);
		expect(state.iterationCounts).toEqual([0, 0, 0]);
	});
});

describe("runGuardLoop", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does nothing and returns early if isRunningGuards is true", async () => {
		const pi = makePi();
		mockExecFail(pi);
		const guards = [makeGuard()];
		const state = createLoopState(1);
		state.isRunningGuards = true;
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);

		expect(pi.exec).not.toHaveBeenCalled();
		expect(ui.notify).not.toHaveBeenCalled();
	});

	it("does not inject when all guards pass", async () => {
		const pi = makePi();
		mockExecPass(pi);
		const guards = [makeGuard(), makeGuard({ command: "nx run lint" })];
		const state = createLoopState(2);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);

		expect(pi.exec).toHaveBeenCalledTimes(2);
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
		expect(state.iterationCounts).toEqual([0, 0]);
		// "All guards passed" is notified at the end
		expect(ui.notify).toHaveBeenCalledWith("All guards passed", "info");
	});

	it("appends guard config to history for each guard", async () => {
		const pi = makePi();
		mockExecPass(pi);
		const guards = [makeGuard(), makeGuard({ command: "nx run lint" })];
		const state = createLoopState(2);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);

		const appendEntry = pi.appendEntry as ReturnType<typeof vi.fn>;
		// called for each guard + final summary on success
		expect(appendEntry).toHaveBeenCalledTimes(3);
		const firstData = appendEntry.mock.calls[0][1] as { lines: string[] };
		expect(firstData.lines[0]).toContain("nx run test");
		expect(firstData.lines[0]).toContain("timeout: 60000ms");
		const secondData = appendEntry.mock.calls[1][1] as { lines: string[] };
		expect(secondData.lines).toHaveLength(1);
		expect(secondData.lines[0]).toContain("nx run lint");
		// final summary
		const finalData = appendEntry.mock.calls[2][1] as { lines: string[] };
		expect(finalData.lines[0]).toContain("All guards passed");
	});

	it("injects failure message and increments counter on first failure", async () => {
		const pi = makePi();
		mockExecFail(pi, "1 passing", "1 failing");
		const guards = [makeGuard()];
		const state = createLoopState(1);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);

		expect(pi.exec).toHaveBeenCalledTimes(1);
		expect(state.iterationCounts[0]).toBe(1);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		const msg = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(msg).toContain("iteration 1/3");
		expect(msg).toContain("nx run test");
		expect(msg).toContain("exit code 1");
		expect(msg).toContain("1 passing\n1 failing");
		expect(msg).toContain("Please fix");
	});

	it("injects max iterations message when limit is reached", async () => {
		const pi = makePi();
		mockExecFail(pi, "", "still failing");
		const guards = [makeGuard({ maxIterations: 2 })];
		const state = createLoopState(1);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);
		expect(state.iterationCounts[0]).toBe(1);

		state.isRunningGuards = false;
		await runGuardLoop(pi, guards, state, ui);
		expect(state.iterationCounts[0]).toBe(2);

		const msg = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[1][0];
		expect(msg).toContain("max iterations (2) reached");
		expect(msg).toContain("still failing");
		expect(msg).toContain("review the failures");
	});

	it("stops at first failing guard in a multi-guard config", async () => {
		const pi = makePi();
		(pi.exec as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ stdout: "lint ok", stderr: "", code: 0, killed: false })
			.mockResolvedValueOnce({ stdout: "", stderr: "tests failing", code: 1, killed: false });
		const guards = [
			makeGuard({ command: "nx run lint" }),
			makeGuard({ command: "nx run test" }),
		];
		const state = createLoopState(2);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);

		expect(pi.exec).toHaveBeenCalledTimes(2);
		expect(state.iterationCounts).toEqual([0, 1]);
		const msg = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(msg).toContain("nx run test");
		expect(msg).toContain("tests failing");
	});

	it("resets counters when all guards pass after a previous failure", async () => {
		const pi = makePi();
		mockExecFail(pi);
		const guards = [makeGuard()];
		const state = createLoopState(1);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);
		expect(state.iterationCounts[0]).toBe(1);

		state.isRunningGuards = false;
		mockExecPass(pi);
		await runGuardLoop(pi, guards, state, ui);
		expect(state.iterationCounts[0]).toBe(0);
	});

	it("includes timeout info in failure message when killed", async () => {
		const pi = makePi();
		(pi.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
			stdout: "partial",
			stderr: "",
			code: null,
			killed: true,
		});
		const guards = [makeGuard({ timeout: 5000 })];
		const state = createLoopState(1);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);

		const msg = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(msg).toContain("timed out after 5000ms");
	});

	it("clears isRunningGuards flag after completion", async () => {
		const pi = makePi();
		mockExecPass(pi);
		const guards = [makeGuard()];
		const state = createLoopState(1);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);
		expect(state.isRunningGuards).toBe(false);
	});

	it("clears isRunningGuards flag even on error", async () => {
		const pi = makePi();
		(pi.exec as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("exec crash"));
		const guards = [makeGuard()];
		const state = createLoopState(1);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);
		expect(state.isRunningGuards).toBe(false);
	});

	it("feeds failure back to agent session via sendUserMessage with followUp delivery", async () => {
		const pi = makePi();
		mockExecFail(pi, "1 passing", "1 failing");
		const guards = [makeGuard()];
		const state = createLoopState(1);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);

		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		const [content, options] = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(content).toContain("iteration 1/3");
		expect(options).toEqual({ deliverAs: "followUp" });
	});

	it("appends custom instructions to failure message when present", async () => {
		const pi = makePi();
		mockExecFail(pi, "1 passing", "1 failing");
		const guards = [makeGuard({ instructions: "Fix TypeScript errors first." })];
		const state = createLoopState(1);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);

		const msg = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(msg).toContain("Additional instructions:");
		expect(msg).toContain("Fix TypeScript errors first.");
	});

	it("does not append instructions section when guard has none", async () => {
		const pi = makePi();
		mockExecFail(pi, "1 passing", "1 failing");
		const guards = [makeGuard()];
		const state = createLoopState(1);
		const ui = makeUi();

		await runGuardLoop(pi, guards, state, ui);

		const msg = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(msg).not.toContain("Additional instructions:");
	});
});