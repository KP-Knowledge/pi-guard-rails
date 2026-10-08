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

export type CommitResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly message: string };

export const getCurrentBranch = (
	runner: GitRunner,
	cwd: string,
): Promise<string> =>
	runner("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).then((result) =>
		result.code === 0 ? result.stdout.trim() : "",
	);

export type TreeState = string | null;

export const readTreeState = async (
	runner: GitRunner,
	cwd: string,
): Promise<TreeState> => {
	const status = await runner("git", ["status", "--porcelain=v1", "-uall"], cwd);
	if (status.code !== 0) {
		return null;
	}
	const diff = await runner("git", ["diff", "HEAD"], cwd);
	return `${status.stdout}\n--\n${diff.code === 0 ? diff.stdout : ""}`;
};

export const commitChanges = async (
	runner: GitRunner,
	cwd: string,
	message: string,
): Promise<CommitResult> => {
	const staged = await runner("git", ["add", "-A"], cwd);
	if (staged.code !== 0) {
		return { ok: false, message: staged.stderr.trim() || staged.stdout.trim() };
	}
	const committed = await runner("git", ["commit", "-m", message], cwd);
	return committed.code === 0
		? { ok: true }
		: { ok: false, message: committed.stderr.trim() || committed.stdout.trim() };
};

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
