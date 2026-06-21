# Review: 939f65b

<!-- base: 939f65b0004721d27d17e407614a338fde90057b -->

This branch rewrites gtd from a memoryless snapshot `detect()` that emitted a
`branches[]` array into an xstate event-sourced state machine used as a pure
fold over commit history + the working tree, resolving to a single active state.

## xstate machine core (pure fold)

The IO-free machine: typed `COMMIT`/`RESOLVE` events, a context carrying the
`fix(gtd):` counter, an 11-leaf state union, ordered priority guards, the
`auto-advance` tag, and a synchronous `resolve(events)`. `MAX_VERIFY_ITERATIONS`
is hardcoded to 5. Covered by unit tests for counter folding and every leaf.

- [ ] ./src/Machine.ts#1
- [ ] ./src/Machine.test.ts#1

## Edge IO: event gathering + commit listing

All git/FS IO moved to the Effect edge: `gatherEvents()` builds the
`COMMIT[] + RESOLVE` stream, `computeReviewBase` relocated here, and a new
`commitSubjects(base?)` (first-parent, oldest→newest, whole-history fallback
when there is no default branch / merge-base).

- [ ] ./src/Events.ts#1
- [ ] ./src/Git.ts#17
- [ ] ./src/Git.ts#144
- [ ] ./src/Git.test.ts#1

## Pipeline cutover: detect → fold → single state

`detect()` collapses to gather → fold → return `{ value, context, autoAdvance }`
(State.ts shrank ~300 lines); `main.ts` drops ref-arg parsing; `Prompt.ts` emits
one section keyed by leaf id with flag-driven auto-advance (the
`AUTO_ADVANCE_BRANCHES` set is gone). Verify the priority order and tag set
match the machine.

- [ ] ./src/State.ts#1
- [ ] ./src/main.ts#15
- [ ] ./src/Prompt.ts#6
- [ ] ./src/Prompt.ts#21
- [ ] ./src/Prompt.ts#48
- [ ] ./src/Prompt.test.ts#1

## Prompt content: escalate, test gates, marker handoff

New `escalate.md` (halt + human handoff); test-gate preambles prepended to the
four post-code states; `review-process.md` now also absorbs `TODO:`-marker
extraction. The dead `verify.md`, `todo-markers.md`, and `review-create.md`
prompts are deleted. Confirm `human-review.md` still writes the `<!-- base: -->`
marker.

- [ ] ./src/prompts/escalate.md#1
- [ ] ./src/prompts/human-review.md#1
- [ ] ./src/prompts/new-todo.md#1
- [ ] ./src/prompts/modified-todo.md#1
- [ ] ./src/prompts/verified.md#1
- [ ] ./src/prompts/review-process.md#33

## Integration tests realigned to the ref-less machine

Ref-arg scenarios removed from review.feature; markers-are-code rewrite in
branches.feature; review-create scenario dropped from auto-advance.feature; new
verify-loop.feature covers the `fix(gtd):` counter, the escalate cap, and the
reset path. A composable `fix(gtd)` commit Given was added.

- [ ] ./tests/integration/features/verify-loop.feature#1
- [ ] ./tests/integration/features/branches.feature#50
- [ ] ./tests/integration/features/branches.feature#170
- [ ] ./tests/integration/features/auto-advance.feature#53
- [ ] ./tests/integration/support/steps/common.steps.ts#55

## xstate dependency

- [ ] ./package.json#44

## Docs: machine model, fixed cap, ref removal

README and SKILL describe the event-sourced fold, the `fix(gtd):` convention +
fixed cap of 5, the `escalate` state, markers-as-code, and the removal of the
CLI ref argument / review-create.

- [ ] ./README.md#8
- [ ] ./SKILL.md#1

## Tooling: exclude the generated bundle from diffs & prettier

`.gitattributes` marks `scripts/gtd.js -diff` so review diffs stay small, and
`.prettierignore` stops `format:check` flagging the build artifact.

- [ ] ./.gitattributes#1
- [ ] ./.prettierignore#1
