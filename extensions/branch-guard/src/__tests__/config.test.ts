import { describe, expect, it } from "vitest";
import { buildConfigPath, type FileReader, loadConfig } from "../config.ts";

const readerReturning =
	(content: string): FileReader =>
	async () =>
		content;

const readerThrowing =
	(error: unknown): FileReader =>
	async () => {
		throw error;
	};

describe("buildConfigPath", () => {
	it("places the config under .pi", () => {
		expect(buildConfigPath("/repo")).toBe("/repo/.pi/branch-guard.json");
	});
});

describe("loadConfig", () => {
	it("applies defaults when the file is missing", async () => {
		const config = await loadConfig(
			readerThrowing(new Error("ENOENT")),
			"/repo",
		);
		expect(config).toEqual({
			enabled: true,
			mode: "ask",
			protectedBranches: ["main", "master"],
			commitOnSettle: true,
		});
	});

	it("reads a full config file", async () => {
		const config = await loadConfig(
			readerReturning(
				JSON.stringify({
					enabled: false,
					mode: "auto",
					protectedBranches: ["develop"],
					commitOnSettle: false,
				}),
			),
			"/repo",
		);
		expect(config).toEqual({
			enabled: false,
			mode: "auto",
			protectedBranches: ["develop"],
			commitOnSettle: false,
		});
	});

	it("fills defaults for omitted fields", async () => {
		const config = await loadConfig(
			readerReturning(JSON.stringify({ mode: "auto" })),
			"/repo",
		);
		expect(config).toEqual({
			enabled: true,
			mode: "auto",
			protectedBranches: ["main", "master"],
			commitOnSettle: true,
		});
	});

	it("falls back to defaults on malformed JSON", async () => {
		const config = await loadConfig(readerReturning("{ not json"), "/repo");
		expect(config).toEqual({
			enabled: true,
			mode: "ask",
			protectedBranches: ["main", "master"],
			commitOnSettle: true,
		});
	});

	it("falls back to defaults when the file is empty", async () => {
		const config = await loadConfig(readerReturning("   "), "/repo");
		expect(config).toEqual({
			enabled: true,
			mode: "ask",
			protectedBranches: ["main", "master"],
			commitOnSettle: true,
		});
	});

	it("ignores unknown fields", async () => {
		const config = await loadConfig(
			readerReturning(JSON.stringify({ mode: "auto", custom: "whatever" })),
			"/repo",
		);
		expect(config).toEqual({
			enabled: true,
			mode: "auto",
			protectedBranches: ["main", "master"],
			commitOnSettle: true,
		});
	});

	it("normalizes an invalid mode to ask", async () => {
		const config = await loadConfig(
			readerReturning(JSON.stringify({ mode: "yolo" })),
			"/repo",
		);
		expect(config.mode).toBe("ask");
	});

	it("normalizes an invalid protectedBranches to the default list", async () => {
		const config = await loadConfig(
			readerReturning(JSON.stringify({ protectedBranches: "main" })),
			"/repo",
		);
		expect(config.protectedBranches).toEqual(["main", "master"]);
	});

	it("normalizes non-boolean fields to defaults", async () => {
		const config = await loadConfig(
			readerReturning(JSON.stringify({ enabled: "yes", commitOnSettle: 1 })),
			"/repo",
		);
		expect(config.enabled).toBe(true);
		expect(config.commitOnSettle).toBe(true);
	});

	it("normalizes a non-string-array protectedBranches entry list", async () => {
		const config = await loadConfig(
			readerReturning(
				JSON.stringify({ protectedBranches: ["main", 42, null] }),
			),
			"/repo",
		);
		expect(config.protectedBranches).toEqual(["main"]);
	});
});
