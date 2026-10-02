import type {
	ExtensionAPI,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileReader } from "../config.ts";
import {
	createBranchGuardExtension,
	createBranchGuardExtensionWithIntent,
} from "../../index.ts";
import type { IntentSummarizer } from "../intent.ts";

interface ExecCall {
	command: string;
	args: string[];
	options: { cwd?: string; timeout?: number };
}

interface PiHarness {
	pi: ExtensionAPI;
	handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
	execCalls: ExecCall[];
}

const missingFileReader: FileReader = async () => {
	throw new Error("ENOENT");
};

const configReader =
	(json: unknown): FileReader =>
	async () =>
		JSON.stringify(json);

function makePi(execImpl?: (call: ExecCall) => unknown): PiHarness {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const execCalls: ExecCall[] = [];
	const pi = {
		events: { emit: vi.fn() },
		registerCommand: vi.fn(),
		sendUserMessage: vi.fn(),
		on: vi.fn(
			(event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
				handlers.set(event, handler);
			},
		),
		exec: vi.fn(async (command: string, args: string[], options: any) => {
			const call = { command, args, options };
			execCalls.push(call);
			return (
				(
					execImpl ??
					(async () => ({ stdout: "", stderr: "", code: 0, killed: false }))
				)(call) ?? {
					stdout: "",
					stderr: "",
					code: 0,
					killed: false,
				}
			);
		}),
	} as unknown as ExtensionAPI;
	return { pi, handlers, execCalls };
}

interface GitScriptOptions {
	branch?: string;
	dirty?: boolean | (() => boolean);
	existingBranches?: readonly string[];
}

const gitScript = (options: GitScriptOptions = {}) => {
	const branchCell = { current: options.branch ?? "main" };
	const existing = new Set(options.existingBranches ?? []);
	const isDirty = (): boolean =>
		typeof options.dirty === "function"
			? options.dirty()
			: (options.dirty ?? false);
	return (
		call: ExecCall,
	): { stdout: string; stderr: string; code: number; killed: boolean } => {
		if (call.args[0] === "rev-parse") {
			return {
				stdout: `${branchCell.current}\n`,
				stderr: "",
				code: 0,
				killed: false,
			};
		}
		if (call.args[0] === "status") {
			return {
				stdout: isDirty() ? " M src/a.ts\n" : "",
				stderr: "",
				code: 0,
				killed: false,
			};
		}
		if (call.args[0] === "show-ref") {
			const ref = call.args[3] ?? "";
			return existing.has(ref.replace(/^refs\/heads\//, ""))
				? { stdout: "", stderr: "", code: 0, killed: false }
				: { stdout: "", stderr: "", code: 1, killed: false };
		}
		if (call.args[0] === "checkout") {
			branchCell.current = call.args[2];
			return { stdout: "", stderr: "", code: 0, killed: false };
		}
		return { stdout: "", stderr: "", code: 0, killed: false };
	};
};

const messageEntry = (
	role: string,
	content: unknown,
	id: string,
): SessionEntry =>
	({
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-09-24T00:00:00.000Z",
		message: { role, content, timestamp: 0 },
	}) as unknown as SessionEntry;

interface CtxOverrides {
	hasUI?: boolean;
	cwd?: string;
	entries?: SessionEntry[];
	selectChoice?: (title: string, options: string[]) => string | undefined;
	model?: unknown;
	complete?: (model: unknown, request: any) => Promise<unknown>;
}

function makeCtx(overrides: CtxOverrides = {}) {
	return {
		ui: {
			select: vi.fn((_title: string, options: string[]) =>
				Promise.resolve(
					overrides.selectChoice
						? overrides.selectChoice(_title, options)
						: options[0],
				),
			),
			notify: vi.fn(),
			confirm: vi.fn().mockResolvedValue(true),
		},
		hasUI: overrides.hasUI ?? true,
		mode: "tui" as const,
		cwd: overrides.cwd ?? "/repo",
		sessionManager: {
			getCwd: vi.fn().mockReturnValue(overrides.cwd ?? "/repo"),
			getEntries: vi.fn().mockReturnValue(overrides.entries ?? []),
		},
		model: overrides.model,
		modelRegistry: {
			complete: vi.fn(overrides.complete ?? (async () => ({ content: [] }))),
		},
	};
}

const dispatch = (
	harness: PiHarness,
	event: Record<string, unknown> & { type: string },
	ctx: unknown,
): Promise<unknown> =>
	Promise.resolve(harness.handlers.get(event.type)?.(event, ctx));

const dispatchTimes = async (
	harness: PiHarness,
	count: number,
	event: Record<string, unknown> & { type: string },
	ctx: unknown,
): Promise<void> => {
	await Array.from({ length: count }).reduce<Promise<void>>(
		async (chain, _unused) => {
			await chain;
			await dispatch(harness, event, ctx);
		},
		Promise.resolve(),
	);
};

const toolCall = (toolName: string) => ({
	type: "tool_call",
	toolCallId: "call-1",
	toolName,
	input: {},
});

const editToolCall = (): {
	type: "tool_call";
	toolCallId: string;
	toolName: "edit";
	input: Record<string, unknown>;
} => ({
	type: "tool_call",
	toolCallId: "call-1",
	toolName: "edit",
	input: { file_path: "/repo/a.ts", old_string: "a", new_string: "b" },
});

describe("branchGuardExtension registration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("registers the /branch command with a description", () => {
		const harness = makePi();
		createBranchGuardExtension(missingFileReader)(harness.pi);

		expect(harness.pi.registerCommand).toHaveBeenCalledWith(
			"branch",
			expect.objectContaining({ description: expect.any(String) }),
		);
	});

	it("subscribes to before_agent_start, tool_call and agent_settled", () => {
		const harness = makePi();
		createBranchGuardExtension(missingFileReader)(harness.pi);

		const events = (harness.pi.on as any).mock.calls.map(
			([event]: [string]) => event,
		);
		expect(events).toContain("before_agent_start");
		expect(events).toContain("tool_call");
		expect(events).toContain("agent_settled");
	});
});

describe("branch guard in auto mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.HERDR_ENV;
	});

	it("creates the proposed branch before an edit lands and leaves the call unblocked", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(harness, editToolCall(), ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/login-bug"]);
		expect(checkout?.options?.cwd).toBe("/repo");
		expect(result).not.toEqual(expect.objectContaining({ block: true }));
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("fix/login-bug"),
			"info",
		);
	});

	it("sends a Herdr notification after creating a branch in Herdr", async () => {
		process.env.HERDR_ENV = "1";
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await dispatch(harness, editToolCall(), ctx);

		expect(harness.execCalls).toContainEqual(
			expect.objectContaining({
				command: "herdr",
				args: [
					"notification",
					"show",
					"Branch guard",
					"--body",
					"Created and switched to fix/login-bug.",
					"--sound",
					"done",
				],
				options: { cwd: "/repo", timeout: 5000 },
			}),
		);
	});

	it("also guards write tool calls", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Add the readme",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(
			harness,
			{ type: "tool_call", toolCallId: "c1", toolName: "write", input: {} },
			ctx,
		);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "docs/add-readme"]);
		expect(result).not.toEqual(expect.objectContaining({ block: true }));
	});

	it("stays silent for non-modifying tool calls", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await dispatch(harness, toolCall("read"), ctx);
		await dispatch(harness, toolCall("bash"), ctx);
		await dispatch(harness, toolCall("grep"), ctx);

		expect(
			harness.execCalls.filter((call) => call.args[0] === "checkout"),
		).toEqual([]);
	});

	it("stays silent on a non-protected branch", async () => {
		const harness = makePi(gitScript({ branch: "feat/already-branched" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await dispatch(harness, editToolCall(), ctx);

		expect(
			harness.execCalls.filter((call) => call.args[0] === "checkout"),
		).toEqual([]);
	});

	it("stays silent on wt/* worktree branches even when configured as protected", async () => {
		const harness = makePi(gitScript({ branch: "wt/fix-login-bug" }));
		createBranchGuardExtension(
			configReader({
				mode: "auto",
				protectedBranches: ["main", "wt/fix-login-bug"],
			}),
		)(harness.pi);
		const ctx = makeCtx();

		await dispatch(harness, editToolCall(), ctx);

		expect(
			harness.execCalls.filter((call) => call.args[0] === "checkout"),
		).toEqual([]);
	});

	it("stays silent when the guard is disabled", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ enabled: false, mode: "auto" }))(
			harness.pi,
		);
		const ctx = makeCtx();

		await dispatch(harness, editToolCall(), ctx);

		expect(harness.execCalls).toEqual([]);
	});

	it("falls back to the latest user entry when no prompt was captured", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx({
			entries: [
				messageEntry("user", "Fix the login bug", "1"),
				messageEntry("assistant", "on it", "2"),
			],
		});

		await dispatch(harness, editToolCall(), ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/login-bug"]);
	});

	it("does not recreate a branch after the guard already moved off the protected branch", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await dispatch(harness, editToolCall(), ctx);
		await dispatch(
			harness,
			{ type: "tool_call", toolCallId: "c2", toolName: "edit", input: {} },
			ctx,
		);

		const checkouts = harness.execCalls.filter(
			(call) => call.args[0] === "checkout",
		);
		expect(checkouts).toHaveLength(1);
	});

	it("proceeds unprotected with a warning when the prompt yields no branch name", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "!!!",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(harness, editToolCall(), ctx);

		expect(
			harness.execCalls.filter((call) => call.args[0] === "checkout"),
		).toEqual([]);
		expect(result).not.toEqual(expect.objectContaining({ block: true }));
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("branch name"),
			"warning",
		);
	});
});

describe("branch guard in ask mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("proposes the branch in a two-option dialog and creates it when accepted", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "ask" }))(harness.pi);
		const ctx = makeCtx({
			selectChoice: (_title, options) => options[0],
		});

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(harness, editToolCall(), ctx);

		expect((harness.pi.events.emit as any)).toHaveBeenCalledWith(
			"herdr:blocked",
			{ active: true, label: "Confirm to create branch fix/login-bug" },
		);
		expect(ctx.ui.select).toHaveBeenCalledWith("Branch guard", [
			"Create branch fix/login-bug",
			"Proceed unprotected on main (this session)",
		]);
		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/login-bug"]);
		expect(result).not.toEqual(expect.objectContaining({ block: true }));
	});

	it("declining sets the session skip and never blocks the edit", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "ask" }))(harness.pi);
		const ctx = makeCtx({
			selectChoice: (_title, options) => options[1],
		});

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const first = await dispatch(harness, editToolCall(), ctx);
		const second = await dispatch(
			harness,
			{ type: "tool_call", toolCallId: "c2", toolName: "write", input: {} },
			ctx,
		);

		expect(first).not.toEqual(expect.objectContaining({ block: true }));
		expect(second).not.toEqual(expect.objectContaining({ block: true }));
		expect(
			harness.execCalls.filter((call) => call.args[0] === "checkout"),
		).toEqual([]);
		expect(ctx.ui.select).toHaveBeenCalledTimes(1);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("unprotected"),
			"warning",
		);
	});

	it("headless ask mode blocks the modifying call with a remediation reason", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "ask" }))(harness.pi);
		const ctx = makeCtx({ hasUI: false });

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(harness, editToolCall(), ctx);

		expect(result).toEqual(
			expect.objectContaining({
				block: true,
				reason: expect.stringContaining("auto"),
			}),
		);
		expect(
			harness.execCalls.filter((call) => call.args[0] === "checkout"),
		).toEqual([]);
	});

	it("blocks with a remediation hint when the proposed name collides", async () => {
		const harness = makePi(
			gitScript({
				branch: "main",
				existingBranches: ["fix/login-bug"],
			}),
		);
		createBranchGuardExtension(configReader({ mode: "ask" }))(harness.pi);
		const ctx = makeCtx({
			selectChoice: (_title, options) => options[0],
		});

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(harness, editToolCall(), ctx);

		expect(result).toEqual(
			expect.objectContaining({
				block: true,
				reason: expect.stringContaining("/branch"),
			}),
		);
	});
});

describe("commit lifecycle on agent_settled", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const guardCreatesBranch = async (
		harness: PiHarness,
		ctx: Record<string, unknown>,
		prompt = "Fix the login bug",
	): Promise<void> => {
		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt,
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await dispatch(harness, editToolCall(), ctx);
	};

	it("nudges summarize-and-commit when the tree is dirty on a guard-created branch", async () => {
		const harness = makePi(gitScript({ branch: "main", dirty: true }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await guardCreatesBranch(harness, ctx);
		await dispatch(harness, { type: "agent_settled" }, ctx);

		expect(harness.pi.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("summar"),
			expect.anything(),
		);
	});

	it("stays quiet when the tree is clean", async () => {
		const harness = makePi(gitScript({ branch: "main", dirty: false }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await guardCreatesBranch(harness, ctx);
		await dispatch(harness, { type: "agent_settled" }, ctx);

		expect(harness.pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("stays quiet on a branch the guard did not create", async () => {
		const harness = makePi(
			gitScript({ branch: "feat/someone-else", dirty: true }),
		);
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await dispatch(harness, { type: "agent_settled" }, ctx);

		expect(harness.pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("stays quiet on wt/* branches", async () => {
		const harness = makePi(
			gitScript({ branch: "wt/fix-login-bug", dirty: true }),
		);
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await dispatch(harness, { type: "agent_settled" }, ctx);

		expect(harness.pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("stays quiet when the lifecycle is disabled", async () => {
		const harness = makePi(gitScript({ branch: "main", dirty: true }));
		createBranchGuardExtension(
			configReader({ mode: "auto", commitOnSettle: false }),
		)(harness.pi);
		const ctx = makeCtx();

		await guardCreatesBranch(harness, ctx);
		await dispatch(harness, { type: "agent_settled" }, ctx);

		expect(harness.pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("nudges at most 3 times, then tells the user to commit manually once", async () => {
		const harness = makePi(gitScript({ branch: "main", dirty: true }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await guardCreatesBranch(harness, ctx);
		await dispatchTimes(harness, 5, { type: "agent_settled" }, ctx);

		const nudges = (harness.pi.sendUserMessage as any).mock.calls.filter(
			([content]: [unknown]) =>
				typeof content === "string" && content.includes("summar"),
		);
		expect(nudges).toHaveLength(3);
		const exhaustionWarnings = (ctx.ui.notify as any).mock.calls.filter(
			([message, kind]: [string, string]) =>
				message.includes("manually") && kind === "warning",
		);
		expect(exhaustionWarnings).toHaveLength(1);
	});

	it("stays quiet on a clean tree even after attempts were exhausted", async () => {
		const dirtyCell = { current: true };
		const harness = makePi(
			gitScript({ branch: "main", dirty: () => dirtyCell.current }),
		);
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await guardCreatesBranch(harness, ctx);
		await dispatchTimes(harness, 5, { type: "agent_settled" }, ctx);

		dirtyCell.current = false;
		await dispatch(harness, { type: "agent_settled" }, ctx);

		const exhaustionWarnings = (ctx.ui.notify as any).mock.calls.filter(
			([message, kind]: [string, string]) =>
				message.includes("manually") && kind === "warning",
		);
		expect(exhaustionWarnings).toHaveLength(1);
	});

	it("stays quiet when the agent commits after the last nudge", async () => {
		const dirtyCell = { current: true };
		const harness = makePi(
			gitScript({ branch: "main", dirty: () => dirtyCell.current }),
		);
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx();

		await guardCreatesBranch(harness, ctx);
		await dispatchTimes(harness, 3, { type: "agent_settled" }, ctx);
		expect(
			(harness.pi.sendUserMessage as any).mock.calls.filter(
				([content]: [unknown]) =>
					typeof content === "string" && content.includes("summar"),
			),
		).toHaveLength(3);

		dirtyCell.current = false;
		await dispatch(harness, { type: "agent_settled" }, ctx);

		expect(
			(ctx.ui.notify as any).mock.calls.filter(([message]: [string]) =>
				message.includes("manually"),
			),
		).toHaveLength(0);
	});
});

describe("headless auto mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates the branch without a dialog", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx({ hasUI: false });

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(harness, editToolCall(), ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/login-bug"]);
		expect(result).not.toEqual(expect.objectContaining({ block: true }));
		expect(ctx.ui.select).not.toHaveBeenCalled();
	});
});

describe("intent summarization wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const summarizeAs =
		(phrase: string): IntentSummarizer =>
		async () => phrase;

	const failingSummarizer: IntentSummarizer = async () => {
		throw new Error("no credentials for provider");
	};

	it("names the branch from the model-produced phrase, not the raw prompt", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtensionWithIntent(
			configReader({ mode: "auto" }),
			summarizeAs("stale cart totals"),
		)(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "the cart page shows wrong totals when items expire",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await dispatch(harness, editToolCall(), ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "feat/stale-cart-totals"]);
	});

	it("prefers the phrase type over the prompt when they disagree", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtensionWithIntent(
			configReader({ mode: "auto" }),
			summarizeAs("fix stale cart totals"),
		)(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "add a new cart page",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await dispatch(harness, editToolCall(), ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/stale-cart-totals"]);
	});

	it("falls back to heuristics silently when the model call fails", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtensionWithIntent(
			configReader({ mode: "auto" }),
			failingSummarizer,
		)(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(harness, editToolCall(), ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/login-bug"]);
		expect(result).not.toEqual(expect.objectContaining({ block: true }));
		const errorNotices = (ctx.ui.notify as any).mock.calls.filter(
			([, kind]: [string, string]) => kind === "error",
		);
		expect(errorNotices).toEqual([]);
	});

	it("does not call the summarizer for non-modifying tool calls", async () => {
		const calls: string[] = [];
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtensionWithIntent(configReader({ mode: "auto" }), async (p) => {
			calls.push(p);
			return "whatever";
		})(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await dispatch(harness, toolCall("read"), ctx);

		expect(calls).toEqual([]);
	});

	it("does not call the summarizer when the guard is disabled", async () => {
		const calls: string[] = [];
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtensionWithIntent(
			configReader({ enabled: false, mode: "auto" }),
			async (p) => {
				calls.push(p);
				return "whatever";
			},
		)(harness.pi);
		const ctx = makeCtx();

		await dispatch(harness, editToolCall(), ctx);

		expect(calls).toEqual([]);
	});

	it("names the /branch command from the given task via the summarizer", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtensionWithIntent(
			configReader({}),
			summarizeAs("stale cart totals"),
		)(harness.pi);
		const ctx = makeCtx();

		const [, opts] = (harness.pi.registerCommand as any).mock.calls[0];
		await opts.handler("the cart totals are wrong when items expire", ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "feat/stale-cart-totals"]);
	});

	it("still branches from the task when the summarizer fails", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtensionWithIntent(configReader({}), failingSummarizer)(
			harness.pi,
		);
		const ctx = makeCtx();

		const [, opts] = (harness.pi.registerCommand as any).mock.calls[0];
		await opts.handler("Fix the login bug", ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/login-bug"]);
	});
});

describe("production intent binding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("summarizes through the session model registry", async () => {
		const completeCalls: unknown[] = [];
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx({
			model: { id: "session-model" },
			complete: async (_model, request) => {
				completeCalls.push(request);
				return {
					content: [{ type: "text", text: "stale cart totals" }],
					stopReason: "stop",
				};
			},
		});

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "the cart totals are wrong when items expire",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await dispatch(harness, editToolCall(), ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "feat/stale-cart-totals"]);
		expect(completeCalls).toHaveLength(1);
		expect((completeCalls[0] as any).messages[0].content).toContain(
			"the cart totals are wrong when items expire",
		);
	});

	it("falls back to heuristics when the session has no model", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx({ model: undefined });

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(harness, editToolCall(), ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/login-bug"]);
		expect(result).not.toEqual(expect.objectContaining({ block: true }));
	});

	it("falls back to heuristics when the provider call rejects", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({ mode: "auto" }))(harness.pi);
		const ctx = makeCtx({
			model: { id: "session-model" },
			complete: async () => {
				throw new Error("no credentials for provider");
			},
		});

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Fix the login bug",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		const result = await dispatch(harness, editToolCall(), ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/login-bug"]);
		expect(result).not.toEqual(expect.objectContaining({ block: true }));
	});
});

describe("/branch command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const getCommand = (
		harness: PiHarness,
	): { handler: (args: string, ctx: unknown) => Promise<void> } => {
		const [, opts] = (harness.pi.registerCommand as any).mock.calls[0];
		return opts;
	};

	it("creates a typed branch from the given task", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({}))(harness.pi);
		const ctx = makeCtx();

		await getCommand(harness).handler("Fix the login bug", ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "fix/login-bug"]);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("fix/login-bug"),
			"info",
		);
	});

	it("names from the captured prompt when called bare", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({}))(harness.pi);
		const ctx = makeCtx();

		await dispatch(
			harness,
			{
				type: "before_agent_start",
				prompt: "Add dark mode",
				systemPrompt: "",
				systemPromptOptions: {} as any,
			},
			ctx,
		);
		await getCommand(harness).handler("", ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "feat/add-dark-mode"]);
	});

	it("falls back to the latest user entry when no prompt was captured", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({}))(harness.pi);
		const ctx = makeCtx({
			entries: [messageEntry("user", "Update the readme", "1")],
		});

		await getCommand(harness).handler("", ctx);

		const checkout = harness.execCalls.find(
			(call) => call.args[0] === "checkout",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "docs/update-readme"]);
	});

	it("rejects with usage when no task resolves", async () => {
		const harness = makePi(gitScript({ branch: "main" }));
		createBranchGuardExtension(configReader({}))(harness.pi);
		const ctx = makeCtx();

		await getCommand(harness).handler("", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Usage"),
			"error",
		);
	});

	it("reports collision errors without creating anything", async () => {
		const harness = makePi(
			gitScript({
				branch: "main",
				existingBranches: ["fix/login-bug"],
			}),
		);
		createBranchGuardExtension(configReader({}))(harness.pi);
		const ctx = makeCtx();

		await getCommand(harness).handler("Fix the login bug", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("already exists"),
			"error",
		);
		expect(
			harness.execCalls.filter((call) => call.args[0] === "checkout"),
		).toEqual([]);
	});

	it("records the branch for the commit lifecycle", async () => {
		const harness = makePi(gitScript({ branch: "main", dirty: true }));
		createBranchGuardExtension(configReader({}))(harness.pi);
		const ctx = makeCtx();

		await getCommand(harness).handler("Fix the login bug", ctx);
		await dispatch(harness, { type: "agent_settled" }, ctx);

		expect(harness.pi.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("summar"),
			expect.anything(),
		);
	});
});
