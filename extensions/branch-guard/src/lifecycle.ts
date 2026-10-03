export const MAX_NUDGE_ATTEMPTS = 3;

export interface SettleContext {
	readonly commitOnSettle: boolean;
	readonly branch: string;
	readonly guardCreatedBranches: readonly string[];
	readonly isDirty: boolean;
	readonly nudgeAttempts: number;
}

export const shouldNudge = (context: SettleContext): boolean =>
	context.commitOnSettle &&
	context.guardCreatedBranches.includes(context.branch) &&
	context.isDirty &&
	context.nudgeAttempts < MAX_NUDGE_ATTEMPTS;

export const buildCommitNudge = (): string =>
	[
		"You have finished this task with uncommitted changes on a guard-created branch.",
		"Please: (1) summarize the work you just did,",
		"(2) commit all relevant changes with a conventional-commit message (e.g. feat(scope): ...),",
		"(3) do not push to any remote.",
	].join(" ");
