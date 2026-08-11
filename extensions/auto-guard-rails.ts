import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let guardEnabled = false;
  let lastTriggerEntryId: string | null = null;

  console.log("[auto-guard-rails] extension loaded");

  // --guardrail CLI flag for non-interactive / headless mode
  pi.registerFlag("guardrail", {
    description: "Enable automatic guard-rails (review + lint + test) after each prompt",
    handler: () => {
      guardEnabled = true;
      console.log("[auto-guard-rails] enabled via --guardrail flag");
    },
  });

  // Reset on every new session
  pi.on("session_start", () => {
    console.log("[auto-guard-rails] session_start, resetting trigger id");
    lastTriggerEntryId = null;
  });

  // /guardrail command — toggle auto guard-rails on/off
  pi.registerCommand("guardrail", {
    description: "Toggle automatic guard-rails (review + lint + test) after each prompt",
    handler: async (_args, ctx) => {
      guardEnabled = !guardEnabled;
      const status = guardEnabled ? "ON" : "OFF";
      console.log(`[auto-guard-rails] /guardrail toggled -> ${status}`);
      ctx.ui.notify(`Guard-rails auto-run: ${status}`, "info");
      if (guardEnabled) {
        ctx.ui.setStatus("guardrail", "guard-rails: on");
      } else {
        ctx.ui.setStatus("guardrail", "");
      }
    },
  });

  // Auto-trigger guard-rails after agent settles
  pi.on("agent_settled", async (_event, ctx) => {
    console.log(`[auto-guard-rails] agent_settled fired, enabled=${guardEnabled}`);

    if (!guardEnabled) {
      console.log("[auto-guard-rails] skipped: not enabled");
      return;
    }

    // Find the last user message
    const entries = ctx.sessionManager.getEntries();
    const lastUserEntry = [...entries].reverse().find(
      (e) => e.role === "user"
    );
    if (!lastUserEntry) {
      console.log("[auto-guard-rails] skipped: no user entry found");
      return;
    }

    console.log(`[auto-guard-rails] last user entry id=${lastUserEntry.id}, lastTrigger=${lastTriggerEntryId}`);

    if (lastUserEntry.id === lastTriggerEntryId) {
      console.log("[auto-guard-rails] skipped: same entry as last trigger");
      return;
    }

    const text = lastUserEntry.content?.[0]?.text ?? "";
    console.log(`[auto-guard-rails] last user text: "${text.slice(0, 80)}"`);

    if (
      text.startsWith("/workflow") ||
      text.startsWith("/model") ||
      text.startsWith("/compact") ||
      text.startsWith("/resume") ||
      text.startsWith("/new") ||
      text.startsWith("/reload") ||
      text.startsWith("/settings") ||
      text.startsWith("/guardrail") ||
      text.trim() === ""
    ) {
      console.log("[auto-guard-rails] skipped: meta-command or empty");
      return;
    }

    lastTriggerEntryId = lastUserEntry.id;
    console.log("[auto-guard-rails] queueing guard-rails workflow...");

    pi.sendUserMessage(
      '/workflow run guard-rails "Review the changes, run lint and frontend tests, and fix any issues."'
    );
  });
}
