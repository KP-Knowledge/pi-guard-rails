import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = {
	exec: vi.fn(),
	sendUserMessage: vi.fn(),
	readFileSync: vi.fn(),
	notify: vi.fn(),
	existsSync: vi.fn(() => true),
};

vi.mock("node:fs", () => ({
	readFileSync: mocks.readFileSync,
	existsSync: mocks.existsSync,
}));

const { default: guardRailsExtension } = await import("../../index.ts");

type CommandHandler = (args: string, ctx: any) => void | Promise<void>;
type EventHandler = (event: any, ctx: any) => unknown | Promise<unknown>;

function makePi(): any {
	const commands: Record<string, CommandHandler> = {};
	const handlers: Record<string, EventHandler> = {};
	return {
		on: vi.fn((name: string, handler: EventHandler) => {
			handlers[name] = handler;
		}),
		registerCommand: vi.fn((name: string, options: { handler: CommandHandler }) => {
			commands[name] = options.handler;
		}),
		registerEntryRenderer: vi.fn(),
		registerMessageRenderer: vi.fn(),
		exec: mocks.exec,
		sendUserMessage: mocks.sendUserMessage,
		appendEntry: vi.fn(),
		_commands: commands,
		_handlers: handlers,
	};
}

function makeCtx(overrides?: any): any {
	return {
		cwd: "/fake/project",
		hasUI: true,
		isIdle: () => true,
		signal: undefined,
		ui: { confirm: vi.fn(), notify: mocks.notify },
		...overrides,
	};
}

function loadGuards(config: unknown): void {
	mocks.readFileSync.mockReturnValue(JSON.stringify(config));
}

describe("guardRailsExtension", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.existsSync.mockReturnValue(true);
	});

	it("registers the /guard command and auto-trigger handlers", () => {
		const pi = makePi();
		guardRailsExtension(pi);

		expect(pi.registerCommand).toHaveBeenCalledWith("guard", expect.any(Object));
		expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("agent_before_settle", expect.any(Function));
		expect(pi.registerEntryRenderer).toHaveBeenCalledWith(
			"guard-rails-history",
			expect.any(Function),
		);
		expect(pi.registerMessageRenderer).toHaveBeenCalledWith(
			"guard-rails-failure",
			expect.any(Function),
		);
	});

	it("does nothing when no guards are configured", async () => {
		mocks.readFileSync.mockImplementation(() => {
			throw new Error("ENOENT");
		});

		const pi = makePi();
		guardRailsExtension(pi);

		await pi._commands["guard"]("", makeCtx());

		expect(mocks.exec).not.toHaveBeenCalled();
		expect(mocks.sendUserMessage).not.toHaveBeenCalled();
		expect(mocks.notify).toHaveBeenCalledWith(
			expect.stringContaining("no guards configured"),
			"warning",
		);
	});

	it("runs guards when /guard is invoked with config present", async () => {
		loadGuards([{ command: "nx run test", maxIterations: 3, timeout: 60000, cwd: "." }]);
		mocks.exec.mockResolvedValue({ stdout: "ok", stderr: "", code: 0, killed: false });

		const pi = makePi();
		guardRailsExtension(pi);

		await pi._commands["guard"]("", makeCtx());

		expect(mocks.exec).toHaveBeenCalledWith("sh", ["-c", "nx run test"], {
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

		await pi._commands["guard"]("", makeCtx());

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

		await pi._commands["guard"]("", makeCtx({ signal: { aborted: true } }));

		expect(mocks.exec).not.toHaveBeenCalled();
	});

	it("notifies on loop error when runGuardLoop throws", async () => {
		loadGuards([{ command: "npm test", maxIterations: 3, timeout: 60000, cwd: "." }]);
		mocks.exec.mockResolvedValue({ stdout: "ok", stderr: "", code: 0, killed: false });

		const pi = makePi();
		(pi.appendEntry as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("entry crash");
		});
		guardRailsExtension(pi);

		await pi._commands["guard"]("", makeCtx());

		expect(mocks.notify).toHaveBeenCalledWith(
			expect.stringContaining("loop error"),
			"error",
		);
	});

	it("captures the git baseline on session_start", async () => {
		mocks.exec.mockResolvedValue({ stdout: "M file.ts", stderr: "", code: 0, killed: false });

		const pi = makePi();
		guardRailsExtension(pi);

		await pi._handlers["session_start"]({ type: "session_start", reason: "startup" }, makeCtx());

		expect(mocks.exec).toHaveBeenCalledTimes(1);
		const call = (mocks.exec as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(call[0]).toBe("sh");
		expect(call[1][1]).toContain("git rev-parse");
		expect(call[2]).toMatchObject({ cwd: "/fake/project" });
	});
});