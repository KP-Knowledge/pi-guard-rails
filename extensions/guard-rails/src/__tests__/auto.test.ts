import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = {
	exec: vi.fn(),
	readFileSync: vi.fn(),
	notify: vi.fn(),
	existsSync: vi.fn(() => true),
};

vi.mock("node:fs", () => ({
	readFileSync: mocks.readFileSync,
	existsSync: mocks.existsSync,
}));

const { registerAutoTrigger } = await import("../auto.ts");

type EventHandler = (event: any, ctx: any) => unknown | Promise<unknown>;

function makePi(): any {
	const handlers: Record<string, EventHandler> = {};
	return {
		on: vi.fn((name: string, handler: EventHandler) => {
			handlers[name] = handler;
		}),
		exec: mocks.exec,
		appendEntry: vi.fn(),
		_handlers: handlers,
	};
}

function makeCtx(): any {
	return {
		cwd: "/fake/project",
		ui: { notify: mocks.notify },
	};
}

const gitResult = (stdout: string) => ({ stdout, stderr: "", code: 0, killed: false });
const guardResult = (code: number, stdout = "", stderr = "") => ({
	stdout, stderr, code, killed: false,
});

function mockExecSequence(results: Array<Record<string, unknown>>): void {
	mocks.exec.mockImplementation((_cmd: string, args: string[]) =>
		Promise.resolve(
			args[1].includes("git rev-parse") && results.length > 1 && results[0].git
				? results.shift()!.git
				: results.shift()!,
		),
	);
}

function startSession(pi: any, baseline: string | null): Promise<void> {
	if (baseline === null) {
		mocks.exec.mockResolvedValueOnce({ stdout: "", stderr: "", code: 128, killed: false });
	} else {
		mocks.exec.mockResolvedValueOnce(gitResult(baseline));
	}
	return pi._handlers["session_start"]({ type: "session_start", reason: "startup" }, makeCtx());
}

const settle = (pi: any, outcome = "completed") =>
	pi._handlers["agent_before_settle"]({ type: "agent_before_settle", outcome }, makeCtx());

describe("registerAutoTrigger", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.existsSync.mockReturnValue(true);
		mocks.exec.mockReset();
	});

	it("registers session_start and agent_before_settle handlers", () => {
		const pi = makePi();
		registerAutoTrigger(pi);
		expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("agent_before_settle", expect.any(Function));
	});

	it("does nothing when no guards are configured", async () => {
		mocks.readFileSync.mockImplementation(() => {
			throw new Error("ENOENT");
		});
		const pi = makePi();
		registerAutoTrigger(pi);
		await startSession(pi, "clean");
		mocks.exec.mockClear();

		const result = await settle(pi);

		expect(result).toBeUndefined();
		expect(mocks.exec).not.toHaveBeenCalled();
		expect(mocks.notify).not.toHaveBeenCalled();
	});

	it("does nothing when auto is disabled in config", async () => {
		mocks.readFileSync.mockReturnValue(
			JSON.stringify({ auto: false, guards: [{ command: "npm test" }] }),
		);
		const pi = makePi();
		registerAutoTrigger(pi);
		await startSession(pi, "clean");
		mocks.exec.mockClear();

		const result = await settle(pi);

		expect(result).toBeUndefined();
		expect(mocks.exec).not.toHaveBeenCalled();
	});

	it("resets counters and skips when outcome is not completed", async () => {
		mocks.readFileSync.mockReturnValue(JSON.stringify([{ command: "npm test" }]));
		const pi = makePi();
		registerAutoTrigger(pi);
		await startSession(pi, "clean");
		mocks.exec.mockClear();

		const result = await settle(pi, "aborted");

		expect(result).toBeUndefined();
		expect(mocks.exec).not.toHaveBeenCalled();
	});

	it("notifies once and skips when the project is not a git repo", async () => {
		mocks.readFileSync.mockReturnValue(JSON.stringify([{ command: "npm test" }]));
		const pi = makePi();
		registerAutoTrigger(pi);
		await startSession(pi, null);
		mocks.exec.mockClear();

		await settle(pi);
		await settle(pi);

		expect(mocks.notify).toHaveBeenCalledTimes(1);
		expect(mocks.notify).toHaveBeenCalledWith(
			expect.stringContaining("git repository"),
			"warning",
		);
	});

	it("skips guards when the tree is unchanged since the baseline", async () => {
		mocks.readFileSync.mockReturnValue(JSON.stringify([{ command: "npm test" }]));
		const pi = makePi();
		registerAutoTrigger(pi);
		await startSession(pi, " M a.ts");
		mocks.exec.mockClear();
		mocks.exec.mockResolvedValueOnce(gitResult(" M a.ts"));

		const result = await settle(pi);

		expect(result).toBeUndefined();
		expect(mocks.exec).toHaveBeenCalledTimes(1);
		expect(mocks.exec).not.toHaveBeenCalledWith("sh", ["-c", "npm test"], expect.anything());
	});

	it("runs guards when the tree changed and returns continue on failure", async () => {
		mocks.readFileSync.mockReturnValue(JSON.stringify([{ command: "npm test", maxIterations: 3 }]));
		const pi = makePi();
		registerAutoTrigger(pi);
		await startSession(pi, "");
		mocks.exec.mockClear();
		// tree changed + guard fails
		mocks.exec
			.mockResolvedValueOnce(gitResult(" M a.ts"))
			.mockResolvedValueOnce(guardResult(1, "", "FAIL"));

		const result = await settle(pi);

		expect(mocks.exec).toHaveBeenCalledWith("sh", ["-c", "npm test"], expect.anything());
		expect(result.continue).toBe(true);
		const messages = result.entries.filter((e: any) => e.type === "custom_message");
		expect(messages).toHaveLength(1);
		expect(messages[0].customType).toBe("guard-rails-failure");
		expect(messages[0].content).toContain("iteration 1/3");
		expect(messages[0].content).toContain("FAIL");
		expect(messages[0].display).toBe(true);
	});

	it("updates the baseline and does not continue when all guards pass", async () => {
		mocks.readFileSync.mockReturnValue(JSON.stringify([{ command: "npm test" }]));
		const pi = makePi();
		registerAutoTrigger(pi);
		await startSession(pi, "");
		mocks.exec.mockClear();
		mocks.exec
			.mockResolvedValueOnce(gitResult(" M a.ts"))
			.mockResolvedValueOnce(guardResult(0, "ok"));

		const result = await settle(pi);

		expect(result.continue).toBeUndefined();
		expect(result.entries).toBeDefined();
		const summary = result.entries.filter((e: any) => e.type === "custom");
		expect(summary[summary.length - 1].data.lines[0]).toContain("All guards passed");

		// next settle with the same tree is a no-op
		mocks.exec.mockClear();
		mocks.exec.mockResolvedValueOnce(gitResult(" M a.ts"));
		const again = await settle(pi);
		expect(again).toBeUndefined();
	});

	it("does not continue when max iterations is reached", async () => {
		mocks.readFileSync.mockReturnValue(
			JSON.stringify([{ command: "npm test", maxIterations: 1 }]),
		);
		const pi = makePi();
		registerAutoTrigger(pi);
		await startSession(pi, "");
		mocks.exec.mockClear();
		mocks.exec
			.mockResolvedValueOnce(gitResult(" M a.ts"))
			.mockResolvedValueOnce(guardResult(1, "", "FAIL"));

		const result = await settle(pi);

		expect(result.continue).toBeUndefined();
		const messages = result.entries.filter((e: any) => e.type === "custom_message");
		expect(messages[0].content).toContain("max iterations (1) reached");
		expect(mocks.notify).toHaveBeenCalledWith(
			expect.stringContaining("max iterations"),
			"error",
		);
	});

	it("increments the iteration counter across settles while the tree still differs", async () => {
		mocks.readFileSync.mockReturnValue(JSON.stringify([{ command: "npm test", maxIterations: 3 }]));
		const pi = makePi();
		registerAutoTrigger(pi);
		await startSession(pi, "");
		mocks.exec.mockClear();

		mocks.exec
			.mockResolvedValueOnce(gitResult(" M a.ts"))
			.mockResolvedValueOnce(guardResult(1));
		const first = await settle(pi);
		expect(first.entries.filter((e: any) => e.type === "custom_message")[0].content)
			.toContain("iteration 1/3");

		// agent's fix changed the tree but still fails
		mocks.exec
			.mockResolvedValueOnce(gitResult(" M a.ts\n M b.ts"))
			.mockResolvedValueOnce(guardResult(1));
		const second = await settle(pi);
		expect(second.entries.filter((e: any) => e.type === "custom_message")[0].content)
			.toContain("iteration 2/3");
	});
});