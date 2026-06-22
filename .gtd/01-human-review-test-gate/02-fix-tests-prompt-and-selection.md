# Task: `fix-tests` prompt template + prompt-selection plumbing

Add the new `fix-tests` prompt and make `buildPrompt` able to emit it (and embed
captured test output) WITHOUT adding a machine state. `fix-tests` is a
prompt-selection decision keyed off `(leafState, testExitCode)` in the edge, so
it is NOT a `LeafState` in `src/Machine.ts`.

## Files

- `src/prompts/fix-tests.md` (NEW) — the prompt template.
- `src/Prompt.ts` — extend `buildPrompt` to select the `fix-tests` prompt and
  embed the captured failure output.
- `src/Prompt.test.ts` — unit coverage for `fix-tests` selection + embedding.

## Contract (task 03, the edge, depends on this exact shape — do not deviate)

Extend `buildPrompt` to accept an optional second argument describing a forced
override, so the edge can request the `fix-tests` prompt with captured output:

```ts
export interface PromptOverride {
  readonly kind: "fix-tests"
  /** Captured combined stdout+stderr from the failed `npm run test`. */
  readonly testOutput: string
}

export const buildPrompt = (
  result: ResolveResult,
  override?: PromptOverride,
): string
```

- When `override` is undefined, behavior is unchanged (selects `SECTIONS[value]`
  as today — all existing Prompt.test.ts cases must still pass).
- When `override.kind === "fix-tests"`, emit the header + context + the
  `fix-tests.md` section with `override.testOutput` embedded inside a fenced code
  block. Do NOT set `autoAdvance` for fix-tests (the prompt itself instructs the
  agent to commit then re-run gtd, mirroring the existing test-gate behavior).

## `src/prompts/fix-tests.md` content requirements

The template instructs the agent (mirroring the old human-review "Test gate"
block, lines 1-11 of the OLD human-review.md):

- State that `npm run test` failed and the failure output is shown below.
- Embed the captured output verbatim in a fenced block (the embedding is done by
  `buildPrompt`; the template provides the surrounding instructions/heading,
  e.g. a `## Failing test output` heading the edge/buildPrompt fills).
- Instruct: make exactly **ONE** fix, commit ALL the fix changes as a single
  commit with a `fix(gtd): <desc>` message. Do NOT commit `TODO.md`.
- Then **re-run gtd** and STOP; the gate re-evaluates next cycle.

## Acceptance criteria

- [ ] `src/prompts/fix-tests.md` exists with the instructions above.
- [ ] `buildPrompt` accepts the optional `PromptOverride` second arg with the
      contract signature; called with no override it is byte-for-byte unchanged
      (all pre-existing `Prompt.test.ts` assertions pass).
- [ ] New unit test: `buildPrompt(result("human-review"), { kind: "fix-tests",
      testOutput: "FAIL src/x.test.ts\nexpected 1 got 2" })` contains the
      `fix(gtd):` instruction AND the literal `expected 1 got 2` inside a
      ```` ``` ```` fenced block.
- [ ] New unit test: the fix-tests prompt does NOT contain the normal
      human-review REVIEW.md generation instructions (`format REVIEW.md`).
- [ ] `npm run typecheck` passes.

## Constraints / edge cases

- Do NOT add `fix-tests` to the `LeafState` union or to `SECTIONS` keyed by
  `LeafState` — it must remain selectable only via the override, not reachable
  by the machine fold.
- The captured output may be large or contain backticks; fence it so it renders
  (use a longer fence or the project's existing diff-fencing approach in
  `buildContext` as a guide).
