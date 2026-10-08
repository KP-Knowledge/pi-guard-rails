import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readTreeState } from "../detect.ts";

function makePi(): ExtensionAPI {
	return {
		exec: vi.fn(),
	} as unknown as ExtensionAPI;
}

describe("readTreeState", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns combined stdout on success", async () => {
		const pi = makePi();
		(pi.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
			stdout: " M a.ts",
			stderr: "",
			code: 0,
			killed: false,
		});

		expect(await readTreeState(pi, "/repo")).toBe(" M a.ts");
		const call = (pi.exec as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(call[0]).toBe("sh");
		expect(call[1][1]).toContain("git rev-parse");
		expect(call[2]).toMatchObject({ cwd: "/repo", timeout: 10_000 });
	});

	it("returns null when not a git repository", async () => {
		const pi = makePi();
		(pi.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
			stdout: "",
			stderr: "fatal: not a git repository",
			code: 128,
			killed: false,
		});

		expect(await readTreeState(pi, "/nope")).toBeNull();
	});

	it("returns null when exec throws", async () => {
		const pi = makePi();
		(pi.exec as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("spawn fail"));

		expect(await readTreeState(pi, "/repo")).toBeNull();
	});
});