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

`npm run eval` grades the bundled workflow's own prompts against one model
configuration, using [promptfoo](https://www.promptfoo.dev/). Every
`actor: agent` prompt state the workflow can rest at gets a two-sided case —
nine of the ten today; `architecture.decompose` ships a stated reason instead,
in `evals/cases/architecture-decompose.md`, since it writes a variable-sized set
of package files rather than one contracted artifact. Prerequisites are exactly
two environment variables: `GTD_EVALS_URL` (an OpenAI-compatible gateway) and
`GTD_EVALS_KEY` — both the driver turn, run as one `gtd next` → `pi -p` →
`gtd land` cycle through the
[pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent),
and the `llm-rubric` judge reach the model exclusively through that gateway; no
other credential source is read. It is not part of `npm test`: each case drives
real, multi-minute agent turns and costs real model calls, and `npm run eval`
runs every case every time — hours, real tokens, no default subset, no case
filter.

```bash
npm run eval                              # build, then run every case under every model configuration
GTD_EVAL_WORKFLOW=./my-workflow.yaml npm run eval  # grade a scratch workflow instead of the bundled default
EVAL_CLEAN=1 npm run eval                 # delete each fixture repo after grading (kept by default, for post-mortem)
```

Grading is versioned on two axes: the model configuration above, and the harness
itself — pinned to `pi-coding-agent` 0.84.4 and spawned with
`--tools read,write,edit,bash`, so the four-tool surface is a flag this repo
passes, not just `pi`'s current default. A reader comparing two baselines needs
to know the harness moved, not just the model.

Each case builds a fresh, disposable fixture repo per trial, drives exactly one
real driver turn against it (`gtd next` → `pi -p` → `gtd land`), and grades the
result through three tiers, cheapest first: deterministic `javascript` asserts
on which files changed, a grep floor for a planted identifier, and — only once
both pass — an `llm-rubric` judge scoring whether the feedback is actually
useful. That judge is pinned to a specific model id (`gpt-5.4`, duplicated in
`evals/promptfooconfig.yaml` and `evals/run-turn.mjs` on purpose); bumping it
invalidates every recorded baseline, since the judge is as much a part of what a
baseline measures as the model under test. promptfoo's own end-of-run summary
and `results.json`'s per-provider counts are both summed across fixtures AND
configurations, so `npm run eval` runs through `evals/eval.mjs` rather than the
bare `promptfoo` CLI: it strips that aggregate line out of promptfoo's own
output as it streams (the per-test results table above it is untouched) and
prints `evals/report.mjs`'s own pass rate **per case, per variant, per
configuration** (out of `--repeat`'s trial count) in its place — never averaged
across cases, variants, or configurations, since a suite that averages a
two-sided case's variants hides exactly the failure those variants exist to
expose. `evals/eval.mjs` still exits with promptfoo's own exit code, so a
failing assertion still fails `npm run eval`. `npm run eval` also passes
`--no-cache`: `--repeat` does not disable promptfoo's own result cache, and
running the same config by hand from `evals/` (its own `basePath`) makes the
exec provider's script hashes resolve — without `--no-cache`, later trials would
silently replay an earlier trial's cached JSON instead of a fresh turn.

To add a case: write `evals/cases/<name>.mjs` exporting a frozen plain object
shaped like `evals/cases/spec-review.mjs` — a `state` to enter, two-sided
`base`/`variants` fixture content, `expect[variant].gtdFiles` (the exact `.gtd/`
paths that variant's turn may change) and `expect[variant].otherFiles` (`"none"`
for a planner case that must never touch repo code, `"required"` for a coder
case that must), an optional `artifact` (the repo-relative path read back as
`feedback` for the tier-3 rubric, absent for a case with no contracted state
file — that case's `tests:` entries then carry no `llm-rubric` either, since
there is nothing to judge), a `plantedIdentifier` the `violation` variant's
`feedback` must name (choose text the fix must INTRODUCE, never text already
sitting in `base` — a bug's exception class declared but not yet thrown greps
true on an untouched file), and an optional `outOfBounds` (the repo-relative
path a coder case's obvious wrong move would touch; both `isStructurallyOk` here
and `checkOutOfBounds` in `evals/asserts/shared.mjs` fail a turn that touches
it). Then add a matching `evals/asserts/<name>.mjs` grader — it wires
`evals/asserts/shared.mjs`'s case-independent checks first, then adds whatever
check is specific to that state — and wire both into
`evals/promptfooconfig.yaml`'s `tests:`, one entry per variant, each carrying
`case`/`variant`/`challenge`.

A case names a workflow `state`, never a model: the state's class — planner or
coder — picks which half of the configuration runs it, so a review-class case
and a build-class case landing in the same run are each graded on the tier they
actually ship against, never on the other class's model. The committed default
is exactly ONE configuration, because every extra provider multiplies the run
(cases × variants × `--repeat` × providers) and adds a `baseline.json` cell that
can flake, for a comparison most runs never need. To compare model choices for a
single run, add a second `providers:` entry with its own `label` to
`evals/promptfooconfig.yaml`, run `npm run eval` once, and read the two rows it
adds to the per-cell results matrix — no permanent config change required.
Baseline cells key off that provider `label`, not the model id configured under
it, so relabeling a provider without re-recording the baseline reads as a
newly-missing cell, not a renamed one.

### The baseline regression gate

`evals/baseline.json` is a committed snapshot of the pass rate each
`(provider label, case, variant)` cell scored on a past green run — exactly like
a test snapshot. After a clean `promptfoo` exit, `npm run eval` runs
`evals/compare-baseline.mjs` against the `evals/results.json` the run just
wrote: any cell whose rate is lower than the baseline's fails the whole command,
naming the cell and both rates, with no tolerance band (4/4 to 3/4 reds it, for
one model on one case/variant). A cell missing from either side — an unrecorded
case, or one silently dropped from the run — fails too. A higher-scoring run
exits clean and never rewrites the file.

The baseline is **never** updated automatically — a passing `npm run eval` that
refreshed its own baseline would grade nothing. To record a new one
deliberately, after reading the printed per-cell results matrix and deciding
it's the new floor:

```bash
npm run eval:baseline   # rewrites evals/baseline.json from the last results.json, oxfmt'd
```

Commit the resulting `evals/baseline.json` as its own reviewable change, same as
any other snapshot update.

Because a single trial is a real, non-deterministic agent turn, a healthy prompt
occasionally fails one out of `--repeat` trials — a single flaky turn is 25% of
a 4-trial cell's rate. That's expected: the eval is a deliberate human action,
never a CI gate, so a human re-runs and judges. If re-runs become routine, the
fix is more trials, never a softer threshold.
