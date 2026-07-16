# AGENTS.md — pi-guard-rails

## Project overview

`pi-guard-rails` is a [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension.
It runs configured guard commands (lint, test, build, …) in a feedback loop after the agent finishes a turn.
If a guard fails, the failure output is injected back into the session so the agent can fix it, looping until all guards pass or `maxIterations` is reached.

- Runtime: Node.js (ESM, `"type": "module"`)
- Language: TypeScript
- Test runner: Vitest
- Extension lives in `extensions/guard-rails/`
- Source: `extensions/guard-rails/src/`
- Tests: `extensions/guard-rails/src/__tests__/`

## Commands

| Task | Command |
|------|---------|
| Run tests once | `npm test` |
| Run tests in watch mode | `npm run test:watch` |
| Type check | `npx tsc --noEmit` |

Tests live in `extensions/guard-rails/src/__tests__/` and are picked up by Vitest (config is resolved from the repo root via `package.json`).

## Mandatory workflow rules for agents

### 1. Guard rail — always run tests before finishing implementation

Before declaring any implementation task complete, you **MUST** run the test suite and ensure it passes:

```bash
npm test
```

- If any test fails, fix the code (or the test) and re-run until green.
- Never mark a task as completed with failing or skipped tests.
- This is the project's own guard rail: it mirrors the feedback-loop behaviour the extension enforces on the agent.

### 2. Functional style — no classes, no `let`

All source code in `extensions/guard-rails/src/` must be written in a functional style:

- **No `class` declarations.** Use plain functions, factory functions, and module-level pure functions.
- **No `let`.** Use `const` for every binding. If you need mutation, express it via a returned new value rather than reassignment.
- Prefer **pure functions** with no side effects; keep side-effectful code (I/O, process spawning, config reads) at the edges and inject it as dependencies where practical.
- Use higher-order array methods — `map`, `filter`, `reduce`, `find`, `some`, `every`, `flatMap` — instead of imperative loops.
- Prefer immutability: build new objects/arrays rather than mutating. Use spread (`{ ...obj }`, `[...arr]`) to derive new values.
- Compose functions with small, single-purpose helpers. Avoid deep nesting; chain/pipeline where readable.

Example shape:

```ts
// good
export const parseGuards = (raw: unknown): Guard[] =>
  Array.isArray(raw)
    ? raw.map(parseGuard).filter((g): g is Guard => g !== null)
    : []

// bad
let acc = []
for (const item of raw) {
  if (item != null) {
    acc.push(item)
  }
}
return acc
```

### 3. Code style

- ESM (`import`/`export`), TypeScript strict types.
- Named exports only; no `default` exports.
- Keep functions small and testable; pure core, injectable effects.
- Do not add comments unless explicitly requested.

## Directory layout

```
extensions/guard-rails/
  src/
    index.ts      # extension entry / lifecycle hook wiring
    config.ts     # .guard-rails.json parsing + schema
    guard.ts      # guard command execution
    loop.ts       # feedback loop orchestration
    __tests__/    # Vitest specs
  package.json
  tsconfig.json
docs/            # PRD, issue map, design notes
```

## Git

- Initialize the repo (`git init`) and commit baseline before starting work.
- Never commit secrets, `.env`, `node_modules/`, or build artifacts.
- Conventional commit messages, scoped to the extension (e.g. `feat(guard-rails): …`, `fix(guard-rails): …`, `test(guard-rails): …`, `docs: …`).