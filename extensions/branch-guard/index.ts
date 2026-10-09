import { readFile } from "node:fs/promises";
import { complete, type UserMessage } from "@earendil-works/pi-ai/compat";
import type {
  AgentSettledEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { type FileReader, type GuardConfig, loadConfig } from "./src/config.ts";
import {
  buildBranchProposal,
  buildBranchProposalFromPhrase,
  capturePrompt,
  type GuardState,
  initialGuardState,
  isProtectedBranch,
  isWorktreeBranch,
  markSkipped,
  recordGuardCreatedBranch,
  resolveTaskPrompt,
} from "./src/guard.ts";
import {
  createModelIntentSummarizer,
  type IntentModelDeps,
  type IntentSummarizer,
} from "./src/intent.ts";
import { COMMIT_GUIDELINE } from "./src/lifecycle.ts";
import { commitChanges, createBranch, getCurrentBranch, readTreeState, type TreeState } from "./src/git.ts";

const realFileReader: FileReader = (path) => readFile(path, "utf8");

const MODIFYING_TOOLS: readonly string[] = ["edit", "write"];

interface SessionState {
  config: GuardConfig | undefined;
  guard: GuardState;
  runStartTree: TreeState | undefined;
}

const newSessionState = (): SessionState => ({
  config: undefined,
  guard: initialGuardState(),
  runStartTree: undefined,
});

const makeRunner =
  (pi: ExtensionAPI) => (command: string, args: string[], cwd: string) =>
    pi.exec(command, args, { cwd, timeout: 60000 });

// When launched in Herdr (HERDR_ENV=1), surface branch-guard prompts and results as Herdr notifications; outside Herdr, the extension remains self-contained.
const notifyHerdr = (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  body: string,
  sound: "none" | "done" | "request",
): void => {
  if (process.env.HERDR_ENV !== "1") return;
  void pi
    .exec(
      "herdr",
      [
        "notification",
        "show",
        "Branch guard",
        "--body",
        body,
        "--sound",
        sound,
      ],
      { cwd: ctx.cwd, timeout: 5000 },
    )
    .catch(() => undefined);
};

const notifyBranchCreated = (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  branch: string,
): void => {
  ctx.ui.notify(`Branch guard: created branch ${branch}.`, "info");
};

type IntentSummarizerFor = (ctx: ExtensionContext) => IntentSummarizer;

const productionIntent = (ctx: ExtensionContext): IntentSummarizer =>
  createModelIntentSummarizer(async (): Promise<IntentModelDeps> => {
    const legacyComplete = (
      ctx.modelRegistry as unknown as { complete?: IntentModelDeps["complete"] }
    ).complete;
    if (legacyComplete) {
      return { model: ctx.model, complete: legacyComplete };
    }
    if (!ctx.model) {
      throw new Error("No model is available to summarize the prompt");
    }
    const model = ctx.model;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      throw new Error(auth.ok ? "No API key is available" : auth.error);
    }
    return {
      model,
      complete: async (_model, request) =>
        complete(
          model,
          {
            systemPrompt: request.systemPrompt,
            messages: request.messages.map(
              (message): UserMessage => ({
                role: message.role,
                content: [{ type: "text", text: message.content }],
                timestamp: Date.now(),
              }),
            ),
          },
          { apiKey: auth.apiKey, headers: auth.headers, env: auth.env },
        ),
    };
  });

export const createBranchGuardExtensionWithIntent = (
  readFile: FileReader,
  summarizeIntent: IntentSummarizer,
): ExtensionFactory => createGuardExtension(readFile, () => summarizeIntent);

export const createBranchGuardExtension = (
  readFile: FileReader,
): ExtensionFactory => createGuardExtension(readFile, productionIntent);

const createGuardExtension =
  (readFile: FileReader, intentFor: IntentSummarizerFor): ExtensionFactory =>
    (pi: ExtensionAPI) => {
      const state = { current: newSessionState() };

      const getConfig = async (ctx: ExtensionContext): Promise<GuardConfig> => {
        if (!state.current.config) {
          const config = await loadConfig(readFile, ctx.cwd);
          state.current = { ...state.current, config };
        }
        return state.current.config as GuardConfig;
      };

      const updateGuard = (update: (guard: GuardState) => GuardState): void => {
        state.current = { ...state.current, guard: update(state.current.guard) };
      };

      const resolveProposal = async (
        prompt: string,
        ctx: ExtensionContext,
      ): Promise<ReturnType<typeof buildBranchProposal>> => {
        if (!prompt.trim()) {
          return undefined;
        }
        try {
          const phrase = await intentFor(ctx)(prompt);
          return buildBranchProposalFromPhrase(phrase, prompt);
        } catch {
          return buildBranchProposal(prompt);
        }
      };

      const createGuardedBranch = async (
        branch: string,
        ctx: ExtensionContext,
      ): Promise<{ block?: boolean; reason?: string } | undefined> => {
        const runner = makeRunner(pi);
        const created = await createBranch(runner, ctx.cwd, branch);
        if (!created.ok) {
          return {
            block: true,
            reason: `Branch guard: ${created.failure.message}`,
          };
        }
        updateGuard((guard) => recordGuardCreatedBranch(guard, branch));
        notifyBranchCreated(pi, ctx, branch);
        return undefined;
      };

      const ensureBranchBoundary = async (
        event: ToolCallEvent,
        ctx: ExtensionContext,
      ): Promise<{ block?: boolean; reason?: string } | void> => {
        if (!MODIFYING_TOOLS.includes(event.toolName)) {
          return undefined;
        }

        const config = await getConfig(ctx);
        if (!config.enabled || state.current.guard.skipped) {
          return undefined;
        }

        const runner = makeRunner(pi);
        const branch = await getCurrentBranch(runner, ctx.cwd);
        if (
          !branch ||
          isWorktreeBranch(branch) ||
          !isProtectedBranch(branch, config.protectedBranches)
        ) {
          return undefined;
        }

        const prompt = resolveTaskPrompt(
          state.current.guard,
          ctx.sessionManager.getEntries(),
        );
        const proposal = await resolveProposal(prompt, ctx);
        if (!proposal) {
          ctx.ui.notify(
            `Branch guard: could not derive a branch name from the task. Proceeding on ${branch}.`,
            "warning",
          );
          return undefined;
        }

        if (config.mode === "auto") {
          return createGuardedBranch(proposal.branch, ctx);
        }

        if (!ctx.hasUI) {
          return {
            block: true,
            reason: `Branch guard (ask mode) cannot ask in headless mode while on protected branch ${branch}. Create the branch manually (e.g. /branch) or set mode: "auto" in .pi/branch-guard.json.`,
          };
        }

        const label = `Confirm to create branch ${proposal.branch}`;
        pi.events.emit("herdr:blocked", { active: true, label });
        ctx.ui.notify(
          `Branch guard: select an option to create branch ${proposal.branch}.`,
          "info",
        );
        notifyHerdr(
          pi,
          ctx,
          `Select an option to create branch ${proposal.branch}.`,
          "request",
        );
        const choice = await (async () => {
          try {
            return await ctx.ui.select("Confirm to create branch", [
              label,
              `Proceed unprotected on ${branch} (this session)`,
            ]);
          } finally {
            pi.events.emit("herdr:blocked", { active: false });
          }
        })();
        if (choice === label) {
          return createGuardedBranch(proposal.branch, ctx);
        }

        updateGuard(markSkipped);
        ctx.ui.notify(
          `Branch guard: proceeding unprotected on ${branch} until session end.`,
          "warning",
        );
        return undefined;
      };

      pi.on(
        "before_agent_start",
        async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
          const config = await getConfig(ctx);
          if (config.enabled && config.commitOnSettle) {
            event.systemPromptOptions.promptGuidelines = [
              ...(event.systemPromptOptions.promptGuidelines ?? []),
              COMMIT_GUIDELINE,
            ];
          }
          updateGuard((guard) => capturePrompt(guard, event.prompt));
          const tree = await readTreeState(makeRunner(pi), ctx.cwd);
          state.current = { ...state.current, runStartTree: tree };
        },
      );

      pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext) =>
        ensureBranchBoundary(event, ctx),
      );

      pi.on(
        "agent_settled",
        async (_event: AgentSettledEvent, ctx: ExtensionContext) => {
          const config = await getConfig(ctx);
          const runner = makeRunner(pi);
          const branch = await getCurrentBranch(runner, ctx.cwd);
          if (!config.commitOnSettle) {
            return;
          }

          const isGuardCreated = state.current.guard.guardCreatedBranches.includes(branch);
          if (!isGuardCreated) {
            return;
          }

          const runStartTree = state.current.runStartTree;
          if (runStartTree === undefined) {
            return;
          }
          const tree = await readTreeState(runner, ctx.cwd);
          if (tree === null || tree === runStartTree) {
            return;
          }

          const result = await commitChanges(runner, ctx.cwd, branch.replace("/", ": "));
          if (result.ok) {
            state.current = { ...state.current, runStartTree: "" };
          }
          ctx.ui.notify(
            result.ok
              ? `Branch guard: committed changes on ${branch}.`
              : `Branch guard: commit failed: ${result.message || "unknown Git error"}`,
            result.ok ? "info" : "error",
          );
        },
      );

      pi.registerCommand("branch", {
        description: "Create a task branch; use --name for an exact branch name",
        handler: async (args: string, ctx) => {
          const manualBranch = args.trim().match(/^--name\s+(.+)$/)?.[1]?.trim();
          const task =
            args.trim() ||
            resolveTaskPrompt(
              state.current.guard,
              ctx.sessionManager.getEntries(),
            );
          const proposal = manualBranch ? undefined : await resolveProposal(task, ctx);
          const branch = manualBranch ?? proposal?.branch;
          if (!branch) {
            ctx.ui.notify('Usage: /branch "fix the login bug" or /branch --name feat/my-branch', "error");
            return;
          }
          const result = await createGuardedBranch(branch, ctx);
          if (result?.reason) {
            ctx.ui.notify(result.reason, "error");
          }
        },
      });
    };

export default createBranchGuardExtension(realFileReader);
