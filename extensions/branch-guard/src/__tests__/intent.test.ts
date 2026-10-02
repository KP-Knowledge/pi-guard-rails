import { describe, expect, it } from "vitest";
import {
	createModelIntentSummarizer,
	PROMPT_PHRASE_PREFIX,
	PHRASE_MAX_WORDS,
	type ModelCompletion,
	readPhraseFromCompletion,
} from "../intent.ts";

const completion = (text: string, stopReason = "stop"): ModelCompletion => ({
	content: [{ type: "text", text }],
	stopReason,
});

describe("readPhraseFromCompletion", () => {
	it("reads the text blocks from an assistant message", () => {
		expect(readPhraseFromCompletion(completion("stale cart totals"))).toBe("stale cart totals");
	});

	it("joins multiple text blocks", () => {
		const multi: ModelCompletion = {
			content: [
				{ type: "text", text: "stale cart " },
				{ type: "text", text: "totals" },
			],
			stopReason: "stop",
		};
		expect(readPhraseFromCompletion(multi)).toBe("stale cart totals");
	});

	it("ignores non-text blocks", () => {
		const mixed: ModelCompletion = {
			content: [
				{ type: "thinking", thinking: "internal reasoning" } as never,
				{ type: "text", text: "auth token refresh" },
			],
			stopReason: "stop",
		};
		expect(readPhraseFromCompletion(mixed)).toBe("auth token refresh");
	});

	it("returns empty string for an error stop reason", () => {
		expect(readPhraseFromCompletion(completion("half a thou", "error"))).toBe("");
		expect(readPhraseFromCompletion(completion("cut off here", "length"))).toBe("");
	});

	it("returns empty string when there is no text", () => {
		expect(readPhraseFromCompletion({ content: [], stopReason: "stop" })).toBe("");
	});
});

describe("createModelIntentSummarizer", () => {
	const fakeModel = { id: "fake-model" } as never;

	it("asks the model with the prompt embedded in the request", async () => {
		const calls: Array<{ systemPrompt?: string; userText: string }> = [];
		const complete = async (_model: unknown, context: any): Promise<ModelCompletion> => {
			calls.push({
				systemPrompt: context.systemPrompt,
				userText: context.messages[0].content,
			});
			return completion("stale cart totals");
		};

		const summarize = createModelIntentSummarizer(async () => ({ model: fakeModel, complete }));
		const phrase = await summarize("the cart page shows wrong totals when items expire");

		expect(phrase).toBe("stale cart totals");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.userText).toContain("the cart page shows wrong totals when items expire");
		expect(calls[0]?.systemPrompt).toContain("branch name");
	});

	it("collapses whitespace and caps the phrase at a few words", async () => {
		const complete = async (): Promise<ModelCompletion> =>
			completion("  stale cart\ntotals  when   items expire from the store  ");
		const summarize = createModelIntentSummarizer(async () => ({ model: fakeModel, complete }));

		const phrase = await summarize("cart totals");

		expect(phrase).toBe("stale cart totals when items");
		expect(phrase.split(" ").length).toBeLessThanOrEqual(PHRASE_MAX_WORDS);
	});

	it("strips a wrapping code fence and quotes", async () => {
		const complete = async (): Promise<ModelCompletion> =>
			completion('```\n"stale cart totals"\n```');
		const summarize = createModelIntentSummarizer(async () => ({ model: fakeModel, complete }));

		expect(await summarize("cart totals")).toBe("stale cart totals");
	});

	it("throws when no model is available", async () => {
		const summarize = createModelIntentSummarizer(async () => ({ model: undefined, complete: async () => completion("x") }));
		await expect(summarize("cart totals")).rejects.toThrow(/model/i);
	});

	it("throws when auth resolution fails", async () => {
		const summarize = createModelIntentSummarizer(async () => {
			throw new Error("no credentials for provider");
		});
		await expect(summarize("cart totals")).rejects.toThrow(/credentials/);
	});

	it("throws when the model returns no usable phrase", async () => {
		const summarize = createModelIntentSummarizer(async () => ({
			model: fakeModel,
			complete: async () => completion("   "),
		}));
		await expect(summarize("cart totals")).rejects.toThrow(/phrase/i);
	});

	it("gives up on a hung model call instead of blocking the edit", async () => {
		const summarize = createModelIntentSummarizer(
			async () => ({
				model: fakeModel,
				complete: () => new Promise<ModelCompletion>(() => {}),
			}),
			{ timeoutMs: 20 },
		);
		await expect(summarize("cart totals")).rejects.toThrow(/timed out/i);
	});

	it("documents the instruction prefix", () => {
		expect(PROMPT_PHRASE_PREFIX.length).toBeGreaterThan(0);
	});
});