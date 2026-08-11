import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let guardEnabled = false;
  let lastTriggerEntryId: string | null = null;
  let hasTriggered = false;

  console.log("[auto-guard-rails] extension loaded");

  // --guardrail CLI flag for non-interactive / headless mode
  pi.registerFlag("guardrail", {
    description: "Enable automatic guard-rails (review + lint + test) after each prompt",
    type: "boolean",
    default: false,
  });

  // Reset on every new session, check CLI flag
  pi.on("session_start", () => {
    console.log("[auto-guard-rails] session_start, resetting");
    lastTriggerEntryId = null;
    hasTriggered = false;
    if (pi.getFlag("guardrail")) {
      guardEnabled = true;
      console.log("[auto-guard-rails] enabled via --guardrail flag");
    }
  });

  // /guardrail command — toggle auto guard-rails on/off
  pi.registerCommand("guardrail", {
    description: "Toggle automatic guard-rails (review + lint + test) after each prompt",
    handler: async (_args, ctx) => {
      guardEnabled = !guardEnabled;
      const status = guardEnabled ? "ON" : "OFF";
      console.log(`[auto-guard-rails] /guardrail toggled -> ${status}`);
      ctx.ui.notify(`Guard-rails auto-run: ${status}`, guardEnabled ? "info" : "info");
      if (guardEnabled) {
        ctx.ui.setStatus("guardrail", "guard-rails: watching");
        ctx.ui.setWidget("guardrail", [
          "🛡️  Guard-rails: WATCHING",
          "─  Auto-trigger after each prompt",
          "─  /guardrail to disable",
        ]);
      } else {
        ctx.ui.setStatus("guardrail", "");
        ctx.ui.setWidget("guardrail", []);
      }
    },
  });

  // For print mode: append guard-rails instruction directly to the prompt
  pi.on("input", async (event, ctx) => {
    if (!guardEnabled) return { action: "continue" };
    if (ctx.mode !== "print") return { action: "continue" };
    if (hasTriggered) return { action: "continue" };

    console.log("[auto-guard-rails] print mode, appending guard-rails to prompt");
    hasTriggered = true;

    return {
      action: "transform",
      text: event.text + '\n\nAfter completing the above, run the guard-rails workflow to review, lint, and test the changes.',
    };
  });

  // Auto-trigger guard-rails after agent settles (interactive mode)
  pi.on("agent_settled", async (_event, ctx) => {
    console.log(`[auto-guard-rails] agent_settled fired, enabled=${guardEnabled}`);

    if (!guardEnabled) {
      console.log("[auto-guard-rails] skipped: not enabled");
      return;
    }

    // Prevent double-fire within same session
    if (hasTriggered) {
      console.log("[auto-guard-rails] skipped: already triggered this session");
      return;
    }

    // Show hook activity
    ctx.ui.setStatus("guardrail", "guard-rails: checking...");

    // Find the last user message
    const entries = ctx.sessionManager.getEntries();
    const lastUserEntry = [...entries].reverse().find(
      (e) => e.role === "user"
    );
    if (!lastUserEntry) {
      // Print mode or no entries yet — trigger anyway (once)
      console.log("[auto-guard-rails] no user entry, triggering (print mode)");
      hasTriggered = true;
      pi.sendUserMessage(
        '/workflow run guard-rails "Review the changes, run lint and frontend tests, and fix any issues."'
      );
      return;
    }

    console.log(`[auto-guard-rails] last user entry id=${lastUserEntry.id}, lastTrigger=${lastTriggerEntryId}`);

    if (lastUserEntry.id === lastTriggerEntryId) {
      console.log("[auto-guard-rails] skipped: same entry as last trigger");
      ctx.ui.setStatus("guardrail", "guard-rails: watching");
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
      // Clear running status when workflow finishes, restore watching
      if (text.startsWith("/workflow")) {
        ctx.ui.notify("✅ Guard-rails complete", "info");
        ctx.ui.setStatus("guardrail", "guard-rails: watching");
      } else {
        ctx.ui.setStatus("guardrail", "guard-rails: watching");
      }
      return;
    }

    lastTriggerEntryId = lastUserEntry.id;
    hasTriggered = true;
    console.log("[auto-guard-rails] queueing guard-rails workflow...");

    ctx.ui.notify("🔍 Running guard-rails (review → lint → test)...", "info");
    ctx.ui.setStatus("guardrail", "guard-rails: running...");

    pi.sendUserMessage(
      '/workflow run guard-rails "Review the changes, run lint and frontend tests, and fix any issues."'
    );
  });
}
