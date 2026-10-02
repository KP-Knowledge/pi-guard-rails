import { describe, expect, it } from "vitest";
import {
	buildBranchName,
	deriveSlug,
	inferTaskType,
	resolveTaskType,
	stripTaskTypeKeyword,
} from "../naming.ts";

describe("inferTaskType", () => {
	it("maps fix vocabulary to fix", () => {
		expect(inferTaskType("please fix the login bug")).toBe("fix");
		expect(inferTaskType("there is an error in the parser")).toBe("fix");
		expect(inferTaskType("FIX the broken build")).toBe("fix");
	});

	it("maps hotfix vocabulary to hotfix", () => {
		expect(inferTaskType("urgent: hotfix the prod crash")).toBe("hotfix");
		expect(inferTaskType("hotfix the payment timeout")).toBe("hotfix");
	});

	it("maps docs vocabulary to docs", () => {
		expect(inferTaskType("update the readme section")).toBe("docs");
		expect(inferTaskType("add a doc page for the API")).toBe("docs");
	});

	it("maps refactor vocabulary to refactor", () => {
		expect(inferTaskType("refactor the config loader")).toBe("refactor");
		expect(inferTaskType("clean up the utils module")).toBe("refactor");
	});

	it("maps feature vocabulary to feat", () => {
		expect(inferTaskType("add a dark mode toggle")).toBe("feat");
		expect(inferTaskType("implement the export feature")).toBe("feat");
		expect(inferTaskType("create a settings page")).toBe("feat");
	});

	it("falls back to feat when no keyword matches", () => {
		expect(inferTaskType("make the button blue")).toBe("feat");
		expect(inferTaskType("")).toBe("feat");
	});

	it("prefers hotfix over fix when both present", () => {
		expect(inferTaskType("urgent hotfix for the login fix")).toBe("hotfix");
	});

	it("prefers fix over feat when both present", () => {
		expect(inferTaskType("fix the login and add a test")).toBe("fix");
	});
});

describe("deriveSlug", () => {
	it("kebab-cases a plain task", () => {
		expect(deriveSlug("Fix Login Bug")).toBe("fix-login-bug");
	});

	it("strips non-alphanumeric characters", () => {
		expect(deriveSlug("add user: JWT/OAuth2 + refresh tokens!")).toBe(
			"add-user-jwt-oauth2-refresh-tokens",
		);
	});

	it("collapses repeated separators and trims edges", () => {
		expect(deriveSlug("  --   fix   the  thing --  ")).toBe("fix-thing");
	});

	it("drops filler words so intent survives", () => {
		expect(deriveSlug("please refactor the config loader")).toBe("refactor-config-loader");
		expect(deriveSlug("can you add a dark mode toggle")).toBe("add-dark-mode-toggle");
	});

	it("truncates on a word boundary, never mid-word", () => {
		expect(deriveSlug("add a dark mode toggle to the settings page")).toBe(
			"add-dark-mode-toggle-settings-page",
		);
		expect(deriveSlug("fix the intermittent websocket reconnect storm in production")).toBe(
			"fix-intermittent-websocket-reconnect",
		);
	});

	it("hard-truncates a single word longer than the cap", () => {
		const slug = deriveSlug("a".repeat(60));
		expect(slug).toHaveLength(40);
	});

	it("falls back to raw words when every word is filler", () => {
		expect(deriveSlug("the a of")).toBe("the-a-of");
	});

	it("caps length at 40 and drops trailing dash", () => {
		const slug = deriveSlug("a".repeat(60));
		expect(slug).toHaveLength(40);
		expect(slug.endsWith("-")).toBe(false);
	});

	it("returns empty for input with no usable characters", () => {
		expect(deriveSlug("!!! ??? ***")).toBe("");
		expect(deriveSlug("   ")).toBe("");
	});
});

describe("resolveTaskType", () => {
	it("keeps an explicit keyword match", () => {
		expect(resolveTaskType("fix the login bug")).toBe("fix");
		expect(resolveTaskType("hotfix the prod crash")).toBe("hotfix");
	});

	it("returns undefined when nothing matches, so callers can decide", () => {
		expect(resolveTaskType("the button looks off")).toBeUndefined();
		expect(resolveTaskType("")).toBeUndefined();
	});
});

describe("stripTaskTypeKeyword", () => {
	it("removes the leading type word so the slug does not repeat it", () => {
		expect(stripTaskTypeKeyword("fix the login bug", "fix")).toBe("the login bug");
	});

	it("leaves text that does not lead with the type word", () => {
		expect(stripTaskTypeKeyword("stale cart totals", "fix")).toBe("stale cart totals");
	});

	it("never empties the text", () => {
		expect(stripTaskTypeKeyword("fix", "fix")).toBe("fix");
	});
});

describe("buildBranchName", () => {
	it("combines type and slug", () => {
		expect(buildBranchName("feat", "add-dark-mode")).toBe("feat/add-dark-mode");
	});

	it("returns empty string for an unusable slug", () => {
		expect(buildBranchName("feat", "")).toBe("");
	});
});
