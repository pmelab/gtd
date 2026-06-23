# Review: 32a006f

<!-- base: 32a006fa40120783c57051f166e8dcc0b67a5cd0 -->

## ConfigService: hierarchical .gtdrc loader

New Effect `ConfigService` (`Context.Tag` + `static Live`) that loads `.gtdrc`
via cosmiconfig, walking from cwd up to the home dir — or the filesystem root
when cwd is outside home, which is what makes temp-dir tests and the
shared-worktree-parent cascade work. Every level found is deep-merged with the
innermost (cwd) winning. The merged object is decoded with `effect/Schema`:
optional `testCommand` (default `npm run test`) and a `models` block with
`planning`/`execution` tiers plus a closed `states` struct of exactly the 5
subagent-spawning states — unknown keys (e.g. `fix-tests`) fail decode rather
than being stripped. `resolveModel(state)` resolves state-override → tier →
built-in (Opus/Sonnet). Adds `cosmiconfig` to dependencies.

- [ ] ./src/Config.ts#1
- [ ] ./src/Config.test.ts#1
- [ ] ./package.json#1
- [ ] ./package-lock.json#1

## Drive the test gate from configurable testCommand

`TestRunner.Live` now depends on `ConfigService`, reads `testCommand`, and
tokenizes it (whitespace split — no shell quoting) into `Command.make` instead
of the hardcoded `npm run test`. `main.ts` provides `ConfigService.Live` at the
composition root so the dependency stays composable. Default behavior is
preserved when no config exists.

- [ ] ./src/TestRunner.ts#18
- [ ] ./src/main.ts#23
- [ ] ./src/TestRunner.test.ts#1

## Inject resolved model names into prompts

`buildPrompt` gains an optional `resolveModel` (defaulting to a built-in
resolver that reuses `Config.ts`'s tier map) and substitutes a `{{MODEL}}`
placeholder in the 5 subagent-spawning prompt sections; `main.ts` passes
`ConfigService.resolveModel`. The prompt `.md` files drop the "check AGENTS.md
for model preferences" prose in favor of the injected model directive.
`header.md` loses its two-tier explainer; `fix-tests` (no subagent) gets no
injection and no placeholder leaks.

- [ ] ./src/Prompt.ts#15
- [ ] ./src/Prompt.ts#149
- [ ] ./src/Prompt.test.ts#1
- [ ] ./src/prompts/header.md#1
- [ ] ./src/prompts/new-todo.md#19
- [ ] ./src/prompts/modified-todo.md#22
- [ ] ./src/prompts/decompose.md#8
- [ ] ./src/prompts/execute.md#11
- [ ] ./src/prompts/execute-simple.md#8

## Test-command discovery prose points at .gtdrc

Prompts that tell an agent to determine the test command now note the `.gtdrc`
`testCommand` takes precedence before falling back to package.json/Makefile.

- [ ] ./src/prompts/execute-simple.md#41
- [ ] ./src/prompts/close-review.md#1
- [ ] ./src/prompts/verified.md#1
- [ ] ./src/prompts/escalate.md#1

## Docs: document the config system

README.md and SKILL.md replace the AGENTS.md model-preferences sections with a
`.gtdrc` Configuration section (filenames, schema, cwd→home cascade, worktree
use case, innermost-wins precedence, overridable testCommand, built-in
defaults).

- [ ] ./README.md#1
- [ ] ./SKILL.md#1

## E2E coverage + bundle rebuild

New `config.feature` (9 scenarios) drives the config system through the bundled
CLI: custom testCommand reaching the runner, per-state and tier models landing
in the right prompt sections, override-beats-tier, built-in defaults, fix-tests
carrying no model, and the cwd→ancestor merge/cascade. New generic
content-exposing Given steps in `config.steps.ts`. `branches.feature` updates a
stale `"planning model"` assertion to `"planning-model subagent"` (exposed once
the bundle was rebuilt from current prompts).

- [ ] ./tests/integration/features/config.feature#1
- [ ] ./tests/integration/support/steps/config.steps.ts#1
- [ ] ./tests/integration/features/branches.feature#82

## Regenerated bundle

`scripts/gtd.js` is the checked-in tsup build artifact, regenerated from the
edited sources (now inlining cosmiconfig). Not reviewed line-by-line — note the
bundle size grew substantially (cosmiconfig pulled in its default loaders).

- [ ] ./scripts/gtd.js#1
