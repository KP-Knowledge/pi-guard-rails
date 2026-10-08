import { readFileSync, existsSync } from "node:fs";
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

const CONFIG_PATHS = [".guard-rails.json", ".ai-passport/guard-rails.json"] as const;

export interface LoadResult {
	guards: GuardConfig[];
	auto: boolean;
	warnings: string[];
}

export function loadGuardConfig(projectRoot: string): LoadResult {
	const warnings: string[] = [];

	const filePath = CONFIG_PATHS
		.map((rel) => join(projectRoot, rel))
		.find((p) => existsSync(p));

	if (filePath === undefined) {
		return { guards: [], auto: true, warnings };
	}

	const relPath = CONFIG_PATHS.find((rel) => filePath === join(projectRoot, rel)) ?? filePath;

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch {
		return { guards: [], auto: true, warnings };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		const msg = `[guard-rails] ${relPath} is malformed JSON, ignoring.`;
		console.log(msg);
		warnings.push(msg);
		return { guards: [], auto: true, warnings };
	}

	if (!Array.isArray(parsed) && !isGuardsObject(parsed)) {
		const msg = `[guard-rails] ${relPath} must be an array or an object with a "guards" array, ignoring.`;
		console.log(msg);
		warnings.push(msg);
		return { guards: [], auto: true, warnings };
	}

	const auto = isGuardsObject(parsed) ? parsed.auto !== false : true;
	const rawGuards = Array.isArray(parsed) ? parsed : parsed.guards;

	if (!Array.isArray(rawGuards)) {
		const msg = `[guard-rails] ${relPath} "guards" must be an array, ignoring.`;
		console.log(msg);
		warnings.push(msg);
		return { guards: [], auto: true, warnings };
	}

	const guards: GuardConfig[] = rawGuards
		.map((entry): GuardConfig | null => {
			if (typeof entry !== "object" || entry === null) {
				return null;
			}

			const obj = entry as Record<string, unknown>;

			if (typeof obj.command !== "string" || obj.command.trim() === "") {
				return null;
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

			return guard;
		})
		.filter((g): g is GuardConfig => g !== null);

	return { guards, auto, warnings };
}

interface GuardsObject {
	guards: unknown;
	auto: unknown;
}

const isGuardsObject = (value: unknown): value is GuardsObject =>
	typeof value === "object"
	&& value !== null
	&& Array.isArray((value as GuardsObject).guards);

function normalizeMaxIterations(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		return DEFAULTS.maxIterations;
	}
	return Math.floor(value);
}