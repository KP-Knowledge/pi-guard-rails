import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	branchExists,
	createBranch,
	type ExecResultLike,
	type GitRunner,
	getCurrentBranch,
	getDirtyFiles,
} from "../git.ts";

const ok = (stdout = ""): ExecResultLike => ({
	stdout,
	stderr: "",
	code: 0,
	killed: false,
});

const fail = (stderr: string, code = 1): ExecResultLike => ({
	stdout: "",
	stderr,
	code,
	killed: false,
});

const runnerFrom =
	(
		impl: (
			command: string,
			args: string[],
			cwd: string,
		) => ExecResultLike | Promise<ExecResultLike>,
	): GitRunner =>
	async (command, args, cwd) =>
		impl(command, args, cwd);

describe("getCurrentBranch", () => {
	it("returns the trimmed branch name", async () => {
		const runner = runnerFrom(() => ok("main\n"));
		expect(await getCurrentBranch(runner, "/repo")).toBe("main");
	});

	it("returns empty string when git fails", async () => {
		const runner = runnerFrom(() => fail("fatal: not a git repository", 128));
		expect(await getCurrentBranch(runner, "/repo")).toBe("");
	});
});

describe("getDirtyFiles", () => {
	it("returns empty list for clean tree", async () => {
		const runner = runnerFrom(() => ok(""));
		expect(await getDirtyFiles(runner, "/repo")).toEqual([]);
	});

	it("parses porcelain lines into file names", async () => {
		const runner = runnerFrom(() => ok(" M src/a.ts\n?? b.txt\nA  c.md\n"));
		expect(await getDirtyFiles(runner, "/repo")).toEqual([
			"M src/a.ts",
			"?? b.txt",
			"A  c.md",
		]);
	});

	it("returns empty list when git fails", async () => {
		const runner = runnerFrom(() => fail("boom"));
		expect(await getDirtyFiles(runner, "/repo")).toEqual([]);
	});
});

describe("branchExists", () => {
	it("returns true when show-ref verifies the branch", async () => {
		const runner = runnerFrom(() => ok(""));
		expect(await branchExists(runner, "/repo", "feat/add-dark-mode")).toBe(
			true,
		);
	});

	it("returns false when show-ref rejects", async () => {
		const runner = runnerFrom(() =>
			fail("fatal: refs/heads/feat/x - not a valid ref", 128),
		);
		expect(await branchExists(runner, "/repo", "feat/add-dark-mode")).toBe(
			false,
		);
	});
});

describe("createBranch", () => {
	it("fails with remediation hint when the branch already exists", async () => {
		const calls: string[][] = [];
		const runner = runnerFrom((_command, args) => {
			calls.push(args);
			if (args[0] === "show-ref") return ok("");
			return ok("");
		});
		const result = await createBranch(runner, "/repo", "feat/add-dark-mode");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure.reason).toBe("branch-exists");
			expect(result.failure.message).toContain("feat/add-dark-mode");
			expect(result.failure.message).toContain("/branch");
		}
		expect(calls.find((args) => args[0] === "checkout")).toBeUndefined();
	});

	it("reports git errors from checkout", async () => {
		const runner = runnerFrom((_command, args) =>
			args[0] === "show-ref"
				? fail("", 1)
				: fail("fatal: cannot lock ref", 128),
		);
		const result = await createBranch(runner, "/repo", "feat/add-dark-mode");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure.reason).toBe("git-error");
			expect(result.failure.message).toContain("cannot lock ref");
		}
	});

	it("creates the branch via checkout -b and returns it", async () => {
		const calls: string[][] = [];
		const runner = runnerFrom((_command, args) => {
			calls.push(args);
			if (args[0] === "show-ref") return fail("", 1);
			return ok("Switched to a new branch 'feat/add-dark-mode'\n");
		});
		const result = await createBranch(runner, "/repo", "feat/add-dark-mode");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.branch).toBe("feat/add-dark-mode");
		}
		const checkoutCall = calls.find((args) => args[0] === "checkout");
		expect(checkoutCall).toEqual(["checkout", "-b", "feat/add-dark-mode"]);
	});
});

describe("real git integration", () => {
	const TMP_BASE = join(process.cwd(), ".tmp-branch-guard-test");

	beforeEach(() => {
		rmSync(TMP_BASE, { recursive: true, force: true });
		mkdirSync(TMP_BASE, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP_BASE, { recursive: true, force: true });
	});

	const realRunner: GitRunner = async (command, args, cwd) => {
		try {
			const stdout = execSync(`${command} ${args.join(" ")}`, {
				cwd,
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
			});
			return { stdout, stderr: "", code: 0, killed: false };
		} catch (err) {
			const e = err as { stdout?: string; stderr?: string; status?: number };
			return {
				stdout: e.stdout ?? "",
				stderr: e.stderr ?? String(err),
				code: e.status ?? 1,
				killed: false,
			};
		}
	};

	const initRepo = (): string => {
		const repo = join(TMP_BASE, "repo");
		mkdirSync(repo);
		execSync("git init -b main", { cwd: repo });
		execSync('git config user.email "t@t.t"', { cwd: repo });
		execSync('git config user.name "t"', { cwd: repo });
		writeFileSync(join(repo, "a.txt"), "a");
		execSync("git add . && git commit -m init", { cwd: repo });
		return repo;
	};

	it("reports the real current branch", async () => {
		const repo = initRepo();
		expect(await getCurrentBranch(realRunner, repo)).toBe("main");
	});

	it("carries uncommitted changes onto the new branch", async () => {
		const repo = initRepo();
		writeFileSync(join(repo, "a.txt"), "dirty");

		const result = await createBranch(realRunner, repo, "fix/login-bug");
		expect(result.ok).toBe(true);

		expect(
			execSync("git rev-parse --abbrev-ref HEAD", {
				cwd: repo,
				encoding: "utf8",
			}).trim(),
		).toBe("fix/login-bug");
		expect(
			execSync("git status --porcelain", {
				cwd: repo,
				encoding: "utf8",
			}).trim(),
		).toContain("a.txt");
	});

	it("fails with remediation hint when the branch already exists", async () => {
		const repo = initRepo();
		execSync("git branch feat/add-dark-mode", { cwd: repo });

		const result = await createBranch(realRunner, repo, "feat/add-dark-mode");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure.reason).toBe("branch-exists");
		}
		expect(
			execSync("git rev-parse --abbrev-ref HEAD", {
				cwd: repo,
				encoding: "utf8",
			}).trim(),
		).toBe("main");
	});

	it("detects existing branches with show-ref", async () => {
		const repo = initRepo();
		execSync("git branch fix/login-bug", { cwd: repo });

		expect(await branchExists(realRunner, repo, "fix/login-bug")).toBe(true);
		expect(await branchExists(realRunner, repo, "feat/none")).toBe(false);
	});
});
