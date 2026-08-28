# Prompt evals for the unified workflow

**Build a promptfoo-driven eval suite that grades `src/workflows/unified.yaml`'s
prompts by the git outcome of one real driver turn — never the transcript.** It
catches prompt regressions and compares models. It burns real tokens and takes
minutes, so it is a deliberate human action like `test:mutation`: never
autonomous, never CI-gated, never in the turbo `test` graph.

## Concerns

### 1. A runnable eval: the spec-review case, end to end — PRODUCT

The whole vertical slice, because none of its parts has acceptance alone: an
`evals/` directory holding a promptfoo config, a fixture-builder, a run-turn
script, deterministic graders, and an `npm run eval` script.

**One eval case = one workflow state plus two-sided fixture repo variants.** The
first case is `specReview`:

- `violation` — a fixture repo parked at `specReview.review` whose
  implementation contradicts a planted line in `.gtd/NEXT.md`. Must produce
  `.gtd/SPEC_FEEDBACK.md` naming the planted defect.
- `clean` — the same fixture with the defect removed. Must stay silent: no
  `.gtd/SPEC_FEEDBACK.md`.

**Two-sided fixtures are load-bearing, not thoroughness.** A prompt that always
flags fails `clean`; a prompt that never flags fails `violation`. A one-sided
case grades nothing.

The promptfoo `exec:` provider wraps a script that: builds the fixture repo,
runs **one** real driver turn (`gtd next --json` → model → `gtd land`) against
it, and prints the resulting repo path for the graders to inspect.

Two grader tiers ship here, cheapest first:

1. **Deterministic `javascript` asserts on the resulting repo.** Only the state
   file the state contracts (`.gtd/SPEC_FEEDBACK.md`) was touched; it exists or
   is absent as the variant demands; every file under `.gtd/` is an oxfmt fixed
   point.
2. **A grep floor for the planted defect.** The feedback must literally mention
   the planted identifier — the cheapest possible guard against a
   plausible-but-wrong flag.

Acceptance: `npm run eval` runs both fixtures against a real model and reports
pass/fail per fixture; deliberately corrupting the `specReview.review` prompt in
a scratch workflow makes `violation` fail while the graders stay quiet on
`clean`.

**Risk — the fixture builder cannot literally reuse the e2e Given steps.** Those
steps are registered against quickpickle inside the vitest world
(`tests/integration/support/steps/*.ts`); an `exec:` provider is a plain
process. Reuse means extracting the repo-building primitives into something
callable from both, or accepting duplication. Decide it while building; do not
silently duplicate.

**Risk — a real driver turn writes commits.** The run-turn script must build
each fixture in a fresh temp repo and never touch the working repository, the
way the e2e helpers already do.

`npm run eval` gets a `package.json` script and **no** `turbo.json` task — the
tooling test only requires the reverse direction, so this stays out of the
cached graph on purpose.

### 2. The rubric judge tier — TECHNICAL

The third and most expensive grader: an `llm-rubric` assertion scoring whether
the feedback is _useful_, not merely present — does it name the concrete defect
and say what to change.

**The judge model is pinned and is never the model under test.** A model grading
its own output is not a grader.

The judge runs only after tiers 1 and 2 pass, so a structurally broken turn
never costs a judge call.

Acceptance: a fixture whose `.gtd/SPEC_FEEDBACK.md` is vague ("the package has
problems") fails the rubric while a specific one passes — both sail through the
grep floor, so the tier is provably doing work the cheap tiers cannot.

### 3. Trials and the model comparison matrix — PRODUCT

Single-turn agent behaviour is noisy, so one trial grades nothing.

- Run `--repeat 4` trials per fixture.
- **Report a pass rate per fixture, never averaged across fixtures.** A suite
  that averages `violation` and `clean` hides exactly the failure two-sided
  fixtures exist to expose — an always-flag prompt scores 50% and looks merely
  weak.
- One promptfoo provider entry per model turns the same run into the comparison
  matrix.

**The default matrix is two models, not one: the planner-tier model the
`specReview` state declares, plus one cheaper model.** A one-model run cannot
show a tier trade-off, and the trade-off is what a matrix exists to show. Each
model runs its own 4 trials per fixture, so the default run is 2 models x 2
fixtures x 4 trials = 16 real driver turns.

Acceptance: a run reports a per-fixture pass rate out of 4 for each of the two
configured models, with no aggregate number that spans fixtures or models.

### 4. The baseline and its regression gate — PRODUCT

A committed `baseline.json` records the pass rates a green run produced. The
eval gates against it with promptfoo's `--compare --fail-on-regression`.

**The baseline is updated deliberately, exactly like a test snapshot** — a human
records a new one and commits it as its own reviewable change. It is never
refreshed automatically by a passing run, or the gate grades nothing.

**Any drop in a fixture's pass rate fails the run — no noise tolerance.** 4/4 to
3/4 reds it, for one model on one fixture.

**Risk — one flaky turn reds the gate.** With 4 trials a single
non-deterministic agent turn is a whole 25% of a fixture's rate, so a healthy
prompt will sometimes fail. Accepted: the eval is a deliberate human action,
never a CI gate, so a human re-runs and judges. If re-runs become routine the
fix is more trials, never a softer threshold.

Acceptance: pointing the run at a baseline recording 4/4 where this run scored
3/4 exits non-zero; pointing it at a matching baseline exits clean.

## Answered Questions

### Which models make up the default comparison matrix?

Two tiers side by side: the planner-tier model the state declares, plus one
cheaper model. A one-model run cannot show a tier trade-off, and that trade-off
is what the matrix exists to show.

### What counts as a regression against the committed baseline?

Any drop in a fixture's pass rate fails the run — 4/4 to 3/4 reds it.
Single-trial noise is accepted as the price of a strict gate a human re-runs by
hand.

### Does documentation ship as its own concern?

No. Each concern above carries its own doc update as part of being done: how to
run the eval, how to add a case, how to read the comparison matrix, and the
baseline-update ritual. A standalone docs concern has no observable acceptance
and would land after the code it describes.

### Where does eval documentation live?

`docs/development.md`, not `README.md`. Evals are a contributor tool, not part
of gtd's CLI, config, or driver protocol — `README.md` and the rest of `docs/`
are for what a _user_ of gtd needs.

### How many cases ship in this scope?

One: `specReview`. The sketch names it as the first case, and the constraint
"only encode past regressions as cases" is a rule for writing future cases, not
a mandate to write all of them now. The other named regressions — review-loop
deadlock, `requireProgress` origin, QA ordering — become cases later, each on
the same two-sided shape.

### Is the eval ever allowed to run unattended?

No. It spends real tokens and takes minutes per run. It stays out of CI, out of
the turbo `test` graph, and out of any autonomous loop — settled by the sketch's
own constraint.

### May a grader read the agent's transcript?

No. Every tier grades the resulting git state only. The transcript is not the
product; the commit is.
