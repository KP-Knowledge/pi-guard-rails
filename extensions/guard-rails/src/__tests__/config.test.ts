import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadGuardConfig } from "../config.ts";

const TMP_DIR = join(process.cwd(), ".tmp-test-config");

beforeEach(() => {
	rmSync(TMP_DIR, { recursive: true, force: true });
	mkdirSync(TMP_DIR, { recursive: true });
});

describe("loadGuardConfig", () => {
	it("returns empty array when config file is missing", () => {
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it("returns empty array when config is malformed JSON", () => {
		writeFileSync(join(TMP_DIR, ".guard-rails.json"), "{ not valid json");
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toEqual([]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("malformed JSON");
	});

	it("returns empty array when config is not an array", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify({ command: "nx run test" }),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toEqual([]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("must be an array");
	});

	it("loads a single guard with all fields", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([
				{
					command: "nx run test",
					cwd: "packages/api",
					maxIterations: 5,
					timeout: 30000,
				},
			]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(1);
		expect(result.guards[0]).toEqual({
			command: "nx run test",
			cwd: "packages/api",
			maxIterations: 5,
			timeout: 30000,
		});
		expect(result.guards[0].instructions).toBeUndefined();
		expect(result.warnings).toEqual([]);
	});

	it("loads a guard with custom instructions", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([
				{
					command: "nx run test",
					instructions: "Focus on the TypeScript errors first.",
				},
			]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(1);
		expect(result.guards[0].instructions).toBe("Focus on the TypeScript errors first.");
	});

	it("ignores blank instructions", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([
				{ command: "nx run test", instructions: "   " },
				{ command: "nx run lint", instructions: 42 },
			]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(2);
		expect(result.guards[0].instructions).toBeUndefined();
		expect(result.guards[1].instructions).toBeUndefined();
	});

	it("applies defaults for optional fields", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([{ command: "npm test" }]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(1);
		expect(result.guards[0]).toEqual({
			command: "npm test",
			cwd: ".",
			maxIterations: 3,
			timeout: 60000,
		});
	});

	it("loads multiple guards", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([
				{ command: "nx run lint", maxIterations: 2 },
				{ command: "nx run test", maxIterations: 3 },
			]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(2);
		expect(result.guards[0].command).toBe("nx run lint");
		expect(result.guards[1].command).toBe("nx run test");
	});

	it("skips entries without a command", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([
				{ command: "nx run test" },
				{ cwd: ".", maxIterations: 3 },
				{ command: "" },
			]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(1);
		expect(result.guards[0].command).toBe("nx run test");
	});

	it("normalizes maxIterations < 1 to default 3", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([
				{ command: "nx run test", maxIterations: 0 },
				{ command: "nx run lint", maxIterations: -5 },
			]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(2);
		expect(result.guards[0].maxIterations).toBe(3);
		expect(result.guards[1].maxIterations).toBe(3);
	});

	it("normalizes non-numeric maxIterations to default 3", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([{ command: "nx run test", maxIterations: "three" }]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards[0].maxIterations).toBe(3);
	});

	it("normalizes invalid timeout to default 60000", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([
				{ command: "nx run test", timeout: 0 },
				{ command: "nx run lint", timeout: -1 },
			]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards[0].timeout).toBe(60000);
		expect(result.guards[1].timeout).toBe(60000);
	});

	it("skips non-object entries", () => {
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify(["not an object", null, 42, { command: "nx run test" }]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(1);
		expect(result.guards[0].command).toBe("nx run test");
	});

	it("loads from .ai-passport/guard-rails.json when .guard-rails.json is absent", () => {
		mkdirSync(join(TMP_DIR, ".ai-passport"), { recursive: true });
		writeFileSync(
			join(TMP_DIR, ".ai-passport", "guard-rails.json"),
			JSON.stringify([{ command: "npm test" }]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(1);
		expect(result.guards[0].command).toBe("npm test");
		expect(result.warnings).toEqual([]);
	});

	it("prefers .guard-rails.json over .ai-passport/guard-rails.json", () => {
		mkdirSync(join(TMP_DIR, ".ai-passport"), { recursive: true });
		writeFileSync(
			join(TMP_DIR, ".guard-rails.json"),
			JSON.stringify([{ command: "from-root" }]),
		);
		writeFileSync(
			join(TMP_DIR, ".ai-passport", "guard-rails.json"),
			JSON.stringify([{ command: "from-passport" }]),
		);
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toHaveLength(1);
		expect(result.guards[0].command).toBe("from-root");
	});

	it("reports malformed JSON with the .ai-passport file path", () => {
		mkdirSync(join(TMP_DIR, ".ai-passport"), { recursive: true });
		writeFileSync(join(TMP_DIR, ".ai-passport", "guard-rails.json"), "{ not valid json");
		const result = loadGuardConfig(TMP_DIR);
		expect(result.guards).toEqual([]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain(".ai-passport/guard-rails.json");
		expect(result.warnings[0]).toContain("malformed JSON");
	});
});