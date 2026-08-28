# Spec feedback: 01-eval-suite

Two task checkboxes are not met. Everything else in the package verifies: the
fixture builds and rests at `kind: prompt`, `GTD_PLANNERMODEL` really overrides
the state's model, `GTD_EVAL_WORKFLOW` really swaps the workflow (a sentinel
planted in a scratch yaml shows up in `gtd next --json=system`), the `exec:`
provider's relative `node run-turn.mjs` resolves because promptfoo sets the
child cwd to the config's `basePath`, the `javascript` assert receives
`context.vars.variant`, `report.mjs` groups correctly against a real
`results.json`, and `lint`, `format:check`, `deadcode` and `test:unit` are all
green.

## 1. `npm run eval` prints an aggregate pass rate spanning fixtures and models

Task 7, last checkbox: "Nothing printed anywhere computes a mean across fixtures
or across models." Requirement C's acceptance repeats it: "no aggregate number
that spans fixtures or models."

promptfoo's own end-of-run summary does exactly that, and nothing in the `eval`
script suppresses it. Verified by running the real config shape against a stub
provider (2 fixtures x 2 providers x `--repeat 2`):

```
Results:
  ✓ 6 passed (75.00%)
  ✗ 2 failed (25.00%)
```

`75.00%` is summed over both fixtures and both models — the precise number
Requirement C names as the failure mode ("an always-flag prompt scores 50% and
looks merely weak"). `evals/report.mjs` prints the correct per-cell lines
afterwards, but it prints them _in addition to_ the forbidden aggregate, not
instead of it. `docs/development.md` acknowledges the aggregate exists rather
than removing it.

Fix: the `eval` script must keep promptfoo's aggregate summary off stdout
(filter it, or drop promptfoo to a log level that omits it) so the only pass
rates a human sees are `report.mjs`'s per-fixture, per-model cells. The per-cell
results table promptfoo prints is fine and should stay.

## 2. The fixture's oxfmt is unpinned and runs with default options, not this repo's

Task 1: the `pre-commit` hook exists to give the fixture "the same effect this
repository gets from husky → lint-staged". It does not.

`evals/fixture.mjs` writes no `.oxfmtrc.json` into the fixture, so both the hook
(`fixture.mjs`, `PRE_COMMIT_HOOK`) and the `unformatted` grader (`run-turn.mjs`,
`unformattedGtdFiles`) run oxfmt with stock defaults. This repo's
`.oxfmtrc.json` sets `printWidth: 100`, `semi: false`, `singleQuote: false`,
`trailingComma: "all"`, and — the one that matters here — an `*.md` override of
`printWidth: 80, proseWrap: "always"`. Every file the reviewer under test writes
is `.gtd/*.md`, so the markdown override is the whole formatting standard being
graded, and the fixture does not apply it. Observed in a fixture build: `oxfmt`
logs `No config found, using defaults`.

Consequence: `unformatted: []` can report convergence for a
`.gtd/SPEC_FEEDBACK.md` that this repository's own `format:check` would red. The
grader measures a different standard than the one it exists to enforce.

Same two call sites, second problem: both invoke `npx oxfmt`, which resolves
whatever version the npx cache holds — 0.65.0 on this machine, against the
`0.59.0`-range `oxfmt` devDependency the repo pins — and fetches from the
network on a cold cache. Task 8 pinned promptfoo at 0.122.1 specifically so "a
run needs no network fetch"; an unpinned formatter in the hot path of every one
of the 16 driver turns misses that same standard.

Fix: copy this repository's `.oxfmtrc.json` into each fixture repo (or write an
equivalent one) so the hook and the grader format `.gtd/*.md` the way
`format:check` here does, and invoke the repo's own resolved oxfmt binary rather
than `npx oxfmt`. The hook must still always exit 0.
