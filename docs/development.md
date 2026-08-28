# Development

```bash
npm install
npm run dev          # run from source, no build (node dev/run.mjs)
npm run build        # tsdown → dist/gtd.bundle.mjs
npm test             # the whole gate, via turbo — cached and parallel
npx turbo run test:unit         # one task, cached (add --force to bypass)
npx turbo run test:e2e:live     # builds first (turbo dependsOn), then @live
npm run test:changed # local pre-flight: only unit/@inmem tests git says changed
npm run test:mutation # StrykerJS mutation testing (manual only, ~10 min)
npm run typecheck
npm run lint
```

`npm test` is a turbo task graph (`turbo.json`): each check declares its own
`inputs`, so an unchanged check is skipped, and a check that does run is run in
parallel with the others. Caveat from the `test:e2e:live` task's `build`
dependency: a bare `npm run test:e2e:live` skips the build, so use
`npx turbo run test:e2e:live` to test against a fresh bundle.

A pre-commit hook is installed automatically via the `prepare` script when you
run `npm install` on a fresh clone — it runs
[lint-staged](https://github.com/lint-staged/lint-staged) with
[oxfmt](https://oxc.rs/docs/guide/usage/formatter.html), mirroring the
`format:check` step enforced in CI.

Releases are automatic: push releasable Conventional Commits (`fix:`, `feat:`,
or breaking changes) to `main` and semantic-release computes the next version,
builds the bundle, tags it, and publishes.

## Prompt evals

`npm run eval` grades the bundled workflow's own prompts against a real model,
using [promptfoo](https://www.promptfoo.dev/). It requires `ANTHROPIC_API_KEY`
(the `llm-rubric` judge tier calls the Anthropic API directly — the driver turns
themselves run through the `claude` CLI's own auth) and needs `claude` on
`PATH`. It is not part of `npm test`: each case drives real, multi-minute agent
turns and costs real model calls.

```bash
npm run eval                              # build, then run every case against both matrix models
GTD_EVAL_WORKFLOW=./my-workflow.yaml npm run eval  # grade a scratch workflow instead of the bundled default
EVAL_CLEAN=1 npm run eval                 # delete each fixture repo after grading (kept by default, for post-mortem)
```

Each case builds a fresh, disposable fixture repo per trial, drives exactly one
real driver turn against it (`gtd next` → `claude -p` → `gtd land`), and grades
the result through three tiers, cheapest first: deterministic `javascript`
asserts on which files changed, a grep floor for a planted identifier, and —
only once both pass — an `llm-rubric` judge scoring whether the feedback is
actually useful. promptfoo's own end-of-run summary and `results.json`'s
per-provider counts are both summed across fixtures AND models, so
`npm run eval` runs through `evals/eval.mjs` rather than the bare `promptfoo`
CLI: it strips that aggregate line out of promptfoo's own output as it streams
(the per-test results table above it is untouched) and prints
`evals/report.mjs`'s own pass rate **per fixture, per model** (out of
`--repeat`'s trial count) in its place — never averaged across fixtures or
models, since a suite that averages a two-sided case's variants hides exactly
the failure those variants exist to expose. `evals/eval.mjs` still exits with
promptfoo's own exit code, so a failing assertion still fails `npm run eval`.
`npm run eval` also passes `--no-cache`: `--repeat` does not disable promptfoo's
own result cache, and running the same config by hand from `evals/` (its own
`basePath`) makes the exec provider's script hashes resolve — without
`--no-cache`, later trials would silently replay an earlier trial's cached JSON
instead of a fresh turn.

To add a case: write `evals/cases/<name>.mjs` exporting a frozen object shaped
like `evals/cases/spec-review.mjs` (a `state` to enter, two-sided
`base`/`variants` fixture content, and a `plantedIdentifier` the defect
variant's feedback must name), add a matching `evals/asserts/<name>.mjs` grader,
and wire both into `evals/promptfooconfig.yaml`'s `tests:`.
