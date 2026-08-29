The human ticked every box in `.gtd/REVIEW.md` — that records reading, not
sign-off — left one note, and hand-edited four files. The hand-edits are a
sketch of intent, not finished work: the lap that follows re-derives them from
scratch and must not treat any of those lines as final.

`npm test` is green at this commit, so no suite-repair concern leads the list.
`evals/**` is an input to `lint`, `typecheck`, `deadcode` and `test:unit`, but
no turbo task ever executes an eval — **`npm test` cannot catch a broken eval
run, only broken eval source.** Every concern below therefore leaves the suite
green trivially; the real ordering constraint is the baseline, not the tests.

## Replace the two-model matrix with one planner/coder configuration

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

## Pick the default configuration and record what was rejected

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

## Grade naming the defect, not prescribing the fix

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

## Show each variant's challenge in the results table

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

## Re-record the baseline for the new configuration

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
