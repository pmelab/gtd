# Architecture

## Merged Concerns

Five concerns merge into one package. Every one of them edits
`evals/promptfooconfig.yaml`, and the fifth is the recorded output of a run of
the other four — none of them is independently landable, because each moves the
pass rate the others are measured against. The requirements below are carried
verbatim so the per-package spec review covers each one on its own.

### Merged into "One model configuration, one honest rubric, one recorded baseline"

#### Replace the two-model matrix with one planner/coder configuration

TECHNICAL.

The eval matrix stops comparing a `planner` tier against a deliberately cheap
tier. **A promptfoo provider becomes one model _configuration_ — a pair of one
planner model and one coder model — because a case names a workflow state, never
a model, and the class that state carries picks which half of the pair runs the
turn.** `packages.item.spec.review` is planner-class; a build-class case added
later must inherit the same configuration instead of falling back to a stray
default.

The sketch reached for this shape:

- `run-turn.mjs` takes `--planner <id> --coder <id>` instead of `--model <id>`,
  driven off a frozen class→env-var map (`planner`→`GTD_PLANNERMODEL`,
  `coder`→`GTD_CODERMODEL`), and injects **both** vars into the scrubbed fixture
  env on every trial even though today's single case consumes only one.
- Both flags are required. A missing half fails at startup rather than grading
  an unrecorded fallback.
- The startup `/models` probe checks **every distinct id in the configuration**,
  not just the class the case uses, so a typo in the unused half fails
  immediately instead of lying dormant until a case of that class exists.
- The judge-model guard runs per class: neither half may equal the pinned judge.
- Argument parsing tracks which indices the flags consumed, so the positional
  `{{variant}}` promptfoo hands through is still found whatever slot it lands
  in.
- The result JSON reports `models: "planner=<id> coder=<id>"` in place of the
  old single `model` field.

**The committed default is exactly ONE configuration.** Every extra provider
multiplies the whole run (trials = cases × variants × `--repeat` × providers)
and adds a `evals/baseline.json` cell that can flake. Comparing two model
choices is a deliberate two-line edit for one run, read as two rows of the
per-cell matrix — never a permanent cost on every run.

The env-var names `GTD_PLANNERMODEL` and `GTD_CODERMODEL` are not free
identifiers: they are the `GTD_<NAME>` overrides for the `plannerModel` and
`coderModel` vars declared at the top of `src/workflows/unified.yaml`. **Rename
either var there and this map goes silently stale** — the turn would run on the
workflow default while the result JSON still reports the id that was asked for.
The existing read-back of the resolved name from `gtd next --json=model` is the
only thing that would expose it, so keep it.

Acceptance: a run with only one of the two flags fails at startup naming the
missing class; a run naming an unserved model in the _unused_ class fails at
startup; the result JSON carries both ids.

#### Pick the default configuration and record what was rejected

TECHNICAL.

The sketch moved the default configuration to `gemini-3.5-flash` (planner) and
`gemini-3.5-flash-lite` (coder), and moved the tier-3 judge to `gpt-5.4`.

**The judge must be a different vendor from every model in the matrix** — a
model grading its own output is not a grader. The sketch also recorded that
judge cost is negligible regardless of tier: it runs only on `violation` trials,
over a few hundred tokens of feedback, next to driver turns measured in minutes.

**Two planner candidates were measured on the full `--repeat` and rejected, and
that evidence must survive in the config where the next person picking a model
will read it:**

- `deepseek-v3.2` read the `violation` variant as clean and closed the package
  with no feedback.
- `gemini-3.5-flash-lite` did the mirror image — it flagged the `clean` variant
  for "missing automated unit tests" the spec never asks for.

Both passed on a single trial per cell, so **any replacement must be re-measured
on BOTH variants at the full trial count**, never one trial. Both rejections are
class-specific: `gemini-3.5-flash-lite` still sits in the coder half, where
nothing has measured it either way, because no coder-class case exists yet.

**Risk, stated plainly: the coder half is unmeasured and its chosen model was
rejected for planner work.** That is defensible only while no coder-class case
exists. The moment the first one lands (see the last concern),
`gemini-3.5-flash-lite` is a candidate under test, not a settled default, and
must clear both variants at full trial count before its cells are recorded.

**The judge is pinned to a dated model id the gateway serves, never a floating
alias.** `gpt-5.4` is whatever the gateway maps it to today, so a baseline
recorded against it can shift with no commit in this repo and a regression the
gate reports may be the judge moving rather than the prompt. The cost accepted
in exchange is a manual bump whenever the gateway retires that id — a bump that
must be treated as a baseline-invalidating change, not a version-string edit.

`JUDGE_MODEL` is duplicated in `run-turn.mjs` rather than imported from the
YAML, on purpose — it is the startup guard that the judge is never the model
under test. **Changing the judge means changing two files**, and a mismatch
disarms the guard without failing anything.

Acceptance: the config states the rejected candidates, their failure mode, and
the both-variants re-measurement rule.

#### Grade naming the defect, not prescribing the fix

PRODUCT.

The tier-3 rubric drops "and says specifically what to change to fix it". **That
clause failed 7 of 8 violation trials whose feedback the judge itself called
concrete and specific, driving the violation cells to 0/4 and 1/4 — and a
recorded baseline at 0/4 is a rate that can never regress, i.e. a dead gate.**

The rubric the sketch reached for grades that the feedback names the concrete
defect: the specific behaviour that violates the spec, identified precisely
enough that a reader knows which code is wrong and why. It need not prescribe
the fix. Vague statements like "the package has problems" still fail, and so
does the literal text `STRUCTURAL FAILURE`.

**Whether spec-review feedback SHOULD prescribe the fix is a question about the
workflow prompt, not something to smuggle in through the grader.** Do not re-add
the clause here.

**This change moves the violation cell's pass rate, so it invalidates the
baseline exactly as a label change does** — it must land before the re-record
concern below, not after.

Acceptance: a violation cell scoring 0/4 or 1/4 under a rubric change is treated
as a broken gate, not a recordable baseline.

#### Show each variant's challenge in the results table

PRODUCT.

promptfoo renders one column per test var, and `variant` alone reads as a bare
label with no way to tell what the fixture actually planted. The sketch adds a
`challenge` var per variant — **displayed, never executed**: the prompt is
`{{variant}}`, so `challenge` reaches no model and changes no turn.

The two it wrote:

- violation — `safeDivide(a, 0)` returns `Infinity` instead of throwing
  `DivisionByZeroError`; the reviewer MUST write `.gtd/SPEC_FEEDBACK.md` naming
  it.
- clean — `safeDivide` throws `DivisionByZeroError` exactly as the spec
  requires; the reviewer MUST stay silent and change nothing.

**Keep each one to a single line** — the column is a terminal width divided by
the number of columns.

Every case added by the last concern owes its own pair of `challenge` lines;
this is the convention they follow, not a one-off for spec-review.

Acceptance: the results table shows the challenge next to its verdict, and no
turn's behaviour changes when the text is edited.

#### Re-record the baseline for the new configuration

TECHNICAL.

The old baseline's four cells (`cheap|clean`, `cheap|violation`,
`planner|clean`, `planner|violation`) no longer exist — the matrix and
`evals/baseline.json` both key off the provider `label`, so a label that appears
or disappears reads as an unrecorded or missing cell and fails the gate until
re-recorded.

The sketch hand-wrote the file down to two `gemini-3.5|clean` and
`gemini-3.5|violation` cells at 4/4. **A hand-written baseline is exactly the
unverified placeholder this repo already removed once. The lap must produce it
from a real `npm run eval` / `npm run eval:baseline` pair, not by editing
JSON.**

**This concern must land last of the four above it.** The label change, the
model change and the rubric change each move the recorded rates; re-recording
before all three are in place buys a snapshot that is stale on arrival, at the
price of a full multi-minute, real-token run.

`compare-baseline.mjs` only fails on a rate that _drops_. **A cell recorded
below its true rate is a permanently lowered floor** — the review round already
caught one such cell at 3/4. Record only cells whose run you would defend, and
treat a suspiciously low cell as a flake to re-run, not a number to write down.

Acceptance: `recordedAt` corresponds to a real run, and the cell keys match the
committed provider labels.

## One model configuration, one honest rubric, one recorded baseline

Primary paths: `evals/promptfooconfig.yaml`, `evals/run-turn.mjs`,
`evals/baseline.json`.

Everything here is a data and comment edit to two files plus one recorded
artifact. **No new module, no new dependency, no new file.**

### `run-turn.mjs` — the class→env-var map

Replace the single `--model` flag with a frozen `MODEL_CLASSES` object mapping
`planner`→`GTD_PLANNERMODEL` and `coder`→`GTD_CODERMODEL`. Everything that used
to read `model` reads that map instead, so adding a third class later is one
entry, never a new branch:

- `parseArgs` loops the map's keys, records the indices each `--<class> <id>`
  pair consumed in a `Set`, and takes the first surviving positional as the
  variant. **The index bookkeeping is load-bearing** — `exec:` hands the
  rendered prompt through as a bare positional in whatever slot it lands.
- `modelClassChecks` emits two checks per class — flag present, and the id is
  not `JUDGE_MODEL` — flattened into the existing `baseInfraChecks` array.
- `modelServedFailures` replaces `modelServedFailure`: it probes `/models` once
  per **distinct** id (`new Set(Object.values(models))`), so a configuration
  whose halves are equal costs one call, and the unused half still fails at
  startup.
- `scrubbedEnv` receives both vars, built by mapping the class map, so the
  unused half is pinned rather than left to the workflow default.
- The printed JSON's `model` field becomes `models: "planner=<id> coder=<id>"`.

**Error strategy is unchanged and stays: `fail()` writes to stderr and exits 1
before any token is spent.** Every new check is a startup check, never a
mid-turn one — a trial that reaches the agent has already proved its whole
configuration is servable.

`gtd next --json=model` read-back stays exactly where it is. It is the only
thing that would expose a renamed `plannerModel`/`coderModel` var in
`src/workflows/unified.yaml`, and the class map has no way to detect that rename
itself.

### `promptfooconfig.yaml` — one provider, two vars, one rubric

One `providers:` entry:
`exec:node run-turn.mjs --planner gemini-3.5-flash --coder gemini-3.5-flash-lite`,
`label: gemini-3.5`. The rejection evidence for `deepseek-v3.2` and
`gemini-3.5-flash-lite` lives as a comment directly above that entry — **the
config is the only place the next person picking a model looks**, and there is
no markdown file that may carry it (`AGENTS.md` forbids prose that restates
code).

The judge provider becomes `openai:chat:gpt-5.4`, and `JUDGE_MODEL` in
`run-turn.mjs` becomes the same string. Those two constants are deliberately
duplicated; the comment at each says so.

Each `tests:` entry gains a single-line `challenge` var. It is a display var —
the `prompts:` template never interpolates it, so promptfoo renders it as a
column and nothing else reads it.

The `llm-rubric` `value:` drops the prescribe-the-fix clause and grades naming
the defect. `transform:` is untouched — `STRUCTURAL FAILURE` remains the
sentinel the rubric explicitly fails.

### Recording the baseline

The last task in this package, after every edit above is in the tree: run
`npm run eval`, read the per-cell matrix, then `npm run eval:baseline` to write
`evals/baseline.json` from that run's `results.json`. **Never hand-edit the
JSON.** Two cells, four trials each: eight real agent turns.

**A cell that comes back below 4/4 is a flake to re-run, not a number to
record** — `compare-baseline.mjs` only fails on a rate that drops, so an
under-recorded cell is a permanently lowered floor with nothing to catch it. A
violation cell at 0/4 or 1/4 means the rubric change is wrong, not that the
baseline is low.

## Rewrite the eval docs around configurations

PRODUCT.

`docs/development.md` must stop saying "model matrix" and "per model" and say
model **configuration** throughout — including the `npm run eval` comment line,
the two-axis versioning paragraph, and the per-fixture/per-configuration report
description.

The sketch also adds a paragraph to the "To add a case" section stating: a case
names a workflow `state`, never a model; the state's class picks which half of
the configuration runs it, so a review case and a build case in the same run are
each graded on the tier they ship against; the committed default is ONE
configuration and why; how to compare model choices for one run; and that
baseline cells key off the provider label.

The doc also claims the harness is "restricted to a four-tool surface (`read`,
`write`, `edit`, `bash`)". **That is `pi`'s default, not something this repo
pins — a `pi` version bump could widen the surface with nothing failing.**
Either pass the flag that pins it or soften the sentence to describe the
default; do not leave a guarantee the code does not make.

Two settled facts belong in this doc as well: **`npm run eval` runs every case
every time — hours, real tokens, no default subset** — and **the tier-3 judge is
pinned to a dated model id, so bumping it invalidates the baseline.** A reader
deciding whether to run the command needs the first; a reader comparing two
baselines needs the second.

Acceptance: no sentence in `docs/development.md` describes the providers as
competing models rather than one configuration.

### How

Primary path: `docs/development.md`, `## Prompt evals` section only. Prose edit;
no code.

**Resolve the four-tool claim by pinning, not by softening.** `run-turn.mjs`
already spawns `pi` with an explicit argv; add the tool-restriction flag to that
argv and the doc's sentence becomes a fact the code states. Softening leaves a
reader guessing which tools a recorded baseline was measured under, and the
harness axis of the two-axis versioning claim then covers nothing. If the
installed `pi` 0.84.4 exposes no such flag, the sentence is rewritten to name
the default explicitly ("`pi`'s default surface, not pinned here") — never left
as an unqualified guarantee.

That one flag is the only code touched by this package, and it lives in the same
argv the pin is claimed about. It does not move any pass rate, so **this package
does not invalidate the baseline.**

Every renamed term is a search-and-replace with a check:
`grep -in "matrix\|per model\|both models" docs/development.md` must come back
empty except where the word describes the per-cell results _matrix_, which is
still a matrix.

## Build eval cases for the remaining prompts

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

### How

Primary paths: `evals/run-turn.mjs`, `evals/asserts/*.mjs`, `evals/cases/*.mjs`,
`evals/promptfooconfig.yaml`, `evals/report.mjs`, `evals/baseline.json`.

This package is one refactor plus eight new cases. **The refactor is the hard
part; each case is then a data file and a thin grader.**

**Eight, not nine: `architecture.decompose` ships a stated reason instead of a
case.** It writes a variable set of `.gtd/packages/*` files, so the "only the
contracted artifact changed" check every other case leans on has nothing to
compare against. The reason ships as `evals/cases/architecture-decompose.md`,
sitting next to the cases it explains — a `.md` file in `evals/cases/` is inert,
since the config lists its tests one by one and never globs the directory.

**Nine cases total including today's spec-review: 9 × 2 variants × `--repeat 4`
= 72 trials, and 18 baseline cells.** The requirement's 80 assumed ten cases.

#### Case identity and the baseline cell key

The case rides in the prompt. `prompts:` becomes `"{{case}}:{{variant}}"`, each
`tests:` entry gains a `case` var alongside `variant` and `challenge`, and
`run-turn.mjs` splits the single positional on the first `:` and dynamically
imports `./cases/<case>.mjs`. **One provider entry survives, so the
configuration stays singular** — the rejected alternative was one provider per
(configuration × case), which would put ten providers behind a plan whose whole
point is one.

`report.mjs`'s `cellKey` becomes `` `${label}|${case}|${variant}` ``. Every key
in `evals/baseline.json` gains a case segment; nothing else in
`compare-baseline.mjs` changes, because it treats the key as an opaque string.

**Risk: this rekeys the cells the first package recorded.** The moment the key
changes, `gemini-3.5|clean` and `gemini-3.5|violation` read as baseline cells
missing from the run AND the new `gemini-3.5|spec-review|*` cells read as
unrecorded — four violations at once. `npm run eval` fails until this package's
own re-record lands, so the rekey and the record must ship in the same package.

`case` is a real prompt var, unlike `challenge`. The rendered prompt is the
whole argument `run-turn.mjs` parses, so a case whose name contains `:` breaks
the split — names stay `[a-z-]+`, matching every existing case file.

#### Make `run-turn.mjs` case-agnostic

Today it does `import spec from "./cases/spec-review.mjs"` at module scope, and
three functions hardcode that case's contract: `readFeedback` opens
`.gtd/SPEC_FEEDBACK.md`, `expectedGtdFiles` maps variant→that one path, and
`identifierOk` greps `spec.plantedIdentifier`. All three become data reads off
the loaded case.

The case object grows three fields, and **every one of them is data the case
already implies — no case gains a behaviour hook, no case exports a function.**
A case file stays a frozen plain object so it can be imported by the grader, the
provider, and a future report without executing anything:

- `artifact` — the repo-relative path whose content is read back as `feedback`
  and fed to the tier-3 rubric. Absent for a case that produces no state file
  (`packages.item.building`).
- `expect[variant].gtdFiles` — the exact `.gtd/` paths the turn may change,
  replacing `expectedGtdFiles`. Today's `expect: {violation: {feedback: true}}`
  becomes an explicit list; the empty list is what makes a "must not act"
  variant checkable.
- `expect[variant].otherFiles` — `"none"` for the five planner cases,
  `"required"` for the four coder cases, which must change repo code. **The
  current hard rule "`otherFilesChanged` must be empty" is planner-only and
  cannot survive as a global**; a coder case that changes nothing is the
  failure, not the pass.

**No fixture runs a test suite.** A trial stays exactly one agent turn plus
`gtd land`, and the landed diff is the only thing graded — no fixture ships a
runnable `testCommand`, and `run-turn.mjs` never advances a second beat into
`packages.item.health.check`. **Risk, stated plainly: the "and a passing suite"
half of a coder pair goes ungraded.** A coder case can only prove the turn wrote
the contracted artifact and took the right move, never that its code runs.

`isStructurallyOk` reads those fields instead of branching on the variant name.
It keeps its job: gate the expensive judge behind the free checks, so a broken
turn costs a two-token rubric call rather than a full-size one.

#### Nine graders, one shared core

`evals/asserts/<name>.mjs` stays one file per case, as the docs already promise
— **that is the file a reader opens when a specific case fails, and a single
generic grader would put the case's own rules somewhere else.** But its four
current checks are case-independent once they read `expect`, so they move to
`evals/asserts/shared.mjs` and each case's grader becomes: import the shared
check list, import its own case, run them, then add whatever is genuinely
specific to that state.

Genuinely specific, per class:

- Planner cases (`design.triage`, `architecture.author`,
  `build.review.reviewing`, `build.review.collecting`, and today's
  `packages.item.spec.review`) — the artifact must parse as the shape the next
  state reads. `build.review.collecting` writes `.gtd/REQUIREMENTS.md`, so its
  grader checks the concerns carry a PRODUCT/TECHNICAL classification;
  `architecture.author` checks `## Merged Concerns` is present or absent, never
  malformed.
- Coder cases — `otherFilesChanged` must be non-empty and must **not** include
  any file the fixture's spec puts out of bounds. The planted wrong move is a
  file the fixture makes tempting; touching it fails.

Errors stay where they are: a grader returns `{pass: false, score: 0, reason}`
and never throws, so one bad trial reports a reason instead of killing the run.

#### Fixture reach for the nine new states

`buildFixture` needs no change — `gtd --entry <state>` already takes any state
path, and each case's `base` supplies whatever that state reads. The work per
case is picking the prerequisite files:

- `design.triage` and `build.review.collecting` need an entry diff and (for
  collecting) a `.gtd/REVIEW.md`; the fixture commits the base then leaves the
  variant's change uncommitted, exactly as today.
- `architecture.author` needs a `.gtd/REQUIREMENTS.md` in `base`.
- `packages.item.*` need a `.gtd/NEXT.md` package file, as spec-review already
  has.
- `build.fix` and `packages.item.fix-suite` need a `.gtd/FEEDBACK.md`;
  `packages.item.fix-spec` needs a `.gtd/SPEC_FEEDBACK.md`.

**Fixtures leave `modes:` unset in `.gtdrc.json`.** Four of the new states carry
`mode: qa` or `mode: review`, but a fixture with no `modes:` config resolves
`gtd next --json=validate` to nothing, so `run-turn.mjs`'s existing "expected no
validate step" guard keeps passing untouched. Configuring a validator would
require a re-prompt loop, and **exactly one agent turn per trial is the eval's
whole contract** — a second turn would grade recovery, not the prompt.

#### Cost, stated plainly

**72 multi-minute turns per `npm run eval`, at `--max-concurrency 2` — hours,
real tokens.** That concurrency stays at 2: the cost was accepted upstream, and
raising it trades a shorter run for gateway rate-limit failures that read as
prompt regressions in the recorded baseline.

The last task, after all eight new cases are wired: one `npm run eval` followed
by `npm run eval:baseline`, writing all 18 cells. **One record for the whole
package, never one per case.** `gemini-3.5-flash-lite` is under test in the
coder half for the first time here — if its coder cells come back mixed, it is a
candidate to replace, not a floor to record.

## Answered Questions

### Does "build out the eval cases for all other prompts" override the original no-coverage-driven-cases constraint?

Yes. The entry sketch in `.gtd/TODO.md` said "only encode past regressions as
cases — no coverage-driven case writing", but the human's review-round note is
later and explicit, so it supersedes that constraint for prompt-state coverage.

### Should the review round's ticked `.gtd/REVIEW.md` findings be treated as accepted work?

No. The workflow states that ticking records only that the human read the hunk,
never sign-off; this round's actionable material is the note plus the four
hand-edited files, and a REVIEW.md finding enters the plan only where a
hand-edit touched the same line.

### Does `npm run eval` run every case by default, or only a named subset?

Every case, every run. The baseline gate covers the whole workflow and the run
reports one honest number, at the accepted cost of an hours-long, expensive
command — 80 multi-minute turns at ten cases, versus 8 today.

### Is the tier-3 judge pinned to a dated model id, or left as a gateway alias?

Pinned to a dated id the gateway serves, so a recorded baseline is reproducible
and cannot shift under the repo. The cost accepted is a manual bump whenever the
gateway retires that id.

### Does the baseline get recorded once, or once per package?

Twice across the whole plan, and never more. The configuration package records
its own two cells because the gate fails on an unrecorded cell and the package
must land green on its own; the cases package rekeys those two and records all
18 at the end. The "recording once per case is wasted money" rule bars ten runs,
not two.

### Do the new cases configure a `modes:` validator in their fixtures?

No. A fixture with no `modes:` config emits no `validate` step, which keeps the
existing one-turn guard in `run-turn.mjs` intact. Running a validator would
require re-prompting the agent on failure, and the eval grades exactly one turn.

### Does each case keep its own grader file, or share one generic grader?

Its own file, over a shared check list in `evals/asserts/shared.mjs`. The
per-case file is what a reader opens when a named cell fails, and the docs
already promise `evals/asserts/<name>.mjs` exists.

### How does `run-turn.mjs` learn which model class a state runs under?

It does not, and must not. Both `GTD_PLANNERMODEL` and `GTD_CODERMODEL` are
injected on every trial and the workflow itself picks; `gtd next --json=model`
reads the resolved id back. Duplicating the state→class table into the eval
would be a second source of truth that goes stale silently.

### Should `--max-concurrency` rise to shorten an 80-turn run?

No. It stays at 2. The hours-long cost was accepted upstream, and a rate-limited
trial fails as a prompt regression, which poisons the recorded baseline with a
number that has nothing to do with the prompt.

### How does a case identify itself to `run-turn.mjs`, and what keys its baseline cell?

The case rides in the prompt: `prompts:` becomes `"{{case}}:{{variant}}"`,
`run-turn.mjs` splits the single positional and dynamically imports
`./cases/<case>.mjs`, and `report.mjs`'s `cellKey` becomes `label|case|variant`,
so every `evals/baseline.json` key gains a case segment. One provider entry
survives, keeping the configuration singular.

### Do coder-class cases run the fixture's test suite?

No. A trial stays exactly one agent turn plus `gtd land`, and the landed diff is
the only thing graded — no fixture ships a runnable `testCommand`. The "and a
passing suite" half of a coder pair goes ungraded.

### Does `architecture.decompose` get a case or a stated reason?

A stated reason, shipped as `evals/cases/architecture-decompose.md`. It writes a
variable set of `.gtd/packages/*` files, so the "only the contracted artifact
changed" check every other case leans on has nothing to compare against.
