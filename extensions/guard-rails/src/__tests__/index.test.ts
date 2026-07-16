import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = {
	exec: vi.fn(),
	sendUserMessage: vi.fn(),
	readFileSync: vi.fn(),
	notify: vi.fn(),
};

vi.mock("node:fs", () => ({
	readFileSync: mocks.readFileSync,
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({}));

const { default: guardRailsExtension } = await import("../index.ts");

type EventHandler = (event: any, ctx: any) => void | Promise<void>;

function makePi(): any {
	const handlers: Record<string, EventHandler> = {};
	return {
		on: vi.fn((event: string, handler: EventHandler) => {
			handlers[event] = handler;
		}),
		exec: mocks.exec,
		sendUserMessage: mocks.sendUserMessage,
		_handlers: handlers,
	};
}

function makeCtx(overrides?: any): any {
	return {
		isIdle: () => true,
		signal: undefined,
		ui: { notify: mocks.notify },
		...overrides,
	};
}

function loadGuards(config: unknown): void {
	mocks.readFileSync.mockReturnValue(JSON.stringify(config));
}

describe("guardRailsExtension", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("subscribes to agent_end and session_start events", () => {
		const pi = makePi();
		guardRailsExtension(pi);

		expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("agent_end", expect.any(Function));
	});

	it("does nothing on agent_end when no guards are configured", async () => {
		mocks.readFileSync.mockImplementation(() => {
			throw new Error("ENOENT");
		});

		const pi = makePi();
		guardRailsExtension(pi);

		pi._handlers["session_start"]({ type: "session_start" }, makeCtx());
		await pi._handlers["agent_end"]({ type: "agent_end", messages: [] }, makeCtx());

		expect(mocks.exec).not.toHaveBeenCalled();
		expect(mocks.sendUserMessage).not.toHaveBeenCalled();
	});

	it("runs guards on agent_end when config is present", async () => {
		loadGuards([{ command: "nx run test", maxIterations: 3, timeout: 60000, cwd: "." }]);
		mocks.exec.mockResolvedValue({ stdout: "ok", stderr: "", code: 0, killed: false });

		const pi = makePi();
		guardRailsExtension(pi);

		pi._handlers["session_start"]({ type: "session_start" }, makeCtx());
		await pi._handlers["agent_end"]({ type: "agent_end", messages: [] }, makeCtx());

		expect(mocks.exec).toHaveBeenCalledWith("nx", ["run", "test"], {
			cwd: ".",
			timeout: 60000,
		});
		expect(mocks.sendUserMessage).not.toHaveBeenCalled();
	});

	it("injects failure message when guard fails", async () => {
		loadGuards([{ command: "npm test", maxIterations: 3, timeout: 60000, cwd: "." }]);
		mocks.exec.mockResolvedValue({ stdout: "", stderr: "FAIL", code: 1, killed: false });

		const pi = makePi();
		guardRailsExtension(pi);

		pi._handlers["session_start"]({ type: "session_start" }, makeCtx());
		await pi._handlers["agent_end"]({ type: "agent_end", messages: [] }, makeCtx());

		expect(mocks.sendUserMessage).toHaveBeenCalledTimes(1);
		const msg = mocks.sendUserMessage.mock.calls[0][0];
		expect(msg).toContain("iteration 1/3");
		expect(msg).toContain("npm test");
		expect(msg).toContain("FAIL");
	});

	it("skips guard loop when signal is aborted", async () => {
		loadGuards([{ command: "npm test", maxIterations: 3, timeout: 60000, cwd: "." }]);
		mocks.exec.mockResolvedValue({ stdout: "ok", stderr: "", code: 0, killed: false });

		const pi = makePi();
		guardRailsExtension(pi);

		pi._handlers["session_start"]({ type: "session_start" }, makeCtx());
		const abortedCtx = makeCtx({ signal: { aborted: true } });
		await pi._handlers["agent_end"]({ type: "agent_end", messages: [] }, abortedCtx);

		expect(mocks.exec).not.toHaveBeenCalled();
	});

	it("does not re-enter guard loop when already running", async () => {
		loadGuards([{ command: "npm test", maxIterations: 3, timeout: 60000, cwd: "." }]);
		mocks.exec.mockResolvedValue({ stdout: "ok", stderr: "", code: 0, killed: false });

		const pi = makePi();
		guardRailsExtension(pi);

		pi._handlers["session_start"]({ type: "session_start" }, makeCtx());

		const ctx = makeCtx();
		const firstCall = pi._handlers["agent_end"]({ type: "agent_end", messages: [] }, ctx);
		await pi._handlers["agent_end"]({ type: "agent_end", messages: [] }, ctx);
		await firstCall;

		expect(mocks.exec).toHaveBeenCalledTimes(1);
	});

	it("resets counters on abort and runs fresh on next agent_end", async () => {
		loadGuards([{ command: "npm test", maxIterations: 2, timeout: 60000, cwd: "." }]);
		mocks.exec.mockResolvedValue({ stdout: "", stderr: "fail", code: 1, killed: false });

		const pi = makePi();
		guardRailsExtension(pi);

		pi._handlers["session_start"]({ type: "session_start" }, makeCtx());

		await pi._handlers["agent_end"]({ type: "agent_end", messages: [] }, makeCtx());
		expect(mocks.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(mocks.sendUserMessage.mock.calls[0][0]).toContain("iteration 1/2");

		const abortedCtx = makeCtx({ signal: { aborted: true } });
		await pi._handlers["agent_end"]({ type: "agent_end", messages: [] }, abortedCtx);

		await pi._handlers["agent_end"]({ type: "agent_end", messages: [] }, makeCtx());
		expect(mocks.sendUserMessage).toHaveBeenCalledTimes(2);
		expect(mocks.sendUserMessage.mock.calls[1][0]).toContain("iteration 1/2");
	});

	it("notifies config warnings via TUI on session_start", () => {
		writeMalformedConfig();

		const pi = makePi();
		guardRailsExtension(pi);

		pi._handlers["session_start"]({ type: "session_start" }, makeCtx());

		expect(mocks.notify).toHaveBeenCalled();
		expect(mocks.notify.mock.calls[0][0]).toContain("malformed JSON");
		expect(mocks.notify.mock.calls[0][1]).toBe("warning");
	});
});

function writeMalformedConfig(): void {
	mocks.readFileSync.mockReturnValue("{ not valid json");
}