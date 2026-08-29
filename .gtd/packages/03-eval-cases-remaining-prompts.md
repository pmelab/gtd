# 03 — Build eval cases for the remaining prompts

Primary paths: `evals/run-turn.mjs`, `evals/asserts/*.mjs`, `evals/cases/*.mjs`,
`evals/promptfooconfig.yaml`, `evals/report.mjs`, `evals/baseline.json`.

One refactor plus eight new cases. **The refactor is the hard part; each case is
then a data file and a thin grader.**

## Requirement

PRODUCT.

The human's note: **"build out the eval cases for all other prompts as well".**

`src/workflows/unified.yaml` has **ten `actor: agent` prompt states. One is
covered.** The inventory, with the model class its machine carries and the
artifact its turn contracts to touch:

| State                       | Class   | Contracted artifact                         |
| --------------------------- | ------- | ------------------------------------------- |
| `design.triage`             | planner | `.gtd/REQUIREMENTS.md`, mode `qa`           |
| `architecture.author`       | planner | `.gtd/ARCHITECTURE.md`, mode `qa`           |
| `architecture.decompose`    | planner | `.gtd/packages/*` — no single file          |
| `build.review.reviewing`    | planner | `.gtd/REVIEW.md`, mode `review`             |
| `build.review.collecting`   | planner | `.gtd/REQUIREMENTS.md`, mode `qa`           |
| `packages.item.spec.review` | planner | `.gtd/SPEC_FEEDBACK.md` — **covered today** |
| `packages.item.building`    | coder   | repo code, no state file                    |
| `packages.item.fix-suite`   | coder   | `.gtd/FEEDBACK.md` + repo code              |
| `packages.item.fix-spec`    | coder   | `.gtd/SPEC_FEEDBACK.md` + repo code         |
| `build.fix`                 | coder   | `.gtd/FEEDBACK.md` + repo code              |

Each new case needs the full shape the docs already describe: an
`evals/cases/<name>.mjs` frozen object naming a `state` with two-sided
`clean`/`violation` fixtures and the identifier the violation's feedback must
name, a matching `evals/asserts/<name>.mjs` grader, both wired into
`evals/promptfooconfig.yaml`'s `tests:`, and a one-line `challenge` per variant.

**Two-sided means "must act" versus "must not act", and four of the ten states
have no natural silent side.** `packages.item.building`,
`packages.item.fix-suite`, `packages.item.fix-spec` and `build.fix` always
produce work; their pair is instead "produces the contracted artifact and a
passing suite" versus "produces it against a fixture where the obvious wrong
move is available". A state that genuinely cannot be made two-sided ships a
stated reason instead of a case — `architecture.decompose` is the likeliest,
since it writes a variable set of package files rather than one contracted
artifact.

**A coder-class case is the first one that exercises the unused half of the
configuration, and `gemini-3.5-flash-lite` has never been measured in that
half** — it must be measured on both variants at full trial count before its
cells are recorded, on the same footing as any planner candidate.

**Every case added is a new pair of baseline cells and another full re-record.**
Recording once per case is wasted money; land the cases, then re-record the
baseline in one run at the end.

**`npm run eval` runs every case, every time — no default subset, no case
filter.** At ten cases that is 10 × 2 variants × `--repeat 4` = **80
multi-minute agent turns, sequential, at real token cost**, up from today's 8.
The gate covers the whole workflow and the run yields one honest number; the
price is that `npm run eval` becomes an hours-long, expensive action nobody
invokes casually. It is already outside the turbo `test` graph, which is what
makes that price payable.

Acceptance: every prompt state the workflow can rest at has a two-sided case, or
a stated reason it cannot have one.

## Settled shape

**Eight new cases, not nine: `architecture.decompose` ships a stated reason
instead of a case.** It writes a variable set of package files, so the "only the
contracted artifact changed" check every other case leans on has nothing to
compare against.

**Nine cases total including today's spec-review: 9 × 2 variants × `--repeat 4`
= 72 trials, and 18 baseline cells.** The requirement's 80 assumed ten cases.

**No fixture runs a test suite.** A trial stays exactly one agent turn plus
`gtd land`, and the landed diff is the only thing graded.

## Tasks

### 1. Move case identity into the prompt and rekey the baseline cell

`prompts:` becomes `"{{case}}:{{variant}}"`. Each `tests:` entry gains a `case`
var alongside `variant` and `challenge`. `evals/run-turn.mjs` splits the single
positional on the first `:` and dynamically imports `./cases/<case>.mjs`.

**One provider entry survives, so the configuration stays singular** — the
rejected alternative was one provider per (configuration × case), which puts ten
providers behind a plan whose whole point is one.

`evals/report.mjs`'s `cellKey` becomes `` `${label}|${case}|${variant}` ``.
Nothing in `evals/compare-baseline.mjs` changes, because it treats the key as an
opaque string.

**Risk: this rekeys the two cells the previous package recorded.** The moment
the key changes, `gemini-3.5|clean` and `gemini-3.5|violation` read as baseline
cells missing from the run AND the new `gemini-3.5|spec-review|*` cells read as
unrecorded — four gate violations at once. `npm run eval` fails until this
package's own re-record lands, so the rekey and the record ship together.

**A case name containing `:` breaks the split.** Names stay `[a-z-]+`, which
every existing case file already matches.

- [ ] `evals/promptfooconfig.yaml`'s `prompts:` is `"{{case}}:{{variant}}"`
- [ ] Every `tests:` entry carries a `case` var
- [ ] `evals/run-turn.mjs` splits the positional on the first `:` and imports
      `./cases/<case>.mjs` dynamically
- [ ] An unknown case name fails at startup naming it
- [ ] `evals/report.mjs`'s `cellKey` is `label|case|variant`
- [ ] `evals/promptfooconfig.yaml` still has exactly one `providers:` entry

### 2. Make `evals/run-turn.mjs` case-agnostic

Today it does `import spec from "./cases/spec-review.mjs"` at module scope, and
three functions hardcode that case's contract: `readFeedback` opens
`.gtd/SPEC_FEEDBACK.md`, `expectedGtdFiles` maps variant→that one path, and
`identifierOk` greps `spec.plantedIdentifier`. All three become data reads off
the loaded case.

The case object grows three fields, and **every one is data the case already
implies — no case gains a behaviour hook, no case exports a function.** A case
file stays a frozen plain object so the grader, the provider, and a future
report can import it without executing anything.

- `artifact` — the repo-relative path whose content is read back as `feedback`
  and fed to the tier-3 rubric. Absent for a case that produces no state file
  (`packages.item.building`).
- `expect[variant].gtdFiles` — the exact paths under the fixture's own `.gtd/`
  the turn may change, replacing `expectedGtdFiles`. The empty list is what
  makes a "must not act" variant checkable.
- `expect[variant].otherFiles` — `"none"` for the five planner cases,
  `"required"` for the four coder cases, which must change repo code. **The
  current hard rule "`otherFilesChanged` must be empty" is planner-only and
  cannot survive as a global**; a coder case that changes nothing is the
  failure, not the pass.

`isStructurallyOk` reads those fields instead of branching on the variant name.
It keeps its job: gate the expensive judge behind the free checks, so a broken
turn costs a two-token rubric call rather than a full-size one.

- [ ] `evals/run-turn.mjs` has no module-scope import of a specific case
- [ ] `readFeedback` reads `case.artifact`, and skips cleanly when it is absent
- [ ] `isStructurallyOk` reads `expect[variant].gtdFiles` and
      `expect[variant].otherFiles`, never the variant name
- [ ] A planner case still fails when any repo file outside the fixture's
      `.gtd/` changed
- [ ] A coder case fails when NO repo file outside the fixture's `.gtd/` changed
- [ ] Every case file is a frozen plain object exporting no function
- [ ] The tier-2 grep floor still runs before the judge is called

### 3. Extract the shared grader checks

`evals/asserts/<name>.mjs` stays one file per case, as the docs already promise
— **that is the file a reader opens when a named cell fails, and a single
generic grader would put the case's own rules somewhere else.**

The four current checks are case-independent once they read `expect`, so they
move to `evals/asserts/shared.mjs`. Each case's grader imports the shared check
list, imports its own case, runs them, then adds whatever is specific to that
state.

A grader returns `{pass: false, score: 0, reason}` and never throws, so one bad
trial reports a reason instead of killing the run.

- [ ] `evals/asserts/shared.mjs` exports the four case-independent checks
- [ ] Every case has its own `evals/asserts/<name>.mjs`
- [ ] No grader throws on malformed output; each returns a failing verdict with
      a reason
- [ ] The existing spec-review cell rates are unchanged by the extraction alone

### 4. Write the five planner cases

`design.triage`, `architecture.author`, `build.review.reviewing`,
`build.review.collecting` — plus today's `packages.item.spec.review`, which
keeps its grader and gains the shared core.

Each planner grader adds one state-specific check: the artifact must parse as
the shape the next state reads. `build.review.collecting` writes a requirements
file, so its grader checks the concerns carry a PRODUCT/TECHNICAL
classification; `architecture.author` checks a `## Merged Concerns` heading is
present or absent, never malformed.

Fixture prerequisites per case, supplied in each case's `base`:

- `design.triage` and `build.review.collecting` need an entry diff; the fixture
  commits the base then leaves the variant's change uncommitted, exactly as
  today. `build.review.collecting` additionally needs a review file.
- `architecture.author` needs a requirements file.
- `packages.item.spec.review` needs a package file, as it already has.

**Fixtures leave `modes:` unset in `.gtdrc.json`.** Four of these states carry
`mode: qa` or `mode: review`, but a fixture with no `modes:` config resolves
`gtd next --json=validate` to nothing, so `evals/run-turn.mjs`'s existing
"expected no validate step" guard keeps passing untouched. Configuring a
validator would need a re-prompt loop, and **exactly one agent turn per trial is
the eval's whole contract** — a second turn would grade recovery, not the
prompt.

- [ ] `evals/cases/design-triage.mjs`, `evals/cases/architecture-author.mjs`,
      `evals/cases/build-review-reviewing.mjs` and
      `evals/cases/build-review-collecting.mjs` each name their state and carry
      two-sided `clean`/`violation` fixtures
- [ ] Each has a matching `evals/asserts/<name>.mjs` over the shared core
- [ ] Each names a `plantedIdentifier` the violation's artifact must contain
- [ ] No fixture writes a `modes:` key into `.gtdrc.json`
- [ ] Every trial still reports an empty `validate` step
- [ ] `build.review.collecting`'s grader checks PRODUCT/TECHNICAL classification
- [ ] `architecture.author`'s grader checks the merged-concerns heading is
      well-formed when present

### 5. Write the four coder cases

`packages.item.building`, `packages.item.fix-suite`, `packages.item.fix-spec`,
`build.fix`.

Their two sides are "produces the contracted artifact and takes the right move"
versus "produces it against a fixture where the obvious wrong move is
available". Each coder grader requires `otherFilesChanged` to be non-empty and
to exclude every file the fixture's spec puts out of bounds; touching a planted
out-of-bounds file fails.

Fixture prerequisites: `packages.item.*` need a package file;
`packages.item.fix-suite` and `build.fix` need a feedback file;
`packages.item.fix-spec` needs a spec-feedback file.

**Risk, stated plainly: no fixture runs a test suite, so the "and a passing
suite" half of every coder pair goes ungraded.** A coder case proves the turn
wrote the contracted artifact and avoided the planted wrong move, never that its
code runs.

**Risk: `gemini-3.5-flash-lite` is under test in the coder half for the first
time here, and it was rejected for planner work.** If its coder cells come back
mixed, it is a candidate to replace, not a floor to record.

- [ ] `evals/cases/packages-item-building.mjs`,
      `evals/cases/packages-item-fix-suite.mjs`,
      `evals/cases/packages-item-fix-spec.mjs` and `evals/cases/build-fix.mjs`
      each name their state and carry two-sided fixtures
- [ ] Each sets `expect[variant].otherFiles` to `"required"`
- [ ] Each plants an out-of-bounds file the obvious wrong move would touch
- [ ] Each grader fails a turn that touches that out-of-bounds file
- [ ] Each grader fails a turn that changes no repo code
- [ ] `packages.item.building` declares no `artifact`, and its grader does not
      look for one
- [ ] No coder fixture ships a runnable `testCommand`

### 6. Ship the stated reason for `architecture.decompose`

`evals/cases/architecture-decompose.md` records why that state gets no case: it
writes a variable set of package files, so the "only the contracted artifact
changed" check every other case leans on has nothing to compare against.

A `.md` file in `evals/cases/` is inert — `evals/promptfooconfig.yaml` lists its
tests one by one and never globs the directory.

- [ ] `evals/cases/architecture-decompose.md` exists and states the reason
- [ ] No test in `evals/promptfooconfig.yaml` names that state
- [ ] The file is not loaded by any code path

### 7. Wire every case into `evals/promptfooconfig.yaml`

Each case contributes two `tests:` entries — one per variant — carrying `case`,
`variant`, and a single-line `challenge`. Every case owes its own pair of
`challenge` lines; the spec-review pair is the convention they follow, not a
one-off.

- [ ] Every case has two `tests:` entries, one per variant
- [ ] Every entry carries `case`, `variant`, and a single-line `challenge`
- [ ] Every `violation` entry carries the tier-3 `llm-rubric` with the pinned
      judge; no `clean` entry does
- [ ] `evals/promptfooconfig.yaml` still has exactly one `providers:` entry

### 8. Re-record the whole baseline in one run

The last task, after all eight new cases are wired: one `npm run eval` followed
by `npm run eval:baseline`, writing all 18 cells. **One record for the whole
package, never one per case** — recording once per case is wasted money.

**72 multi-minute turns per `npm run eval`, at `--max-concurrency 2` — hours,
real tokens.** That concurrency stays at 2: the cost was accepted upstream, and
raising it trades a shorter run for gateway rate-limit failures that read as
prompt regressions in the recorded baseline.

**A cell recorded below its true rate is a permanently lowered floor** —
`evals/compare-baseline.mjs` only fails on a rate that drops. Treat a
suspiciously low cell as a flake to re-run, not a number to write down.

- [ ] `evals/baseline.json` was produced by `npm run eval:baseline`, not by
      editing JSON
- [ ] It carries 18 cells, every key shaped `gemini-3.5|<case>|<variant>`
- [ ] No `gemini-3.5|clean` or `gemini-3.5|violation` key remains
- [ ] `recordedAt` corresponds to a real run
- [ ] No cell is recorded below the rate its run actually earned
- [ ] `--max-concurrency` is still 2
- [ ] `npm run eval` passes its own regression gate against the recorded file
- [ ] `npm run eval` is still outside the turbo `test` graph
