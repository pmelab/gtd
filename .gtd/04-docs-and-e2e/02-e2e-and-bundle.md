# Task: testCommand-prose prompt edits, cucumber e2e coverage, and bundle rebuild

Finish the prompt prose updates for test-command discovery, add cucumber
scenarios proving the config system end-to-end through the bundled CLI, and
rebuild `scripts/gtd.js` so the e2e suite runs the current code. These are ONE
task because they have an intra-task ordering dependency: the e2e assertions and
the bundle must reflect the prompt prose edits, so the rebuild must happen AFTER
the prose edits within the same task. This task is file-disjoint from the
sibling docs task (which owns README/SKILL/AGENTS only).

## Background / critical constraint

- The cucumber e2e suite (`npm run test:e2e`) runs the BUNDLED CLI at
  `scripts/gtd.js` (see `tests/integration/support/world.ts`), built by tsup
  (`tsup.config.ts`, `noExternal: [/.*/]`). After ALL source/prompt changes from
  packages 01-03 AND this task's prose edits are committed, you MUST run
  `npm run build` and commit the regenerated `scripts/gtd.js` so the e2e suite
  exercises the current behavior (incl. ConfigService + model injection).
  - `npm run test` (vitest) tests `src/` directly and does NOT need the rebuild.
- **Walk/home edge case for e2e:** the test world creates repos under
  `os.tmpdir()` (e.g. `/var/folders/...` on macOS), which is NOT under the
  user's home dir. ConfigService walks cwd→up and stops at home OR filesystem
  root. So a `.gtdrc` placed in the temp repo's cwd (or an ancestor temp dir)
  WILL be found via the root-stop path. Place config files inside the temp repo
  (cwd) and/or a created ancestor temp dir — do not rely on home-dir configs in
  e2e. Add a composable Given step to write a gtd config file at a given path.

## What to build

### 1. Test-command prose prompt edits

The plan notes prompts still reference AGENTS.md/package.json for the TEST
COMMAND (not models). Update these to mention the `.gtdrc` `testCommand` config
FIRST (config takes precedence), then fall back to package.json/Makefile:

- [ ] `src/prompts/execute-simple.md` (Step 2 testing-subagent, ~line 41) —
      "Determine the test command from project configuration" → mention the
      `.gtdrc` `testCommand` first. (Do NOT touch the model directive added in
      package 03.)
- [ ] `src/prompts/close-review.md`, `src/prompts/verified.md`,
      `src/prompts/escalate.md` — wherever they reference test-command discovery,
      add that the `.gtdrc` `testCommand` config takes precedence. Verify which
      of these actually contain test-command prose before editing; if a file has
      none, skip it (no-op).
- [ ] Leave `fix-tests.md` / `new-todo.md` / `modified-todo.md` test-gate prose
      as-is unless they explicitly tell the agent to "determine the command" — if
      they do, note `.gtdrc testCommand` takes precedence. Keep edits minimal and
      prose-only; do not change behavior wording beyond test-command discovery.

### 2. Cucumber feature `tests/integration/features/config.feature`

Follow AGENTS.md testing conventions: small composable Given steps that expose
REAL file content in scenario text; one step ≈ one commit/setup action. Add new
step defs in `tests/integration/support/steps/config.steps.ts` (alongside
`common.steps.ts`, `review.steps.ts`, `formatting.steps.ts`). Reuse existing
common steps where possible.

Add a composable Given like:
`Given a gtd config file at "<relativePathOrDir>" with:` (writes the given YAML
or JSON content to that path — supports placing configs at cwd, the repo root,
or a created ancestor dir under tmpdir).

Scenarios to cover (each green-on-its-own, asserting on emitted prompt text via
`stdout contains`):

- [ ] **Custom testCommand reaches the runner.** A `.gtdrc` with a custom
      `testCommand` whose script emits a distinct sentinel; drive a test-gated
      leaf (mirror `tests/integration/features/test-gate.feature` setup: clean
      tree + prior review commit so `human-review` runs the gate) and assert the
      sentinel from the CUSTOM command appears in stdout (proving config beat the
      default `npm run test`).
- [ ] **Per-state model appears in the right prompt section.** Reach a
      subagent-spawning leaf (e.g. `decompose` or `new-todo`) and assert the
      resolved planning-tier model name appears in that prompt section; reach an
      execution leaf (e.g. `execute`) and assert the execution-tier model name
      appears.
- [ ] **Per-state override beats its tier.** A `.gtdrc` setting
      `models.states.decompose` to a distinct value; assert that exact value
      appears in the decompose prompt (and the tier default does not, for that
      section).
- [ ] **Built-in defaults with no config.** No `.gtdrc`; assert the
      planning-tier default (`claude-opus-4-8`) appears in a planning prompt and
      the execution default (`claude-sonnet-4-8`) in an execution prompt.
- [ ] **fix-tests carries NO injected model.** Reach the fix-tests prompt (red
      test gate below the cap, like test-gate.feature scenario 2) and assert it
      contains no model directive / no leftover `{{MODEL}}` placeholder.
- [ ] **cwd→home / merge precedence cascade.** A config in an ancestor temp dir
      AND one in the repo cwd; assert the cwd value wins for an overlapping key
      while a non-overlapping ancestor key still applies (e.g. ancestor sets
      `testCommand`, cwd sets a model override, both observed). This proves
      merge-all-levels + innermost-wins through the bundled CLI.
- [ ] **Shared-parent cascades to a worktree.** A `.gtdrc` in a shared ancestor
      temp dir (not a git root) applies to a repo checked out beneath it (assert
      its `testCommand`/model reaches the prompt). (May be combined with the
      cascade scenario above if cleaner.)

### 3. Rebuild and commit the bundle

- [ ] After the prose edits above are in place AND packages 01-03 are committed,
      run `npm run build`.
- [ ] Confirm the bundle loads ConfigService correctly: run the bundled CLI
      manually in a temp dir with a `.gtdrc` and verify no `.js`-loader eval was
      pulled in (cosmiconfig bundled cleanly). A quick smoke check is acceptable.
- [ ] Commit the regenerated `scripts/gtd.js` as part of this package.
- [ ] Run `npm run test:e2e` and ensure all scenarios (new + existing) pass.

## Constraints / edge cases

- Do NOT edit README.md, SKILL.md, or AGENTS.md (sibling docs task owns them).
- Do NOT edit `src/` TypeScript or model directives in prompts (packages 01-03
  own those). Only test-command PROSE in the listed prompt files.
- Keep new Given steps generic and content-exposing per AGENTS.md.
- The e2e suite must be GREEN at the end (`npm run test:e2e`), and `npm run test`
  (vitest) must remain green.

## Acceptance criteria

- [ ] Test-command discovery prose in `execute-simple.md` (and any of
      `close-review.md`/`verified.md`/`escalate.md` that have it) mentions the
      `.gtdrc` `testCommand` takes precedence.
- [ ] `tests/integration/features/config.feature` + `config.steps.ts` cover:
      custom testCommand, per-state model in the right section, override beats
      tier, built-in defaults, fix-tests has no model, cwd→home merge
      precedence, shared-parent cascade.
- [ ] `scripts/gtd.js` rebuilt and committed; cosmiconfig bundles cleanly.
- [ ] `npm run test:e2e` and `npm run test` both green.

## Files

- Edit: `src/prompts/execute-simple.md`, and as applicable
  `src/prompts/close-review.md`, `src/prompts/verified.md`,
  `src/prompts/escalate.md`
- Create: `tests/integration/features/config.feature`,
  `tests/integration/support/steps/config.steps.ts`
- Possibly edit: `tests/integration/helpers/project-setup.ts` (if a setup helper
  is needed — prefer inlining per AGENTS.md)
- Rebuild + commit: `scripts/gtd.js` (via `npm run build`)
- Reference: `tests/integration/features/test-gate.feature`,
  `tests/integration/support/world.ts`,
  `tests/integration/support/steps/common.steps.ts`, `tsup.config.ts`
