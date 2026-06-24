# Review: d4206e5

<!-- base: d4206e5e6b9479224135f78e90f7660efc553081 -->

Fixes the Part B human-review timing flaw: `human-review` was the lone producer
leaf declared `type: "final"` (a terminal STOP), so it left `REVIEW.md`
uncommitted + a `.gtd-commit-intent` marker and deferred the commit to the
user's next run — during which the human's edits polluted the
`review(gtd): create review …` commit, breaking the clean-baseline diff that
review detection relies on. The fix gives `human-review` the `auto-advance` tag
so the edge's `commit-pending` commits `REVIEW.md` CLEAN in the same session,
then settles on `await-review`. This makes review structurally identical to the
planning flow (`new-todo`/`modified-todo` → edge commit → gate).

## Machine: human-review auto-advances

Add `tags: ["auto-advance"]` to the `human-review` leaf (no new machine logic;
termination is via existing guards — post-commit resolves to `await-review`, not
a re-fired `human-review`). The unit test flips to expect `autoAdvance: true`.

- [ ] ./src/Machine.ts#484
- [ ] ./src/Machine.test.ts#233

## Prompt: re-run instead of STOP

`human-review.md`'s closing STOP paragraph is replaced with the precedent
re-run-gtd instruction (mirroring `new-todo.md`/`modified-todo.md`); steps 1–6
(generate + format + write marker) unchanged. "STOP" no longer appears.

- [ ] ./src/prompts/human-review.md#70

## e2e + README

The `auto-advance.feature` human-review scenario is inverted (asserts the
re-run-gtd phrasing + no "STOP"). README leaf table, the test-gate note, the
mermaid `HumanReview` node/edges, and the walkthrough updated to the two-pass
(auto-advance → edge commit → `await-review`) flow.

- [ ] ./tests/integration/features/auto-advance.feature#65
- [ ] ./README.md#94
- [ ] ./README.md#259
