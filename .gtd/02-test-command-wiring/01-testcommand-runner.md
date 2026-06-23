# Task: Wire configurable testCommand through TestRunner and main.ts

Make the test command come from `ConfigService` (added in package 01) instead of
the hardcoded `Command.make("npm", "run", "test")`. This is ONE task because the
three files are tightly coupled: `TestRunner.Live` gains a dependency on
`ConfigService`, its test must construct that dependency, and `main.ts` must
provide `ConfigService.Live` so the layer stack still type-checks and runs.
Splitting them would leave the tree red.

This is a complete, demoable vertical slice: a custom `testCommand` in a
`.gtdrc` actually drives the runner.

## Current state

- `src/TestRunner.ts:27`: `Command.make("npm", "run", "test")` hardcoded inside
  `TestRunner.Live` (a `Layer.effect` that currently yields only
  `CommandExecutor`).
- `src/TestRunner.test.ts`: asserts the command is literally `npm run test` via
  a fixture `package.json` whose `test` script echoes sentinels.
- `src/main.ts:48-58`: layer stack provides `GitService.Live`,
  `TestRunner.Live`, `NodeContext.layer`. The two test-gated leaves
  (`human-review`, `execute`) call `runner.run()` at `src/main.ts:34-37`.

## What to build

### `src/TestRunner.ts`

- [ ] `TestRunner.Live` additionally `yield*`s `ConfigService` and reads
      `testCommand`.
- [ ] Tokenize `testCommand` into argv (split on whitespace; a simple
      whitespace split is acceptable for the default `npm run test` and typical
      commands — document that quoting/escaping is not supported, matching the
      plan's scope). Pass the tokens to `Command.make(head, ...rest)` instead of
      the hardcoded literal.
- [ ] Update the `// Hardcoded command per the plan: npm run test` comment to
      reflect that the command now comes from `ConfigService` (default
      `npm run test`).
- [ ] Because `TestRunner.Live` now depends on `ConfigService`, the
      `requirements` type of `TestRunner.Live` will include `ConfigService`.
      Ensure that flows correctly (do NOT bake `ConfigService.Live` into
      `TestRunner.Live` — provide it at the `main.ts` composition root, keeping
      layers composable like `GitService`).

### `src/main.ts`

- [ ] Add `Effect.provide(ConfigService.Live)` to the layer stack at
      `src/main.ts:48-58` (alongside `GitService.Live`, `TestRunner.Live`,
      `NodeContext.layer`) so `ConfigService` is satisfied for `TestRunner.Live`.
- [ ] Confirm the program still type-checks (`npm run typecheck`) and the
      existing test-gate behavior is unchanged when no config file is present.
- [ ] Do NOT thread `resolveModel` into `buildPrompt` here — that is package 03.
      Only the testCommand/ConfigService.Live wiring belongs in this package.

### `src/TestRunner.test.ts`

- [ ] Provide `ConfigService.Live` in the test's `run` helper layer stack (it is
      now a dependency of `TestRunner.Live`). The existing fixtures create a
      temp project with no `.gtdrc`, so `ConfigService` resolves the default
      `testCommand === "npm run test"` — keep all existing default-path
      assertions passing unchanged.
- [ ] Add a new test for the configured-command path: write a `.gtdrc.yaml` (or
      `.gtdrc.json`) in the temp project dir setting `testCommand` to a custom
      command (e.g. a script that echoes a distinct sentinel, or
      `"npm run othertest"` with a matching script in the fixture
      `package.json`), and assert the runner invokes THAT command (the sentinel
      appears in `output`). This proves the config value reaches `Command.make`.
- [ ] Keep the existing "proving the command is `npm run test`" default-path
      test green (no config ⇒ default).

## Constraints / edge cases

- Default behavior must be byte-for-byte preserved when no config exists
  (backward compat — existing repos and tests rely on `npm run test`).
- Tokenization is whitespace-split only; no shell features. The default
  `npm run test` tokenizes to `["npm","run","test"]`.
- This package does not need a bundle rebuild: `npm run test` (vitest) tests
  `src/` directly. The bundle rebuild happens in package 04.

## Acceptance criteria

- [ ] `TestRunner.Live` reads `testCommand` from `ConfigService` and runs it.
- [ ] `main.ts` provides `ConfigService.Live`; `npm run typecheck` passes.
- [ ] `src/TestRunner.test.ts` covers both the default path (`npm run test`) and
      a custom `testCommand` from a `.gtdrc`, all green.
- [ ] `npm run test` (vitest) is fully green.

## Files

- Edit: `src/TestRunner.ts`, `src/TestRunner.test.ts`, `src/main.ts`
- Depends on: `src/Config.ts` (`ConfigService`, package 01)
- Reference: `src/Git.ts` (composable layer pattern)
