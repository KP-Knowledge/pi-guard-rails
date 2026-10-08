import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FINGERPRINT_COMMAND =
	"git rev-parse -q --is-inside-work-tree || exit 1; git status --porcelain=v1 -uall; git diff HEAD 2>/dev/null; true";

const FINGERPRINT_TIMEOUT_MS = 10_000;

export type TreeState = string | null;

export async function readTreeState(
	pi: ExtensionAPI,
	cwd: string,
): Promise<TreeState> {
	try {
		const result = await pi.exec("sh", ["-c", FINGERPRINT_COMMAND], {
			cwd,
			timeout: FINGERPRINT_TIMEOUT_MS,
		});
		if (result.code !== 0 && result.code !== null) {
			return null;
		}
		return result.stdout;
	} catch {
		return null;
	}
}