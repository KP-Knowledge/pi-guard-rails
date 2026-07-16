import type { ExtensionAPI, ExecResult } from "@earendil-works/pi-coding-agent";
import type { GuardConfig } from "./config.ts";

export interface GuardResult {
	guard: GuardConfig;
	passed: boolean;
	code: number;
	killed: boolean;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export async function runGuard(
	pi: ExtensionAPI,
	guard: GuardConfig,
): Promise<GuardResult> {
	const { command, args } = splitCommand(guard.command);

	let result: ExecResult;
	try {
		result = await pi.exec(command, args, {
			cwd: guard.cwd,
			timeout: guard.timeout,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			guard,
			passed: false,
			code: -1,
			killed: false,
			stdout: "",
			stderr: `Failed to execute command: ${msg}`,
			timedOut: false,
		};
	}

	const timedOut = result.killed;
	const passed = result.code === 0 && !timedOut;

	return {
		guard,
		passed,
		code: result.code,
		killed: result.killed,
		stdout: result.stdout,
		stderr: result.stderr,
		timedOut,
	};
}

export function formatOutput(result: GuardResult): string {
	const parts: string[] = [];

	if (result.stdout) {
		parts.push(result.stdout);
	}

	if (result.stderr) {
		parts.push(result.stderr);
	}

	return parts.join("\n");
}

function splitCommand(command: string): { command: string; args: string[] } {
	const tokens = command.trim().split(/\s+/);
	return {
		command: tokens[0] ?? command,
		args: tokens.slice(1),
	};
}