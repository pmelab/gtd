# Prompt: render the `squashing` section + new `src/prompts/squashing.md`

Make `buildPrompt` render the `squashing` state. It is prompt-bearing and
auto-advance: the prompt tells the agent to author a conventional-commits message
from the inlined full-process diff and run the squash itself, then re-run gtd
(auto-advance tail). Model tier = the **planning** tier (Opus), reusing `clean`'s
`MODEL_STATE` mapping (message generation from a diff mirrors Clean authoring
REVIEW.md — Resolved Q4).

## Files

- `src/prompts/squashing.md` (NEW)
- `src/Prompt.ts` (edit)
- `src/Prompt.test.ts` (edit — add a squashing render case)

Depends on: Package 01 (the `squashing` state + `ResolveContext.squashBase/
squashDiff` must exist). Do NOT touch `src/Machine.ts`, `src/Events.ts`,
`src/Config.ts`, or `src/State.ts`.

## `src/prompts/squashing.md` (new prompt)

Author a static markdown section mirroring the style of `src/prompts/clean.md`.
It must:

- State that the process is **approved and done**; the goal is to collapse all
  intermediate `gtd: *` commits into a single conventional-commits commit.
- Instruct the agent to read the **inlined full-process diff** (rendered by
  `Prompt.ts`, see below) and author ONE conventional-commits message:
  `type(scope): subject` with an optional body. Give brief format guidance
  (types: feat/fix/refactor/chore/docs/test; imperative subject; body explains
  the *why*).
- Give the exact squash commands, with the base read from the prompt's
  `Squash base:` line:

  ```
  git reset --soft <squashBase>
  git commit -m "<generated message>"
  ```

  Squash the ENTIRE `<squashBase>..HEAD` range unconditionally — any interleaved
  non-gtd commits are folded in too. No guard, no abort-on-foreign-commit
  (Resolved Q3). The tree is unchanged by a soft reset, so this is a pure history
  rewrite (the resulting commit's tree equals HEAD's tree).
- Note that the agent runs these commands itself — gtd's `src/` never runs the
  commit (same handoff pattern `clean.md` uses when it tells the agent to run
  `gtd format` and re-run gtd).
- Carry the **auto-advance tail** implicitly via the shared
  `partials/auto-advance.md` (appended by `buildPrompt` when
  `result.autoAdvance`), so DO NOT hand-write a STOP tail in this file. The
  prompt body should end its instructions with "then re-run gtd" framing that the
  auto-advance partial reinforces. After the squash, the machine sees a single
  boundary `feat:` commit and settles Idle.
- Use `{{MODEL}}` where a subagent model is referenced, so `MODEL_STATE`
  substitution can fill it (see `clean.md`'s "Spawn a planning-model subagent
  using model `{{MODEL}}`" for the pattern).

## `src/Prompt.ts` changes

1. `import squashingMd from "./prompts/squashing.md"` at the top with the other
   prompt imports.

2. `PromptState` type — `squashing` must NOT be excluded. It is currently
   `Exclude<GtdState, "transport" | "new-feature" | "testing" | "accept-review"
   | "close-package" | "done">`. Since `squashing` is not in that Exclude list,
   it is already a member of `PromptState` once the union has it — confirm no
   change is needed here (the Exclude list stays the six edge-only states).

3. The private `EDGE_ONLY_STATES` set in `Prompt.ts` — do NOT add `squashing`
   (it is prompt-bearing). It must stay exactly the six edge-only states,
   mirroring `State.ts`.

4. `MODEL_STATE` — add `squashing: "clean"` (reuse the `clean` model state → the
   planning tier). Note `MODEL_STATE` is keyed by the `ModelState` config type,
   and `clean` is a valid `ModelState`; reusing it avoids adding a new
   `ModelState` to `Config.ts`.

5. `SECTIONS` — add `squashing: squashingMd`.

6. Inline the diff + base into the prompt. In `buildPrompt`, alongside the
   existing `clean` rendering block, add a `squashing` block that:
   - pushes `Squash base: ${context.squashBase}` (when defined), mirroring
     Clean's `Review base:` line, and
   - renders the full-process diff via `renderDiff(...)` from
     `context.squashDiff` (when defined and non-empty), e.g. heading
     `"Full-process diff (\`git diff <squashBase> HEAD\`)"`.

## `src/Prompt.test.ts` changes

Add a case (mirror the `clean` render test) that builds a `squashing` result
with `autoAdvance: true`, `squashBase`, and a non-empty `squashDiff`, then
asserts the output:
- contains the squashing section heading / key instruction text,
- contains the `Squash base:` line and the inlined diff,
- contains the `git reset --soft` instruction,
- contains the auto-advance partial text (it must NOT contain the STOP partial),
- substitutes `{{MODEL}}` (planning tier default `claude-opus-4-8`, or a custom
  resolveModel if the test uses one).

The `result(...)` / `withPackage(...)` helpers in `Prompt.test.ts` build a
`Result`; extend or add a helper so the `squashing` `context` carries
`squashBase` / `squashDiff`.

## Acceptance criteria

- [ ] `src/prompts/squashing.md` exists with message-authoring guidance, the
      exact `git reset --soft <base>` + `git commit` commands, the
      squash-the-entire-range instruction, and `{{MODEL}}`.
- [ ] `Prompt.ts` imports `squashingMd`, adds `SECTIONS.squashing` and
      `MODEL_STATE.squashing = "clean"`, and renders `Squash base:` + the inlined
      `squashDiff`.
- [ ] `Prompt.ts`'s private `EDGE_ONLY_STATES` still excludes `squashing`
      (prompt-bearing).
- [ ] `buildPrompt(squashing result)` returns the section + diff + auto-advance
      tail (no STOP tail) with `{{MODEL}}` resolved.
- [ ] `npx vitest run src/Prompt.test.ts` passes.
