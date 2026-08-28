# Prompt evals for the unified workflow — technical plan

**The whole eval reduces to one already-supported gtd move:
`gtd --entry packages.item.spec.review` parks a throwaway repo directly at the
state under test, in one call, with no model turns spent getting there.**
Everything else is plumbing around that fact.

Verified against the built bundle in a scratch repo, not assumed:

- `gtd --entry packages.item.spec.review` is accepted — a nested, parameterized
  machine state is enterable like any other.
- The entry commit CAPTURES the working tree, and the process's diff base is the
  entry commit's **parent**. So a fixture that writes `.gtd/NEXT.md` plus a
  planted implementation into the tree and then enters gets a review range that
  already contains the planted defect. No fabricated trace commits, no driving
  through earlier states.
- The resulting rest is `kind: "prompt"`, and `gtd next --json=validate` is
  EMPTY — `packages.item.spec.review` declares no `mode:`, so no driver-side
  formatter ever touches the agent's `.gtd/SPEC_FEEDBACK.md`.
- `--var plannerModel=<x>` on the entry commit does **not** win against an
  ambient `GTD_PLANNERMODEL` env var. The env layer outranks entry vars.

## Open Questions

### Does the oxfmt fixed-point assert grade the agent, or does the fixture repo mirror production's formatting hook?

In this repository a `.gtd/` file is oxfmt-formatted by husky → lint-staged
during the step commit, so a human never sees an unformatted
`.gtd/SPEC_FEEDBACK.md`. A fixture temp repo has no husky, and
`packages.item.spec.review` declares no `mode:` — so nothing formats the file
and the assert grades the raw model. Markdown under this repo's oxfmt override
is `printWidth: 80, proseWrap: always`; a model writing prose markdown rarely
lands on that fixed point unprompted. Getting this wrong means the `violation`
fixture reds on formatting on most trials and the eval grades typography, not
prompts.

- [ ] Grade the raw model — keep the assert as written, fixture installs no
      hook. Strictest reading of the concern; accepts that a healthy prompt may
      red on wrapping alone
- [x] Mirror production — the fixture builder wires the same `oxfmt --write` on
      commit that this repo runs, and the assert then checks that formatting
      CONVERGED (file is a fixed point after the hook) rather than that the
      model typed it that way
- [ ] _your answer_

### Is promptfoo a devDependency, or run through a pinned `npx`?

promptfoo 0.122.1 is ~30 MB unpacked before its dependency tree. It is needed by
exactly one deliberate, manual command that a contributor may never run, and it
is on the install path of every `npm install`, every fresh clone, and every CI
job that installs to run `npm test`.

- [x] devDependency pinned in `package.json` — reproducible, offline after one
      install, at the cost of install weight for everyone
- [ ] `npx -y promptfoo@<pinned version>` inside the `eval` script — zero weight
      for contributors who never run evals, at the cost of a network fetch on
      first use and no lockfile pinning of its own tree
- [ ] _your answer_

## 1. A runnable eval: the spec-review case, end to end

### File and module structure

    evals/promptfooconfig.yaml     the config: prompts, providers, tests, asserts
    evals/run-turn.mjs             the exec: provider — build fixture, one turn, print JSON
    evals/fixture.mjs              generic fixture-repo builder (git init → files → gtd --entry)
    evals/cases/spec-review.mjs    the one case: state, files, two variants, planted identifier
    evals/asserts/spec-review.mjs  the deterministic javascript asserts
    package.json                   the `eval` script
    turbo.json                     `lint` task inputs += `evals/**`
    .fallowrc.json                 `entry` += `evals/*.mjs`
    .gitignore                     `evals/results.json`
    docs/development.md            how to run it, how to add a case

Plain `.mjs`, not TypeScript. `tsconfig.json` includes only `src` and `tests`,
and adding a third root drags `evals/` into `typecheck` and the Effect language
service for no gain — the whole directory is process spawning and file reads.

### The fixture builder shares nothing with the e2e suite, and that is fine

`tests/integration/helpers/project-setup.ts` is already a plain module (no
quickpickle, no vitest world) and `createTestProject()` is exactly the primitive
needed. But `evals/fixture.mjs` needs ~15 lines it does not have — write files,
one `gtd --entry` call, pipe the emitted script to `sh`. **The parking mechanism
is a single `--entry` call, so there is no multi-step setup sequence to share in
the first place.** `evals/fixture.mjs` owns its own `git init` and does not
import across the `tests/` boundary; the e2e helper stays untouched.

### Data models

A case module exports one frozen object:

    {
      name: "spec-review",
      state: "packages.item.spec.review",
      plantedIdentifier: "subtractInsteadOfAdd",
      base: { ".gtd/NEXT.md": "...", "src/calc.ts": "..." },   // committed first, pre-entry
      variants: {
        violation: { "src/calc.ts": "...defect..." },          // written into the tree, then entered
        clean:     { "src/calc.ts": "...correct..." },
      },
      expect: { violation: { feedback: true }, clean: { feedback: false } },
    }

`base` lands as an ordinary commit BEFORE the entry, so it sits outside the
review range. `variants` is written into the working tree and captured by the
entry commit, so it sits inside it. That split is what makes the range contain
exactly the code under review.

`run-turn.mjs` prints ONE line of JSON on stdout — an `exec:` provider's stdout
IS the promptfoo `output`, so the repo path travels inside that document rather
than as bare text:

    { "repo", "variant", "model", "feedbackExists", "feedback",
      "gtdFilesChanged", "otherFilesChanged", "unformatted",
      "landedSubject", "structurallyOk" }

`unformatted` is the list of `.gtd/` files that are not oxfmt fixed points.
`structurallyOk` is tiers 1 and 2 having passed, computed in-process — concern 2
needs it.

### The turn itself

One beat, exactly as `docs/driver.md` describes it, with no loop:

1. `gtd next --json=kind` — must be `prompt`, else fail loudly.
2. `gtd next --json=model` / `system` / `session.id`.
3. `gtd next | claude -p --session-id <id> --model <model> --system-prompt <system> --dangerously-skip-permissions`,
   prompt over **stdin**.
4. `gtd land --json=script | sh`.

No `validate` step: `gtd next --json=validate` is empty at this rest, verified.

**The model under test is injected as `GTD_PLANNERMODEL=<model>` in the child
env, never as `--var plannerModel=<model>`.** Verified: an ambient
`GTD_PLANNERMODEL` in the contributor's shell silently beats the entry var, so
`--var` would grade whatever model that contributor happens to export. The env
var is the top of the precedence chain, which makes it both the lever and the
shield.

### Error handling

- **The child env is scrubbed, not inherited.** `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_INDEX_FILE`, `GTD_LOOP_LOG` and every `GTD_*` var except the one model
  override are deleted before spawning. An inherited `GIT_DIR` writes the
  fixture's commits into the real repository.
- Every fixture repo is `mkdtemp` under `os.tmpdir()`. `run-turn.mjs` never runs
  a git command with the working repository as cwd — a single
  `assert(cwd.startsWith(tmpdir))` guard before each spawn.
- Infra failure (missing `dist/gtd.bundle.mjs`, `claude` not on `PATH`, git
  error, non-`prompt` kind) exits non-zero with the reason on stderr. promptfoo
  records that as an error, which reads as a fail. **An infra break must never
  read as a passing eval.**
- Per-turn timeout 600 s; on expiry kill the agent, exit non-zero.
- Temp repos are KEPT for post-mortem and their paths printed. `EVAL_CLEAN=1`
  removes them.
- The bundle must be current or the eval grades a stale copy of
  `src/workflows/unified.yaml`. The `eval` script runs `npx turbo run build`
  first.

### Scratch-workflow override — the acceptance criterion's own lever

Corrupting the `specReview.review` prompt must not mean editing
`src/workflows/unified.yaml` in place. `GTD_EVAL_WORKFLOW=<path to a yaml>`
makes `fixture.mjs` parse that file with the `yaml` dependency already in the
tree and write `.gtdrc.json` into the fixture with the whole document nested
under `workflow:`. Unset, the fixture carries no `.gtdrc` and runs the bundled
default.

### Graders

Tier 1, `javascript` asserts over the printed JSON (no model, no cost):

- `gtdFilesChanged` is exactly `[".gtd/SPEC_FEEDBACK.md"]` on `violation` and
  `[]` on `clean`.
- `otherFilesChanged` is empty on both — the reviewer is forbidden to fix
  anything.
- `unformatted` is empty (see the open question above for what this grades).

Tier 2, the grep floor: `feedback` contains `plantedIdentifier` verbatim.
`violation` only.

### Tooling wiring

`npm run eval` gets a `package.json` script and **no** `turbo.json` task.
`tests/tooling/turbo.test.ts` only asserts the forward direction (every turbo
task has a script), so this is legal — `test:mutation` is the standing
precedent.

Two stale-cache hazards, both real:

- `oxlint .` already walks `evals/`, but `turbo.json`'s `lint` task does not
  list `evals/**` in `inputs` — without adding it, a lint error in `evals/`
  returns a cached green.
- `fallow` scans from declared entries; `evals/*.mjs` is imported by nothing, so
  it must be added to `.fallowrc.json`'s `entry` array or `deadcode` reds.

`format:check` needs no change — it declares no `inputs` and always runs, and it
covers `evals/` since `.prettierignore` is irrelevant here (the formatter is
oxfmt).

## 2. The rubric judge tier

### Structure

Lives in `evals/promptfooconfig.yaml` as a third assertion on the same test,
plus the rubric prose. No new module.

    - type: llm-rubric
      transform: 'JSON.parse(output).structurallyOk ? JSON.parse(output).feedback : "STRUCTURAL FAILURE"'
      provider: <pinned judge id>
      value: |
        Passes only if the feedback names the concrete defect ... and says what
        to change. Fails on vague feedback ("the package has problems") and on
        the literal text STRUCTURAL FAILURE.

`violation` only — `clean` has no feedback to judge.

### The judge is pinned in config, and a guard enforces the no-self-grading rule

The judge provider id is written literally in the config. `run-turn.mjs` — which
knows the model under test from its own `--model` argument — refuses at startup
when that model string appears in the judge id. **A model grading its own output
is not a grader, and the matrix makes collision a one-typo mistake, not a
hypothetical.**

**Risk — the judge needs its own credential.** The turns run through the
`claude` CLI and its own auth; an `llm-rubric` provider calls the API directly
and needs `ANTHROPIC_API_KEY` in the environment. A contributor with a working
`claude` CLI and no key gets tiers 1 and 2 and an error on tier 3. `eval` checks
for the key up front and says so.

### Ordering: promptfoo has no assert short-circuit — verified

The docs describe no skip-on-failure behaviour and `assert-set` thresholds
evaluate every member. So "the judge runs only after tiers 1 and 2 pass" is
implemented by the `transform` above: `run-turn.mjs` computes tiers 1 and 2
itself and sets `structurallyOk`, and a broken turn sends the judge the fixed
two-word string instead of the feedback.

**Risk — this is a cost reduction, not a zero.** A structurally broken turn
still costs one judge call, on a ~2-token input. Against a driver turn measured
in minutes, that is noise; against the concern's literal wording ("never costs a
judge call"), it is a miss. Eliminating it entirely would need either a second
full promptfoo pass (doubling 16 real driver turns) or replacing `llm-rubric`
with a hand-rolled `javascript` assert that calls the judge itself.

## 3. Trials and the model comparison matrix

### Structure

`evals/promptfooconfig.yaml` only, plus the `eval` script.

    prompts: ["{{variant}}"]        # the rendered prompt IS the variant name
    providers:
      - id: "exec: node evals/run-turn.mjs --model <planner-tier model>"
        label: planner
      - id: "exec: node evals/run-turn.mjs --model <cheaper model>"
        label: cheap
    tests:
      - vars: { variant: violation }
      - vars: { variant: clean }

The model rides on the provider's own command line rather than a provider
`config` block — `exec:`'s documented interface passes the prompt as argv[1] and
provider config as a JSON argv[2], and an argv flag is the shape that cannot be
misread. `run-turn.mjs` reads argv[1] as the variant name.

`--repeat 4` lives in the `eval` script, not the config, so a human can override
it for one run without editing a committed file.

### Reporting

promptfoo's default table already reports per-provider, per-test results with no
cross-fixture aggregate. **Nothing in this repository may print a mean across
fixtures or across models** — that is the failure two-sided fixtures exist to
expose. The `eval` script writes `-o evals/results.json` and prints the
per-`(provider label, variant)` counts from concern 4's own reader, which never
computes a total.

### Concurrency

The default run is 2 models x 2 fixtures x 4 trials = **16 real driver turns**,
each an agent turn measured in minutes. `eval` pins `--max-concurrency 2`. Real
agent processes are memory- and rate-limit-heavy, and past experience in this
repository puts the safe ceiling at about two concurrent loops; 16 at once times
out.

## 4. The baseline and its regression gate

Builds on concern 3's `evals/results.json` — it consumes that file and adds
nothing to the config.

### Structure

    evals/baseline.json          committed; the recorded pass rates
    evals/compare-baseline.mjs   read results.json, diff, exit 0/1; --record writes
    package.json                 `eval:baseline` script
    docs/development.md          the update ritual

### The gate is hand-rolled, because promptfoo has no such flags

**Verified against the promptfoo CLI reference: `--compare` and
`--fail-on-regression` do not exist.** `promptfoo eval` supports `--repeat`,
`--config` and `-o/--output` and nothing comparative. The concern's intent —
committed baseline, strict regression gate, deliberate updates — is unchanged;
the mechanism is a ~60-line reader over the JSON output.

### Data model

    {
      "recordedAt": "2026-08-28",
      "trials": 4,
      "rates": {
        "planner|violation": { "passed": 4, "total": 4 },
        "planner|clean":     { "passed": 4, "total": 4 },
        "cheap|violation":   { "passed": 3, "total": 4 },
        "cheap|clean":       { "passed": 4, "total": 4 }
      }
    }

Keyed `<provider label>|<variant>`. Flat, per-cell, no aggregate anywhere in the
file — the format itself makes an averaged number unrepresentable.

### Gate rules

Comparison is on the RATE (`passed / total`), so a run with a different
`--repeat` still compares meaningfully.

- Any cell whose rate is **lower** than the baseline's → exit 1, naming the cell
  and both rates. **4/4 to 3/4 reds it, for one model on one fixture.** No
  tolerance band.
- A cell present in the run but absent from the baseline → exit 1. An unrecorded
  cell is not a pass.
- A cell present in the baseline but absent from the run → exit 1. A silently
  dropped fixture must not read green.
- A higher rate is not a failure and does **not** rewrite the file.

### Update ritual

`npm run eval:baseline` = `node evals/compare-baseline.mjs --record` — reads the
last `evals/results.json`, overwrites `evals/baseline.json`, then runs
`npx oxfmt --write evals/baseline.json` so the committed file is a fixed point
and `format:check` stays green. It is a separate command a human types, and a
passing `npm run eval` never calls it. **A gate that refreshes its own baseline
grades nothing.**

`evals/results.json` is gitignored; `evals/baseline.json` is committed.

**Risk — one flaky turn reds the gate.** With 4 trials a single
non-deterministic agent turn is 25% of a cell's rate, so a healthy prompt will
sometimes fail. Accepted: the eval is a deliberate human action, never a CI
gate, so a human re-runs and judges. If re-runs become routine the fix is more
trials, never a softer threshold.

## Merged Concerns

Concerns 2 and 3 were merged into concern 1: all three center on
`evals/promptfooconfig.yaml` and `evals/run-turn.mjs`, and neither later one
merely consumes an interface the first creates — 2 adds an assertion to the same
config and needs `structurallyOk` computed inside the same provider script, and
3 edits the same config's provider list and the same script's model handling.

Concern 4 was NOT merged: it introduces new files (`evals/baseline.json`,
`evals/compare-baseline.mjs`) and consumes `evals/results.json`, an interface
concern 3 creates. That is a genuine build-on-top sequence.

The two merged requirements, carried verbatim so the per-package spec review
still covers each independently:

### 2. The rubric judge tier — TECHNICAL (verbatim)

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

### 3. Trials and the model comparison matrix — PRODUCT (verbatim)

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

## Answered Questions

### How does a fixture repo get parked at the spec-review state?

One `gtd --entry packages.item.spec.review` call, with the planted
implementation sitting uncommitted in the tree so the entry commit captures it.
Verified in a scratch repo: the state is enterable, the resulting rest is a
`prompt`, and the diff base is the entry commit's parent, so the range contains
the plant.

### Does the fixture builder reuse the e2e Given steps, or duplicate them?

Neither. `evals/fixture.mjs` is ~15 lines of its own because the entire setup is
`git init`, write files, one `--entry` call — there is no multi-step sequence to
share. Nothing is extracted from `tests/` and nothing is copied out of it.

### How is the model under test injected?

`GTD_PLANNERMODEL=<model>` in the spawned process's environment. Verified that
`--var plannerModel=<model>` loses to an ambient env var, which would silently
grade the contributor's own model instead of the one under test.

### Does the run-turn script drive a loop or a single beat?

A single beat: `gtd next` → `claude -p` → `gtd land`. The concern says one real
driver turn, and the graders read the repo the moment that turn lands.

### Is the output the bare repo path, or a JSON document containing it?

A one-line JSON document whose `repo` field is the path. The rubric tier needs
the feedback text as gradeable output and the deterministic tier needs the
change lists; an `exec:` provider's stdout is the single output channel, so it
carries all of it.

### How is the scratch-workflow acceptance test run without editing the repo's yaml?

`GTD_EVAL_WORKFLOW=<path>` makes the fixture builder parse that yaml and write
it into the fixture's `.gtdrc.json` under a `workflow:` key. The corrupted copy
lives outside the repository.

### Where do fixture repos live, and are they cleaned up?

`mkdtemp` under `os.tmpdir()`, kept by default with their paths printed so a
failed trial can be inspected. `EVAL_CLEAN=1` removes them.

### What language are the eval scripts written in?

Plain `.mjs`. `tsconfig.json` includes only `src` and `tests`, and the whole
directory is process spawning and file reads — TypeScript buys nothing and
adding a third include root drags `evals/` into `typecheck`.

### What keeps `evals/` from returning a stale cached green?

`evals/**` is added to `turbo.json`'s `lint` task `inputs`, and `evals/*.mjs` to
`.fallowrc.json`'s `entry` array. `oxlint .` and `fallow` both walk the
directory already; without those two edits, `lint` caches a stale pass and
`deadcode` reds on unreferenced files.

### Which promptfoo flags does the gate actually use?

`--config`, `--repeat`, `-o/--output` and `--max-concurrency`. `--compare` and
`--fail-on-regression` do not exist in the promptfoo CLI — the regression gate
is a small reader over the JSON output instead.

### Where does eval documentation live?

`docs/development.md`, not `README.md`. Evals are a contributor tool, not part
of gtd's CLI, config, or driver protocol.
