# Prompt evals: the runnable spec-review case, judge tier, and model matrix

## Requirements

Three settled concerns were merged into this package because all three edit the
same two files — `evals/promptfooconfig.yaml` and `evals/run-turn.mjs`. Each is
carried verbatim below and is reviewable on its own.

### Requirement A — A runnable eval: the spec-review case, end to end (PRODUCT)

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

### Requirement B — The rubric judge tier (TECHNICAL)

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

### Requirement C — Trials and the model comparison matrix (PRODUCT)

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

## Settled facts this package builds on

Verified against the built bundle in a scratch repo, not assumed:

- `gtd --entry packages.item.spec.review` is accepted — a nested, parameterized
  machine state is enterable like any other.
- The entry commit CAPTURES the working tree, and the process's diff base is the
  entry commit's **parent**. A fixture that writes its spec plus a planted
  implementation into the tree and then enters gets a review range that already
  contains the planted defect. No fabricated trace commits, no driving through
  earlier states.
- The resulting rest is `kind: "prompt"`, and `gtd next --json=validate` is
  EMPTY — `packages.item.spec.review` declares no `mode:`, so no driver-side
  formatter runs. The fixture supplies that formatter itself.
- `--var plannerModel=<x>` on the entry commit does **not** win against an
  ambient `GTD_PLANNERMODEL` env var. The env layer outranks entry vars.
- promptfoo has no assert short-circuit: the docs describe no skip-on-failure
  behaviour and `assert-set` thresholds evaluate every member.

## Paths

    evals/promptfooconfig.yaml     the config: prompts, providers, tests, asserts
    evals/run-turn.mjs             the exec: provider — build fixture, one turn, print JSON
    evals/fixture.mjs              fixture-repo builder (git init → files → gtd --entry)
    evals/cases/spec-review.mjs    the one case: state, files, two variants, planted identifier
    evals/asserts/spec-review.mjs  the deterministic javascript asserts
    package.json                   the `eval` script + the promptfoo devDependency
    turbo.json                     `lint` task inputs += `evals/**`
    .fallowrc.json                 `entry` += `evals/*.mjs`
    .gitignore                     `evals/results.json`
    docs/development.md            how to run it, how to add a case

Everything under `evals/` is plain `.mjs`, never TypeScript. `tsconfig.json`
includes only `src` and `tests`; a third root drags `evals/` into `typecheck`
and the Effect language service for no gain.

## Tasks

### 1. The fixture builder — `evals/fixture.mjs`

- [ ] `mkdtemp` under `os.tmpdir()`, `git init`, `user.name`/`user.email`/
      `commit.gpgsign false`, an initial commit
- [ ] Writes the case's `base` files and commits them BEFORE the entry, so they
      sit outside the review range
- [ ] Writes the chosen variant's files into the working tree, then runs
      `gtd --entry <case.state>` and pipes the emitted script to `sh`, so the
      entry commit captures them and the review range contains exactly the code
      under review
- [ ] Writes a `.git/hooks/pre-commit` running
      `npx oxfmt --no-error-on-unmatched-pattern --write` over the staged
      `.gtd/` files and `git add`ing them back — the same effect this repository
      gets from husky → lint-staged, without installing husky into a throwaway
      repo
- [ ] That hook **always exits 0**, re-adding whatever it rewrote. A failing
      hook would red the land itself and the eval would report a broken turn
      instead of a formatting result
- [ ] `GTD_EVAL_WORKFLOW=<path to a yaml>` parses that file with the `yaml`
      dependency already in the tree and writes `.gtdrc.json` into the fixture
      with the whole document nested under `workflow:`; unset, the fixture
      carries no `.gtdrc` and runs the bundled default
- [ ] Imports nothing from `tests/`;
      `tests/integration/helpers/project-setup.ts` stays untouched

### 2. The case module — `evals/cases/spec-review.mjs`

- [ ] Exports one frozen object shaped:

          {
                    name: "spec-review",
                    state: "packages.item.spec.review",
                    plantedIdentifier: "<identifier>",
                    base: { "<spec file>": "...", "src/<impl>.ts": "..." },
                    variants: {
                      violation: { "src/<impl>.ts": "...defect..." },
                      clean:     { "src/<impl>.ts": "...correct..." },
                    },
                    expect: { violation: { feedback: true }, clean: { feedback: false } },
                  }

- [ ] The `violation` variant's implementation contradicts a line the spec
      states, and the contradiction is nameable by `plantedIdentifier`
- [ ] The `clean` variant is the same fixture with the defect removed and
      nothing else changed

### 3. The run-turn provider — `evals/run-turn.mjs`

- [ ] Reads argv[1] as the variant name (`exec:` passes the rendered prompt
      there) and `--model <model>` from its own command line
- [ ] Injects the model under test as `GTD_PLANNERMODEL=<model>` in the child
      env, never as `--var plannerModel=<model>` — an ambient `GTD_PLANNERMODEL`
      in a contributor's shell beats the entry var and would grade the wrong
      model
- [ ] Drives exactly ONE beat, no loop: `gtd next --json=kind` (must be
      `prompt`) → `gtd next --json=model`/`system`/`session.id` →
      `gtd next | claude -p --session-id <id> --model <model> --system-prompt     <system> --dangerously-skip-permissions`
      with the prompt over **stdin** → `gtd land --json=script | sh`
- [ ] Runs no `validate` step — `gtd next --json=validate` is empty at this rest
- [ ] Prints ONE line of JSON on stdout carrying `repo`, `variant`, `model`,
      `feedbackExists`, `feedback`, `gtdFilesChanged`, `otherFilesChanged`,
      `unformatted`, `landedSubject`, `structurallyOk`
- [ ] `unformatted` lists the `.gtd/` files that are still not oxfmt fixed
      points AFTER the fixture's commit hook ran
- [ ] `structurallyOk` is tiers 1 and 2 having passed, computed in-process
- [ ] Refuses at startup when the model under test appears in the pinned judge
      provider id

### 4. Error handling in the provider

- [ ] The child env is scrubbed, not inherited: `GIT_DIR`, `GIT_WORK_TREE`,
      `GIT_INDEX_FILE`, `GTD_LOOP_LOG` and every `GTD_*` var except the one
      model override are deleted before spawning. An inherited `GIT_DIR` writes
      the fixture's commits into the real repository
- [ ] A single `assert(cwd.startsWith(tmpdir))` guard before each spawn — no git
      command ever runs with the working repository as cwd
- [ ] Infra failure (missing `dist/gtd.bundle.mjs`, `claude` not on `PATH`, git
      error, non-`prompt` kind, missing `ANTHROPIC_API_KEY`) exits non-zero with
      the reason on stderr. An infra break must never read as a passing eval
- [ ] Per-turn timeout 600 s; on expiry the agent is killed and the script exits
      non-zero
- [ ] Temp repos are KEPT for post-mortem and their paths printed;
      `EVAL_CLEAN=1` removes them

### 5. The deterministic graders — `evals/asserts/spec-review.mjs`

- [ ] Tier 1 `javascript` asserts over the printed JSON, no model and no cost:
      `gtdFilesChanged` is exactly `[".gtd/SPEC_FEEDBACK.md"]` on `violation`
      and `[]` on `clean`
- [ ] `otherFilesChanged` is empty on both variants — the reviewer is forbidden
      to fix anything
- [ ] `unformatted` is empty — formatting CONVERGED after the hook, which is not
      the same claim as the model having typed a fixed point
- [ ] Tier 2, the grep floor: `feedback` contains `plantedIdentifier` verbatim,
      on `violation` only

### 6. The rubric judge tier — in `evals/promptfooconfig.yaml`

- [ ] A third assertion on the `violation` test only; `clean` has no feedback to
      judge:

          - type: llm-rubric
                    transform: 'JSON.parse(output).structurallyOk ? JSON.parse(output).feedback : "STRUCTURAL FAILURE"'
                    provider: <pinned judge id>

- [ ] The rubric passes only when the feedback names the concrete defect and
      says what to change; it fails vague feedback ("the package has problems")
      and the literal text `STRUCTURAL FAILURE`
- [ ] The judge provider id is written literally in the config and is never a
      model in the matrix
- [ ] `eval` checks for `ANTHROPIC_API_KEY` up front and says so when it is
      missing — the turns run through the `claude` CLI and its own auth, but an
      `llm-rubric` provider calls the API directly

### 7. The comparison matrix — in `evals/promptfooconfig.yaml`

- [ ] `prompts: ["{{variant}}"]`; two `tests` entries with
      `vars: { variant: violation }` and `vars: { variant: clean }`
- [ ] Two providers, each an `exec: node evals/run-turn.mjs --model <model>`
      with a `label` — `planner` (the planner-tier model the state declares) and
      `cheap`
- [ ] The model rides on the provider's own command line, not a provider
      `config` block
- [ ] `--repeat 4` lives in the `eval` script, not the config, so a human can
      override it for one run without editing a committed file
- [ ] `--max-concurrency 2`. The default run is 2 models x 2 fixtures x 4 trials
      = **16 real driver turns**, each measured in minutes; 16 at once times out
- [ ] Nothing printed anywhere computes a mean across fixtures or across models

### 8. Tooling wiring

- [ ] promptfoo pinned as a `devDependency` at 0.122.1, so `eval` calls the
      local binary and a run needs no network fetch. That puts ~30 MB unpacked
      plus its whole dependency tree on every `npm install`, every fresh clone,
      and every CI job — accepted
- [ ] `npm run eval` runs `npx turbo run build` first, then promptfoo with
      `--config evals/promptfooconfig.yaml --repeat 4 --max-concurrency 2     -o evals/results.json`.
      A stale bundle would grade a stale copy of `src/workflows/unified.yaml`
- [ ] `eval` gets a `package.json` script and **no** `turbo.json` task; the
      tooling test only asserts the forward direction
- [ ] `evals/**` added to `turbo.json`'s `lint` task `inputs` — `oxlint .`
      already walks the directory, so without this a lint error there returns a
      cached green
- [ ] `evals/*.mjs` added to `.fallowrc.json`'s `entry` array — nothing imports
      those files, so `deadcode` reds without it
- [ ] `evals/results.json` gitignored
- [ ] `docs/development.md` documents how to run the eval, how to add a case,
      and how to read the comparison matrix. Nothing goes in `README.md`

## Acceptance

- [ ] `npm run eval` runs both fixtures against a real model and reports
      pass/fail per fixture, per model
- [ ] Corrupting the `specReview.review` prompt in a scratch workflow (via
      `GTD_EVAL_WORKFLOW`) makes `violation` fail while the graders stay quiet
      on `clean`
- [ ] A fixture whose feedback is vague ("the package has problems") fails the
      rubric while a specific one passes — both sail through the grep floor
- [ ] A run reports a per-fixture pass rate out of 4 for each of the two
      configured models, with no aggregate number spanning fixtures or models
- [ ] `npm test` stays green: `lint`, `deadcode` and `format:check` all cover
      `evals/` and pass

## Risks

**The commit hook can mask a genuinely malformed file.** oxfmt rewrites what it
can parse, so a file it silently normalizes never shows up in `unformatted`.
What survives is the case oxfmt cannot make a fixed point.

**The judge gate is a cost reduction, not a zero.** promptfoo cannot
short-circuit assertions, so a structurally broken turn still costs one judge
call on a ~2-token input. Against a driver turn measured in minutes that is
noise; against "never costs a judge call" it is a miss. Eliminating it would
need a second full promptfoo pass (doubling 16 real driver turns) or a
hand-rolled `javascript` assert that calls the judge itself.

**A real driver turn writes commits.** Every fixture lives in a fresh temp repo
and the working repository is never the cwd of a git command.
