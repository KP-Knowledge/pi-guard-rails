import type { EntryRenderer, EntryRenderOptions, MessageRenderer, MessageRenderOptions } from "@earendil-works/pi-coding-agent";
import type { CustomEntry } from "@earendil-works/pi-coding-agent";

interface HistoryEntryData {
	lines: string[];
}

interface SimpleComponent {
	render(width: number): string[];
	invalidate(): void;
}

const createLinesComponent = (lines: string[]): SimpleComponent => ({
	render: (width: number) => lines.map(line => truncateLine(line, width)),
	invalidate: () => {},
});

export const renderHistoryEntry: EntryRenderer<HistoryEntryData> = (
	entry: CustomEntry<HistoryEntryData>,
	_options: EntryRenderOptions,
): SimpleComponent => {
	const lines = entry.data?.lines ?? [];
	return createLinesComponent(lines);
};

export const renderFailureMessage: MessageRenderer = (
	message,
	_options: MessageRenderOptions,
): SimpleComponent => {
	const content = typeof message.content === "string" ? message.content : "";
	return createLinesComponent(content.split("\n"));
};

const ELLIPSIS = "…";
const ELLIPSIS_WIDTH = 1;

const truncateLine = (line: string, maxWidth: number): string => {
	const chars = [...line];
	const totalWidth = chars.reduce((acc, ch) => acc + charWidth(ch), 0);
	if (totalWidth <= maxWidth) {
		return line;
	}
	const budget = maxWidth - ELLIPSIS_WIDTH;
	let width = 0;
	let out = "";
	for (const ch of chars) {
		const w = charWidth(ch);
		if (width + w > budget) break;
		out += ch;
		width += w;
	}
	return `${out}${ELLIPSIS}`;
};

const charWidth = (ch: string): number => {
	const code = ch.codePointAt(0) ?? 0;
	if (code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
		(code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6))) {
		return 2;
	}
	return 1;
};