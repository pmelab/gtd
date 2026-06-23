---
status: simple
---

# Follow-up: revert .gtdrc-testCommand prompt prose + document deepMerge

Feedback from the review of the config system (base `32a006f`).

## Plan

> **File count: 5** — `src/prompts/execute-simple.md`,
> `src/prompts/close-review.md`, `src/prompts/verified.md`,
> `src/prompts/escalate.md`, `src/Config.ts`. ≤5 distinct files, both changes
> small and mechanical → `status: simple`. No test, README, or SKILL changes
> (see notes below).

Two concrete code changes. NO `{{TEST_COMMAND}}` placeholder, NO `buildPrompt`
signature change, NO `DEFAULT_TEST_COMMAND` export — the configured
`testCommand` is used ONLY by the deterministic edge (already the case via
`main.ts` `TEST_GATED_LEAVES`). All prompts let the agent discover the
appropriate test command itself, as before package 04.

### Change 1 — Revert the `.gtdrc`-testCommand prose in 4 prompts

Package 04 (commit `c8ad13f`) inserted "the `.gtdrc` `testCommand` config takes
precedence" into four agent-run test-gate prompts. Revert each back to the exact
pre-package-04 generic test-discovery wording (no `.gtdrc`/config reference):

- **`src/prompts/execute-simple.md`** — Step 2, list item 1 (lines 39-41).
  Currently:

  > 1. Determine the test command. The `.gtdrc` `testCommand` config takes
  >    precedence if set; otherwise fall back to project configuration
  >    (AGENTS.md, `package.json` scripts, Makefile, etc.). If unclear, ask the
  >    user.

  Revert to:

  > 1. Determine the test command from project configuration (AGENTS.md,
  >    `package.json` scripts, Makefile, etc.). If unclear, ask the user.

- **`src/prompts/close-review.md`** — "Test gate (run first)" para (lines 3-5).
  Currently:

  > Before doing anything else, run the project's test suite. The `.gtdrc`
  > `testCommand` config takes precedence if set; otherwise determine the
  > command from AGENTS.md / `package.json` scripts / Makefile.

  Revert to:

  > Before doing anything else, run the project's test suite (determine the
  > command from AGENTS.md / `package.json` scripts / Makefile).

- **`src/prompts/verified.md`** — "Test gate (run first)" para (lines 3-5),
  identical text to `close-review.md`. Revert to the same pre-package-04
  wording:

  > Before doing anything else, run the project's test suite (determine the
  > command from AGENTS.md / `package.json` scripts / Makefile).

- **`src/prompts/escalate.md`** — Step 1 (lines 11-14). Currently:

  > 1. **Re-run the test suite** so the human sees the current failure. The
  >    `.gtdrc` `testCommand` config takes precedence if set; otherwise
  >    determine the test command from project configuration (AGENTS.md,
  >    `package.json` scripts, Makefile, etc.).

  Revert to:

  > 1. **Re-run the test suite** so the human sees the current failure.
  >    Determine the test command from project configuration (AGENTS.md,
  >    `package.json` scripts, Makefile, etc.).

### Change 2 — Document why `deepMerge` is hand-rolled (`src/Config.ts`)

Keep the hand-rolled `deepMerge` / `walkUp` / `loadMerged`. The `!!` comment is
already gone (Config.ts was reverted). Only remaining work: expand the existing
one-line comment above `deepMerge` (`src/Config.ts:67`) to document WHY the
manual walk+merge exists — cosmiconfig v9 `search()` stops at the **first**
config it finds and has no native cross-level auto-merge (its only merge
mechanism is the explicit `$import` key, which would force users to hand-author
import chains and lose the implicit cwd→home layering). So the manual walk+merge
with innermost-wins semantics is intentional.

### Notes for the next phase (do NOT touch)

- **README.md / SKILL.md** — confirmed they document `testCommand` strictly as
  the **edge** command (README.md:99,137; SKILL.md:51,109). That remains
  accurate. No change.
- **`tests/integration/features/config.feature`** — confirmed: its scenarios
  assert only that the edge runs the resolved `testCommand` (e.g. "A custom
  testCommand reaches the runner") and that model names land in prompt sections.
  NO scenario asserts on prompt prose telling the agent to read `.gtdrc`/"takes
  precedence", so none need updating. The "custom testCommand reaches the
  runner" edge scenario stays valid.
- No code-side change (`Prompt.ts`, `main.ts`, `Config.ts`
  schema/`resolveModel`) — Item 1 is a pure prose revert, Items 2 and 3 require
  no code change.

## Resolved

### Item 1 — How should `{{TEST_COMMAND}}` be threaded into `buildPrompt`, and which prompts get it?

**Recommendation:** Thread the resolved test command as a fourth parameter to
`buildPrompt`, substituting `{{TEST_COMMAND}}` unconditionally for the four
agent-run leaves (`execute-simple`, `close-review`, `verified`, `escalate`),
export `DEFAULT_TEST_COMMAND` from `Config.ts`, and pass `config.testCommand` at
both `main.ts` call sites.

**Answer:** "i was wrong about this. the configured test command should _only_
be used for the deterministic execution at the edge. all prompts are free to
figure out which tests to run for individual tasks." — This reverses the
recommendation. No `{{TEST_COMMAND}}` injection, no `buildPrompt` change. The
work is to REVERT package 04's `.gtdrc`-testCommand prose in the 4 prompts back
to generic test-discovery wording (Change 1).

### Item 2 — Keep the hand-rolled `deepMerge`/`walkUp`, or drop it for a cosmiconfig-native approach?

**Recommendation:** Keep the custom walk+merge. cosmiconfig v9 `search()` stops
at the first config and never merges across levels; its only merge mechanism is
the explicit `$import` key, which can't satisfy gtd's implicit cwd→home
auto-merge with innermost-wins semantics (asserted by `Config.test.ts`).
Document the finding and keep `deepMerge`+`walkUp`.

**Answer:** "ok, keep it" — Keep `deepMerge`/`walkUp`/`loadMerged`. Add an
explanatory comment above `deepMerge` documenting why it exists (Change 2).

### Item 3 — Collapse `new-todo` + `modified-todo` into one `grilling` model key, or leave as-is?

**Recommendation:** Option A — leave the state machine and config surface alone,
just clear the `!!`. The two are genuinely distinct states; the per-state model
keys are optional overrides and harmless. (Option B would add a single
`grilling` config key collapsing both, touching
schema/`resolveModel`/docs/tests.)

**Answer:** "go with A" — No code change. Per-state model keys stay granular.
The `!!` observation is already removed. Nothing to implement.
