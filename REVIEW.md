# Review: 2cdef2c

<!-- base: 2cdef2caa831910e6931c7476757fd8f51522eb1 -->

## Tighten todoInitial committed-TODO arm

The committed arm of `todoInitial` fired whenever `planEverGrilled` was false,
regardless of context. In single-branch repos (merge-base = HEAD) no commit
events are produced, so `planEverGrilled` is always false, causing `new-todo` to
fire even after a `plan(gtd): grilling` commit or when a real review base was
present.

Two extra guards added to the committed arm:

- `planPhase === null` — prevents re-triggering `new-todo` when the last commit
  is already a `plan(gtd):` commit; `todoAwaitAnswers` handles that case
  instead.
- `!reviewBasePresent` — lets `humanReview` take priority when real unreviewed
  commits exist, instead of blocking behind the plan gate.

The untracked arm (`todoDirty === "new"`) is unchanged.

- [ ] ./src/Machine.ts#283
