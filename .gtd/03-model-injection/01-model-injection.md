# Task: Inject resolved model names into the 5 subagent-spawning prompts

Make `buildPrompt` substitute a concrete per-state model name into the 5 prompts
that spawn subagents, replacing the "check AGENTS.md for model preferences"
prose. This is ONE task because changing `buildPrompt`'s signature and the
placeholder-bearing prompt files together is the only way to keep the tree
green: the prompt `.md` files, `src/Prompt.ts`, `src/Prompt.test.ts`, and
`src/main.ts` (which calls `buildPrompt`) are all coupled to the signature.

## Current state

- `buildPrompt(result, override?)` in `src/Prompt.ts:131` assembles `header` +
  context + the per-state section. Prompt `.md` files are imported as text and
  inlined verbatim (`SECTIONS` map, `src/Prompt.ts:20-35`).
- `src/main.ts:39,44` call `buildPrompt`. `src/State.test.ts:105,112,120` and
  `src/Prompt.test.ts` (many calls) also call it.
- The 5 subagent-spawning prompts carry model prose:
  - `src/prompts/header.md:5-10` — two-tier "work model / planning model" +
    "Check your user/project AGENTS.md for model preferences" prose (shared
    boilerplate; NO per-state injection — just drop the AGENTS.md prose).
  - `src/prompts/new-todo.md:19-22` — "Spawn a planning-model subagent … Check
    your user/project AGENTS.md … default to Opus".
  - `src/prompts/modified-todo.md:22-25` — same planning prose.
  - `src/prompts/decompose.md:8-11` — same planning prose.
  - `src/prompts/execute.md:11-23` — execution-model prose ("The execution model
    from AGENTS.md (or current work model)").
  - `src/prompts/execute-simple.md:8-18` — execution-model prose.
- `src/prompts/fix-tests.md` gets NO model injection (inline fix loop, no
  subagent) — do NOT edit it for models.

## What to build

### `buildPrompt` signature (`src/Prompt.ts`)

- [ ] Add an OPTIONAL `resolveModel` parameter — a function
      `(state: ModelState) => string` (import the `ModelState` type and the
      resolver shape from `src/Config.ts`). Make it optional with a built-in
      default that returns the built-in tier defaults (planning →
      `claude-opus-4-8` for `new-todo`/`modified-todo`/`decompose`, execution →
      `claude-sonnet-4-8` for `execute`/`execute-simple`). This keeps existing
      callers in `src/State.test.ts` and most of `src/Prompt.test.ts` working
      WITHOUT passing a resolver (tree stays green), while `main.ts` passes the
      real `ConfigService.resolveModel`.
      - Place the new parameter so existing positional calls
        `buildPrompt(result)` and `buildPrompt(result, override)` still compile.
        Prefer either a third positional optional param after `override`, or an
        options object — choose what keeps all existing call sites compiling
        unchanged. Whichever you pick, `main.ts` must pass the real resolver.
- [ ] For each of the 5 subagent-spawning sections, substitute the resolved
      model name into a placeholder token in the corresponding `.md` (see
      below). Use a unique, unambiguous placeholder token per file (e.g.
      `{{MODEL}}`) and replace it in `buildPrompt` after selecting the section,
      with `resolveModel(<that state>)`. `header.md` carries NO placeholder.
- [ ] `fix-tests` override path: unchanged — no model injection.

### Prompt edits

Replace the AGENTS.md model prose with a concrete injected directive:

- [ ] `src/prompts/header.md` — drop the two-tier explanation + "Check your
      user/project AGENTS.md for model preferences" sentence (lines ~5-10). Keep
      the surrounding orchestration framing and the "Do not ask the user
      clarifying questions" guidance. No placeholder token (shared boilerplate).
- [ ] `src/prompts/new-todo.md` — replace the "Check your user/project AGENTS.md
      … default to Opus" prose (lines ~19-22) with a directive naming the
      injected model via the `{{MODEL}}` placeholder, e.g. "Spawn a
      planning-model subagent using model `{{MODEL}}`." Keep the rest.
- [ ] `src/prompts/modified-todo.md` — same treatment (lines ~22-25).
- [ ] `src/prompts/decompose.md` — same treatment (lines ~8-11).
- [ ] `src/prompts/execute.md` — replace the "The execution model from AGENTS.md
      (or current work model)" lines (~11-23, including the `- **Model**:` bullet
      in Step 1) with the injected `{{MODEL}}`. The parallel task workers use
      this model.
- [ ] `src/prompts/execute-simple.md` — replace the execution-model prose
      (~8-18, the orchestration model note and Step 1 `- **Model**:` bullet) with
      the injected `{{MODEL}}`. (Leave the Step 2 testing-subagent "same as
      worker" wording referencing the same model; and leave the test-command
      discovery reference in Step 2/`:41` for the docs/test-command package — do
      NOT alter test-command prose here.)

### `src/main.ts`

- [ ] Obtain `ConfigService` and pass its `resolveModel` into both `buildPrompt`
      call sites (`src/main.ts:39` and `:44`). `ConfigService.Live` is already in
      the layer stack (provided in package 02), so you can `yield* ConfigService`
      in the program and pass `config.resolveModel`.

### `src/Prompt.test.ts`

- [ ] Add assertions that each of the 5 subagent-spawning prompts contains the
      resolved model name. Test BOTH: (a) the built-in defaults appear when no
      resolver is passed (planning states show `claude-opus-4-8`, execution
      states show `claude-sonnet-4-8`); (b) when a custom `resolveModel` is
      passed (e.g. returning a sentinel like `MODEL-FOR-<state>`), that sentinel
      appears in the right section, and a per-state override beats its tier.
- [ ] Assert the prompts NO LONGER contain "Check your user/project AGENTS.md"
      model-preference prose (`new-todo`, `modified-todo`, `decompose`,
      `execute`, `execute-simple`, and the dropped `header.md` two-tier prose).
- [ ] Assert `fix-tests` override output contains NO injected model directive /
      `{{MODEL}}` placeholder.
- [ ] Keep all existing `src/Prompt.test.ts` and `src/State.test.ts`
      assertions green (they call `buildPrompt` without a resolver and must
      still work via the built-in default).

## Constraints / edge cases

- No raw `{{MODEL}}` placeholder may survive into emitted output for any state —
  verify it is replaced for all 5 sections and absent everywhere else.
- The built-in default resolver inside `buildPrompt` and `ConfigService`'s
  defaults must agree (Opus/Sonnet) — reuse the `ModelState`/tier mapping from
  `src/Config.ts` rather than hardcoding a second copy if practical.
- Do NOT touch `fix-tests.md` for models. Do NOT touch the test-command prose in
  `close-review.md`, `verified.md`, `escalate.md`, or `execute-simple.md:41`
  (that belongs to package 04 docs work).
- No bundle rebuild needed here (vitest tests `src/` directly). Package 04
  rebuilds `scripts/gtd.js` for the e2e suite.

## Acceptance criteria

- [ ] The 5 subagent-spawning prompts emit a concrete model name (default
      Opus/Sonnet, or the injected one from `resolveModel`).
- [ ] `header.md` and all 5 prompts no longer carry the "check AGENTS.md for
      model preferences" prose.
- [ ] `main.ts` passes `ConfigService.resolveModel` into `buildPrompt`.
- [ ] `fix-tests` carries no injected model.
- [ ] `src/Prompt.test.ts` covers default + injected + per-state-override +
      no-leak cases; `npm run test` is fully green (incl. `State.test.ts`).

## Files

- Edit: `src/Prompt.ts`, `src/Prompt.test.ts`, `src/main.ts`,
  `src/prompts/header.md`, `src/prompts/new-todo.md`,
  `src/prompts/modified-todo.md`, `src/prompts/decompose.md`,
  `src/prompts/execute.md`, `src/prompts/execute-simple.md`
- Depends on: `src/Config.ts` (`ModelState`, `resolveModel`, package 01),
  `ConfigService.Live` wired in `main.ts` (package 02)
- Do NOT edit: `src/prompts/fix-tests.md`
