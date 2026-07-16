## Blocked by

- [001-config-schema](./001-config-schema.md)
- [002-agent-end-hook-integration](./002-agent-end-hook-integration.md)
- [003-command-execution](./003-command-execution.md)
- [004-failure-injection](./004-failure-injection.md)
- [005-loop-control](./005-loop-control.md)

## Question

What is the module decomposition and file structure for the guard-rails extension?

- What modules/files should the extension be split into (following the reference project's pattern)?
- What does each module export, and what are its responsibilities?
- How does the extension register itself — what's the factory function shape, what does it subscribe to?
- What npm dependencies are needed beyond the existing peer dependencies (`@earendil-works/pi-coding-agent`)?
- What is the `package.json` shape (name, scripts, devDependencies)?
- How does the extension fit into the monorepo structure — is it under `extensions/guard-rails/` like the reference?

## Resolution

**Location:** `extensions/guard-rails/` in the pi-guard-rails repo, following the reference project's structure.

**File structure:**
```
extensions/guard-rails/
  package.json
  tsconfig.json
  src/
    config.ts
    guard.ts
    loop.ts
    index.ts
    __tests__/
      config.test.ts
      guard.test.ts
      loop.test.ts
      index.test.ts
```

**Module responsibilities:**

| Module | Exports | Responsibilities |
|--------|---------|------------------|
| `config.ts` | `GuardConfig` type, `loadGuardConfig(cwd: string): GuardConfig[]` | Read `.guard-rails.json` from project root, parse JSON, validate fields, apply defaults, return array of guard configs. No-op (return empty array) if missing or malformed. |
| `guard.ts` | `GuardResult` type, `runGuard(pi: ExtensionAPI, guard: GuardConfig): Promise<GuardResult>` | Execute a single guard command via `pi.exec()`, capture stdout/stderr/exit code, enforce timeout, return structured result. |
| `loop.ts` | `LoopState` type, `createLoopState(): LoopState`, `runGuardLoop(pi, ctx, guards, state): Promise<void>` | Manage per-guard iteration counters, run all guards in sequence, inject failure via `pi.sendUserMessage()`, enforce max iterations, handle terminal cases (all pass / max reached). |
| `index.ts` | default export: `ExtensionFactory` | Extension factory function. Subscribes to `agent_end` at load time. Loads config. Orchestrates the guard loop by delegating to `loop.ts`. Manages `isRunningGuards` flag and counter reset logic. |

**Factory function shape:**
```typescript
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const extension: ExtensionFactory = (pi) => {
  // Load config at load time
  // Subscribe to agent_end
  // Manage isRunningGuards flag
  // On clean agent_end: run guard loop
};

export default extension;
```

**Dependencies:**
- `peerDependencies`: `@earendil-works/pi-coding-agent` (same as reference project)
- `devDependencies`: `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `@types/node`, `vitest` (same as reference project)
- No new npm packages. Config validation is manual (type checking + defaults), no zod/typebox.

**package.json shape:**
```json
{
  "name": "pi-guard-rails",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest --run",
    "test:watch": "vitest"
  }
}
```

**Testing strategy:** Follows the reference project's pattern — `vi.mock()` at module level for Pi SDK boundaries, factory functions for mock construction, `beforeEach(vi.clearAllMocks)` for isolation, dynamic import after mocks. Pure functions (`loadGuardConfig`, `runGuard` with mocked `pi.exec`) are testable in isolation. Integration-style tests for the `agent_end` handler wiring.
