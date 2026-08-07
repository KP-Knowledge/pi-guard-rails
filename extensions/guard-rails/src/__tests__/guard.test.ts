import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runGuard, formatOutput } from "../guard.ts";
import type { GuardConfig } from "../config.ts";

function makePi(execImpl?: ReturnType<typeof vi.fn>): ExtensionAPI {
	return {
		exec: execImpl ?? vi.fn(),
	} as unknown as ExtensionAPI;
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

describe("runGuard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns passed=true when exit code is 0", async () => {
		const exec = vi.fn().mockResolvedValue({
			stdout: "all tests passed",
			stderr: "",
			code: 0,
			killed: false,
		});
		const pi = makePi(exec);
		const guard = makeGuard();

		const result = await runGuard(pi, guard);

		expect(result.passed).toBe(true);
		expect(result.code).toBe(0);
		expect(result.timedOut).toBe(false);
		expect(result.stdout).toBe("all tests passed");
	});

	it("returns passed=false when exit code is non-zero", async () => {
		const exec = vi.fn().mockResolvedValue({
			stdout: "1 passing",
			stderr: "1 failing",
			code: 1,
			killed: false,
		});
		const pi = makePi(exec);
		const guard = makeGuard();

		const result = await runGuard(pi, guard);

		expect(result.passed).toBe(false);
		expect(result.code).toBe(1);
		expect(result.stderr).toBe("1 failing");
	});

	it("returns passed=false and timedOut=true when killed", async () => {
		const exec = vi.fn().mockResolvedValue({
			stdout: "partial output",
			stderr: "",
			code: null,
			killed: true,
		});
		const pi = makePi(exec);
		const guard = makeGuard({ timeout: 5000 });

		const result = await runGuard(pi, guard);

		expect(result.passed).toBe(false);
		expect(result.killed).toBe(true);
		expect(result.timedOut).toBe(true);
	});

	it("splits command into command and args", async () => {
		const exec = vi.fn().mockResolvedValue({
			stdout: "",
			stderr: "",
			code: 0,
			killed: false,
		});
		const pi = makePi(exec);
		const guard = makeGuard({ command: "nx run test --skip-nx-cache" });

		await runGuard(pi, guard);

		expect(exec).toHaveBeenCalledWith(
			"sh",
			["-c", "nx run test --skip-nx-cache"],
			{ cwd: ".", timeout: 60000 },
		);
	});

	it("passes cwd and timeout to exec", async () => {
		const exec = vi.fn().mockResolvedValue({
			stdout: "",
			stderr: "",
			code: 0,
			killed: false,
		});
		const pi = makePi(exec);
		const guard = makeGuard({ cwd: "packages/api", timeout: 30000 });

		await runGuard(pi, guard);

		expect(exec).toHaveBeenCalledWith(
			"sh",
			["-c", "nx run test"],
			{ cwd: "packages/api", timeout: 30000 },
		);
	});

	it("handles exec rejection gracefully", async () => {
		const exec = vi.fn().mockRejectedValue(new Error("ENOENT"));
		const pi = makePi(exec);
		const guard = makeGuard();

		const result = await runGuard(pi, guard);

		expect(result.passed).toBe(false);
		expect(result.code).toBe(-1);
		expect(result.stderr).toContain("ENOENT");
	});
});

describe("formatOutput", () => {
	it("concatenates stdout and stderr with newline", () => {
		const result = {
			guard: makeGuard(),
			passed: false,
			code: 1,
			killed: false,
			stdout: "line 1",
			stderr: "error line",
			timedOut: false,
		};
		expect(formatOutput(result)).toBe("line 1\nerror line");
	});

	it("returns stderr only when stdout is empty", () => {
		const result = {
			guard: makeGuard(),
			passed: false,
			code: 1,
			killed: false,
			stdout: "",
			stderr: "error only",
			timedOut: false,
		};
		expect(formatOutput(result)).toBe("error only");
	});

	it("returns stdout only when stderr is empty", () => {
		const result = {
			guard: makeGuard(),
			passed: false,
			code: 1,
			killed: false,
			stdout: "stdout only",
			stderr: "",
			timedOut: false,
		};
		expect(formatOutput(result)).toBe("stdout only");
	});

	it("returns empty string when both are empty", () => {
		const result = {
			guard: makeGuard(),
			passed: false,
			code: 1,
			killed: false,
			stdout: "",
			stderr: "",
			timedOut: false,
		};
		expect(formatOutput(result)).toBe("");
	});
});