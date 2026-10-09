import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { CommitOnSettle } from "./config.ts";
import {
	buildBranchName,
	deriveSlug,
	resolveTaskType,
	stripTaskTypeKeyword,
	type TaskType,
} from "./naming.ts";

export interface GuardState {
	readonly skipped: boolean;
	readonly guardCreatedBranches: readonly string[];
	readonly capturedPrompt: string;
}

export interface BranchProposal {
	readonly type: TaskType;
	readonly slug: string;
	readonly branch: string;
}

export const initialGuardState = (): GuardState => ({
	skipped: false,
	guardCreatedBranches: [],
	capturedPrompt: "",
});

export const markSkipped = (state: GuardState): GuardState => ({
	...state,
	skipped: true,
});

export const recordGuardCreatedBranch = (
	state: GuardState,
	branch: string,
): GuardState => ({
	...state,
	guardCreatedBranches: [...state.guardCreatedBranches, branch],
});

export const capturePrompt = (
	state: GuardState,
	prompt: string,
): GuardState => ({
	...state,
	capturedPrompt: prompt,
});

export const isProtectedBranch = (
	branch: string,
	protectedBranches: readonly string[],
): boolean => protectedBranches.includes(branch);

export const isWorktreeBranch = (branch: string): boolean =>
	branch.startsWith("wt/");

export const shouldAutoCommit = (
	state: GuardState,
	branch: string,
	commitOnSettle: CommitOnSettle,
	protectedBranches: readonly string[],
): boolean =>
	commitOnSettle !== false &&
	!isProtectedBranch(branch, protectedBranches) &&
	(commitOnSettle === "any" || state.guardCreatedBranches.includes(branch));

export const resolveLatestUserPrompt = (
	entries: readonly SessionEntry[],
): string | undefined =>
	entries
		.filter(
			(entry): entry is Extract<SessionEntry, { type: "message" }> =>
				entry.type === "message",
		)
		.map((entry) => entry.message)
		.filter(
			(message): message is typeof message & { role: "user" } =>
				message.role === "user",
		)
		.map((message) => {
			const content = message.content;
			if (typeof content === "string") {
				return content;
			}
			return content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("")
				.trim();
		})
		.filter((text) => text.length > 0)
		.at(-1);

export const buildBranchProposal = (
	prompt: string,
): BranchProposal | undefined => {
	const type = resolveTaskType(prompt) ?? "feat";
	const slug = deriveSlug(stripTaskTypeKeyword(prompt, type));
	if (!slug) {
		return undefined;
	}
	return { type, slug, branch: buildBranchName(type, slug) };
};

export const buildBranchProposalFromPhrase = (
	phrase: string,
	prompt: string,
): BranchProposal | undefined => {
	const type = resolveTaskType(phrase) ?? resolveTaskType(prompt) ?? "feat";
	const slug = deriveSlug(stripTaskTypeKeyword(phrase, type));
	if (!slug) {
		return undefined;
	}
	return { type, slug, branch: buildBranchName(type, slug) };
};

export const resolveTaskPrompt = (
	state: GuardState,
	entries: readonly SessionEntry[],
): string => state.capturedPrompt || resolveLatestUserPrompt(entries) || "";
