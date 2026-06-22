# Task: Execute deletes `.gtd/` on the last package (drop the cleanup round-trip)

When the lowest-numbered package is also the LAST one (`packages.length === 1`
at render time), the execute prompt must additionally instruct the agent to
remove the now-empty `.gtd/` directory in the SAME step it commits the last
package — so the next run resolves straight to `human-review` instead of going
through the `cleanup` state. The prompt is rendered differently for the
last-package case (gtd knows it is the last). The `cleanup` leaf STAYS in the
machine as a vestigial safety net — do NOT remove it.

## Shared contract / dependency

Builds on package `02-render-named-package`: the execute prompt is rendered in
`src/Prompt.ts` for the `execute` leaf, with `result.context.packages[0]` the
named package. This task adds a `packages.length === 1` branch to that render.
No machine change (the `execute` leaf still wins via `hasPackages`; `cleanup`
leaf and its guard ordering stay exactly as-is).

## Implementation

- `src/Prompt.ts`: in the execute render, when
  `result.context.packages.length === 1`, include an extra instruction in the
  emitted prompt: after committing the last package with its `COMMIT_MSG.md`,
  ALSO remove the (now empty) `.gtd/` directory as part of the same commit step,
  so the next run goes straight to the next phase (human-review). When
  `packages.length > 1`, this instruction MUST be absent. Implement as either a
  conditional string the render appends, or a dedicated partial — prefer a small
  inline conditional consistent with the existing `Prompt.ts` style.
- Do NOT touch `src/Machine.ts` cleanup leaf / guards. Do NOT delete
  `src/prompts/cleanup.md`.

## Acceptance criteria

- [ ] When `packages.length === 1`, `buildPrompt` (execute leaf) output contains
      an instruction to remove/delete the empty `.gtd/` directory on the final
      commit.
- [ ] When `packages.length > 1`, that `.gtd/` removal instruction is ABSENT
      from the execute prompt.
- [ ] The `cleanup` leaf and its prompt remain unchanged (the existing
      "Empty .gtd directory triggers cleanup" e2e in `branches.feature` and the
      "cleanup prompt renders its section" unit test in `Prompt.test.ts` still
      pass).
- [ ] Vitest (`src/Prompt.test.ts`): a test that a single-package execute result
      includes the `.gtd/` removal instruction, and a multi-package execute result
      does NOT.
- [ ] e2e: add scenarios (extend `execute-gate.feature` or `branches.feature`):
      a single-package `.gtd/` execute run's stdout contains the `.gtd/` removal
      instruction; a multi-package `.gtd/` execute run's stdout does NOT. Reuse
      the composable Given steps (the multi-package fixture already exists in
      `branches.feature`'s "Execute prompt lists all packages when multiple
      exist" scenario — add the negative assertion there or in a sibling
      scenario).

## Constraints / edge cases

- The removal instruction is gated purely on `packages.length === 1` at render
  time — do not infer it from anything else.
- Keep the existing no-verification-in-execute-step semantics; the `.gtd/`
  removal rides along with the package commit (consistent with how cleanup.md
  already says the deletion is part of the verification commit / left
  uncommitted).
- `--verbose`/`--debug` and other flags are orthogonal — do not gate this on any
  flag.

## Relevant files

- `src/Prompt.ts`
- `src/Prompt.test.ts`
- `tests/integration/features/execute-gate.feature`
- `tests/integration/features/branches.feature`
- (reference only, do NOT modify) `src/Machine.ts`, `src/prompts/cleanup.md`
