import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	buildBranchProposal,
	buildBranchProposalFromPhrase,
	initialGuardState,
	isProtectedBranch,
	isWorktreeBranch,
	markSkipped,
	recordGuardCreatedBranch,
	resolveLatestUserPrompt,
} from "../guard.ts";
import { COMMIT_GUIDELINE } from "../lifecycle.ts";

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

describe("guard state", () => {
	it("starts clean", () => {
		const state = initialGuardState();
		expect(state.skipped).toBe(false);
		expect(state.guardCreatedBranches).toEqual([]);
		expect(state.capturedPrompt).toBe("");
	});

	it("markSkipped returns a new state with skipped set", () => {
		const before = initialGuardState();
		const after = markSkipped(before);
		expect(before.skipped).toBe(false);
		expect(after.skipped).toBe(true);
	});

	it("recordGuardCreatedBranch appends without mutating", () => {
		const before = initialGuardState();
		const after = recordGuardCreatedBranch(before, "feat/add-dark-mode");
		expect(before.guardCreatedBranches).toEqual([]);
		expect(after.guardCreatedBranches).toEqual(["feat/add-dark-mode"]);
	});
});

describe("branch predicates", () => {
	it("matches protected branches case-sensitively", () => {
		expect(isProtectedBranch("main", ["main", "master"])).toBe(true);
		expect(isProtectedBranch("develop", ["main", "master"])).toBe(false);
		expect(isProtectedBranch("Main", ["main", "master"])).toBe(false);
	});

	it("detects worktree branches by wt/ prefix", () => {
		expect(isWorktreeBranch("wt/fix-login-bug")).toBe(true);
		expect(isWorktreeBranch("feat/fix-login-bug")).toBe(false);
		expect(isWorktreeBranch("main")).toBe(false);
	});
});

describe("resolveLatestUserPrompt", () => {
	it("returns undefined when no entries exist", () => {
		expect(resolveLatestUserPrompt([])).toBeUndefined();
	});

	it("returns the latest user message text", () => {
		const entries = [
			messageEntry("user", "first task", "1"),
			messageEntry("assistant", "working on it", "2"),
			messageEntry("user", "second task", "3"),
		];
		expect(resolveLatestUserPrompt(entries)).toBe("second task");
	});

	it("extracts text from structured content", () => {
		const entries = [
			messageEntry(
				"user",
				[
					{ type: "text", text: "structured " },
					{ type: "text", text: "task" },
				],
				"1",
			),
		];
		expect(resolveLatestUserPrompt(entries)).toBe("structured task");
	});

	it("skips non-user messages", () => {
		const entries = [messageEntry("assistant", "all done", "1")];
		expect(resolveLatestUserPrompt(entries)).toBeUndefined();
	});
});

describe("buildBranchProposal", () => {
	it("derives type, slug and branch from a prompt without repeating the type word", () => {
		const proposal = buildBranchProposal("Fix the login bug");
		expect(proposal).toEqual({
			type: "fix",
			slug: "login-bug",
			branch: "fix/login-bug",
		});
	});

	it("drops filler words from the prompt", () => {
		expect(buildBranchProposal("could you please add a dark mode toggle")?.branch).toBe(
			"feat/add-dark-mode-toggle",
		);
	});

	it("returns undefined for an unusable prompt", () => {
		expect(buildBranchProposal("!!!")).toBeUndefined();
	});
});

describe("buildBranchProposalFromPhrase", () => {
	it("uses the summarized phrase for the slug and the prompt for the type", () => {
		const proposal = buildBranchProposalFromPhrase(
			"stale cart totals",
			"fix the cart totals when items expire",
		);
		expect(proposal).toEqual({
			type: "fix",
			slug: "stale-cart-totals",
			branch: "fix/stale-cart-totals",
		});
	});

	it("does not repeat the type word when the phrase leads with it", () => {
		expect(buildBranchProposalFromPhrase("fix login bug", "fix the login bug")?.branch).toBe(
			"fix/login-bug",
		);
	});

	it("falls back to feat when neither prompt nor phrase names a type", () => {
		expect(
			buildBranchProposalFromPhrase("dark mode toggle", "make the app darker")?.branch,
		).toBe("feat/dark-mode-toggle");
	});

	it("returns undefined for an unusable phrase", () => {
		expect(buildBranchProposalFromPhrase("!!!", "fix it")).toBeUndefined();
	});
});

describe("COMMIT_GUIDELINE", () => {
	it("forbids asking for commit confirmation", () => {
		expect(COMMIT_GUIDELINE).toContain("automatically");
		expect(COMMIT_GUIDELINE.toLowerCase()).toContain("do not ask");
	});
});
