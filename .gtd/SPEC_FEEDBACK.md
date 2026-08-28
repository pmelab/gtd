# Spec feedback — 02-baseline-gate

The reader, the `eval:baseline` ritual, the gate wiring, the tests and the docs
all match the spec. One problem remains.

## `evals/baseline.json` is hand-authored, not recorded from a green run

The spec's requirement is "A committed `baseline.json` records the pass rates a
green run produced." The committed file was never produced by a run:

- `recordedAt` is `2026-08-28T00:00:00.000Z` — a midnight literal. `record()`
  writes `new Date().toISOString()`, which never lands on `00:00:00.000Z`.
- It was added once in `7efd49c3` and never re-recorded (`git log --follow`).
- No `evals/results.json` exists in the worktree, so `npm run eval:baseline` was
  never run against a real result.
- Every cell is recorded at a perfect `4/4`. The spec's own shape example
  records `cheap|violation` at `3/4`.

Two concrete consequences:

1. **The floor is set to the strictest value possible and was never observed.**
   The spec's accepted risk is that one flaky turn out of four is 25% of a
   cell's rate. A hand-set `4/4` on all four cells means the first real
   `npm run eval` has no headroom on any cell, and a cell whose true rate is
   `3/4` reds every run forever, not occasionally.
2. **`docs/development.md` states a falsehood.** Its baseline section says
   `evals/baseline.json` is "a committed snapshot of the pass rate each
   `(provider label, fixture variant)` cell scored on a past green run". No such
   run happened.

Fix either by recording a real baseline (`npm run eval` then
`npm run eval:baseline`, which needs `ANTHROPIC_API_KEY` and `claude` on `PATH`,
and costs real model calls), or — if a real run is out of reach for this build —
by making the file and the doc honest about being an unverified initial floor
that the first human run is expected to re-record.
