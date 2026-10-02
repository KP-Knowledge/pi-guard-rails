export const PHRASE_MAX_WORDS = 5;

export const PROMPT_PHRASE_PREFIX =
	"Summarize the developer's intent as a short git branch name phrase";

const INSTRUCTION = [
	PROMPT_PHRASE_PREFIX,
	"(3 to 5 words, lowercase, no punctuation, no prefixes like feat/ or fix/).",
	"Describe only what the change achieves, not the wording used to ask for it.",
	"Reply with the phrase alone.",
].join(" ");

export interface CompletionBlock {
	readonly type: string;
	readonly text?: string;
}

export interface ModelCompletion {
	readonly content: readonly CompletionBlock[];
	readonly stopReason?: string;
}

export interface IntentRequest {
	readonly systemPrompt: string;
	readonly messages: readonly { readonly role: "user"; readonly content: string }[];
}

export type IntentComplete = (
	model: unknown,
	request: IntentRequest,
) => Promise<ModelCompletion>;

export interface IntentModelDeps {
	readonly model: unknown;
	readonly complete: IntentComplete;
}

export type IntentModelBinder = () => Promise<IntentModelDeps>;

export type IntentSummarizer = (prompt: string) => Promise<string>;

const UNUSABLE_STOP_REASONS: readonly string[] = ["error", "length", "aborted"];

export const readPhraseFromCompletion = (completion: ModelCompletion): string =>
	UNUSABLE_STOP_REASONS.includes(completion.stopReason ?? "")
		? ""
		: completion.content
				.map((block) => (block.type === "text" ? (block.text ?? "") : ""))
				.join("")
				.trim();

const stripDecoration = (text: string): string =>
	text
		.replace(/`/g, "")
		.replace(/^[\s"']+/, "")
		.replace(/[\s"']+$/, "")
		.trim();

const normalizePhrase = (text: string): string =>
	stripDecoration(text)
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.filter((word) => word.length > 0)
		.slice(0, PHRASE_MAX_WORDS)
		.join(" ");

const DEFAULT_TIMEOUT_MS = 10_000;

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
	const timerCell: { current?: ReturnType<typeof setTimeout> } = {};
	const timeout = new Promise<never>((_resolve, reject) => {
		timerCell.current = setTimeout(
			() => reject(new Error(`Intent summarization timed out after ${timeoutMs}ms`)),
			timeoutMs,
		);
		timerCell.current.unref?.();
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timerCell.current) {
			clearTimeout(timerCell.current);
		}
	});
};

export const createModelIntentSummarizer = (
	bind: IntentModelBinder,
	options: { readonly timeoutMs?: number } = {},
): IntentSummarizer =>
	async (prompt: string): Promise<string> => {
		const { model, complete } = await bind();
		if (model === undefined || model === null) {
			throw new Error("No model is available to summarize the prompt");
		}
		const request: IntentRequest = {
			systemPrompt: INSTRUCTION,
			messages: [{ role: "user", content: prompt }],
		};
		const completion = await withTimeout(
			complete(model, request),
			options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		const phrase = normalizePhrase(readPhraseFromCompletion(completion));
		if (!phrase) {
			throw new Error("The model returned no usable branch-name phrase");
		}
		return phrase;
	};