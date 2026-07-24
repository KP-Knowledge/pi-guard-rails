import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface GuardConfig {
	command: string;
	cwd: string;
	maxIterations: number;
	timeout: number;
	instructions?: string;
}

const DEFAULTS = {
	cwd: ".",
	maxIterations: 3,
	timeout: 60000,
} as const;

const CONFIG_FILENAME = ".guard-rails.json";

export interface LoadResult {
	guards: GuardConfig[];
	warnings: string[];
}

export function loadGuardConfig(projectRoot: string): LoadResult {
	const filePath = join(projectRoot, CONFIG_FILENAME);
	const warnings: string[] = [];

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch {
		return { guards: [], warnings };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		const msg = `[guard-rails] ${CONFIG_FILENAME} is malformed JSON, ignoring.`;
		console.log(msg);
		warnings.push(msg);
		return { guards: [], warnings };
	}

	if (!Array.isArray(parsed)) {
		const msg = `[guard-rails] ${CONFIG_FILENAME} must be an array, ignoring.`;
		console.log(msg);
		warnings.push(msg);
		return { guards: [], warnings };
	}

	const guards: GuardConfig[] = [];

	for (const entry of parsed) {
		if (typeof entry !== "object" || entry === null) {
			continue;
		}

		const obj = entry as Record<string, unknown>;

		if (typeof obj.command !== "string" || obj.command.trim() === "") {
			continue;
		}

		const guard: GuardConfig = {
			command: obj.command,
			cwd: typeof obj.cwd === "string" ? obj.cwd : DEFAULTS.cwd,
			maxIterations: normalizeMaxIterations(obj.maxIterations),
			timeout: typeof obj.timeout === "number" && obj.timeout > 0
				? obj.timeout
				: DEFAULTS.timeout,
			...(typeof obj.instructions === "string" && obj.instructions.trim() !== ""
				? { instructions: obj.instructions }
				: {}),
		};

		guards.push(guard);
	}

	return { guards, warnings };
}

function normalizeMaxIterations(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		return DEFAULTS.maxIterations;
	}
	return Math.floor(value);
}