import type { ExecResult } from "@earendil-works/pi-coding-agent";

export type GitRunner = (
	command: string,
	args: string[],
	cwd: string,
) => Promise<ExecResult>;

export type ExecResultLike = ExecResult;

export interface BranchFailure {
	reason: "branch-exists" | "git-error";
	message: string;
}

export type BranchResult =
	| { readonly ok: true; readonly branch: string }
	| { readonly ok: false; readonly failure: BranchFailure };

export const getCurrentBranch = (
	runner: GitRunner,
	cwd: string,
): Promise<string> =>
	runner("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).then((result) =>
		result.code === 0 ? result.stdout.trim() : "",
	);

export const getDirtyFiles = (
	runner: GitRunner,
	cwd: string,
): Promise<string[]> =>
	runner("git", ["status", "--porcelain"], cwd).then((result) =>
		result.code === 0
			? result.stdout
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0)
			: [],
	);

export const branchExists = (
	runner: GitRunner,
	cwd: string,
	branch: string,
): Promise<boolean> =>
	runner(
		"git",
		["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
		cwd,
	)
		.then((result) => result.code === 0)
		.catch(() => false);

export const createBranch = async (
	runner: GitRunner,
	cwd: string,
	branch: string,
): Promise<BranchResult> => {
	const exists = await branchExists(runner, cwd, branch);
	if (exists) {
		return {
			ok: false,
			failure: {
				reason: "branch-exists",
				message: `Branch ${branch} already exists. Choose a different task description, create it manually with /branch, or remove the existing branch.`,
			},
		};
	}

	const checkout = await runner("git", ["checkout", "-b", branch], cwd);
	if (checkout.code !== 0) {
		return {
			ok: false,
			failure: {
				reason: "git-error",
				message: `git checkout -b failed: ${checkout.stderr.trim() || checkout.stdout.trim()}`,
			},
		};
	}

	return { ok: true, branch };
};
