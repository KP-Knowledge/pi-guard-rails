export type TaskType = "feat" | "fix" | "hotfix" | "docs" | "refactor";

interface TypeEntry {
	readonly type: TaskType;
	readonly keywords: readonly string[];
}

const TYPE_TABLE: readonly TypeEntry[] = [
	{ type: "hotfix", keywords: ["hotfix", "urgent", "prod"] },
	{ type: "fix", keywords: ["fix", "bug", "error"] },
	{ type: "docs", keywords: ["doc", "readme"] },
	{ type: "refactor", keywords: ["refactor", "clean"] },
	{ type: "feat", keywords: ["feat", "add", "implement", "create"] },
];

export const resolveTaskType = (text: string): TaskType | undefined => {
	const lower = text.toLowerCase();
	return TYPE_TABLE.find((entry) =>
		entry.keywords.some((keyword) => lower.includes(keyword)),
	)?.type;
};

export const inferTaskType = (text: string): TaskType => resolveTaskType(text) ?? "feat";

const SLUG_MAX_LENGTH = 40;

const FILLER_WORDS: readonly string[] = [
	"a", "an", "the", "and", "or", "but", "to", "of", "for", "in", "on", "at", "by",
	"with", "from", "into", "please", "can", "could", "would", "you", "your", "my",
	"me", "i", "we", "it", "is", "are", "be", "do", "does", "that", "this", "then",
	"so", "just", "help", "need", "want", "make", "let", "lets",
];

const toWords = (text: string): string[] =>
	text
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.split(" ")
		.filter((word) => word.length > 0);

const capAtWordBoundary = (words: readonly string[]): string =>
	words.reduce((acc, word) => {
		const next = acc ? `${acc}-${word}` : word;
		return next.length > SLUG_MAX_LENGTH ? acc : next;
	}, "");

const hardTruncate = (slug: string): string =>
	slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "").replace(/^-+/g, "");

export const deriveSlug = (text: string): string => {
	const words = toWords(text);
	if (words.length === 0) {
		return "";
	}
	const meaningful = words.filter((word) => !FILLER_WORDS.includes(word));
	const chosen = meaningful.length > 0 ? meaningful : words;
	const capped = capAtWordBoundary(chosen);
	if (capped) {
		return capped;
	}
	const joined = chosen.join("-");
	return joined.length > SLUG_MAX_LENGTH ? hardTruncate(joined) : joined;
};

export const stripTaskTypeKeyword = (text: string, type: TaskType): string => {
	const words = toWords(text);
	const withoutKeyword = words.filter((word, index) => {
		const isLeading = index === 0;
		const isTypeWord = word === type;
		return !(isLeading && isTypeWord);
	});
	const remaining = withoutKeyword.length === words.length ? words : withoutKeyword;
	return remaining.join(" ") || text;
};

export const buildBranchName = (type: TaskType, slug: string): string =>
	slug ? `${type}/${slug}` : "";