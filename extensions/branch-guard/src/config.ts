import { join } from "node:path";

export type GuardMode = "ask" | "auto";

export interface GuardConfig {
	readonly enabled: boolean;
	readonly mode: GuardMode;
	readonly protectedBranches: readonly string[];
	readonly commitOnSettle: boolean;
}

export type FileReader = (path: string) => Promise<string>;

export const DEFAULT_PROTECTED_BRANCHES: readonly string[] = ["main", "master"];

export const defaultConfig = (): GuardConfig => ({
	enabled: true,
	mode: "ask",
	protectedBranches: DEFAULT_PROTECTED_BRANCHES,
	commitOnSettle: true,
});

export const buildConfigPath = (cwd: string): string =>
	join(cwd, ".pi", "branch-guard.json");

const isBoolean = (value: unknown): value is boolean =>
	typeof value === "boolean";

const normalizeMode = (value: unknown): GuardMode =>
	value === "auto" ? "auto" : "ask";

const normalizeBranches = (value: unknown): readonly string[] | undefined =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: undefined;

export const loadConfig = async (
	readFile: FileReader,
	cwd: string,
): Promise<GuardConfig> => {
	const defaults = defaultConfig();
	try {
		const raw = await readFile(buildConfigPath(cwd));
		const trimmed = raw.trim();
		if (!trimmed) {
			return defaults;
		}
		const parsed: unknown = JSON.parse(trimmed);
		if (typeof parsed !== "object" || parsed === null) {
			return defaults;
		}
		const record = parsed as Record<string, unknown>;
		return {
			enabled: isBoolean(record.enabled) ? record.enabled : defaults.enabled,
			mode: normalizeMode(record.mode),
			protectedBranches:
				normalizeBranches(record.protectedBranches) ??
				defaults.protectedBranches,
			commitOnSettle: isBoolean(record.commitOnSettle)
				? record.commitOnSettle
				: defaults.commitOnSettle,
		};
	} catch {
		return defaults;
	}
};
