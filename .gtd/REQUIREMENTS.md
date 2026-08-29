The human ticked every box in `.gtd/REVIEW.md` — that records reading, not
sign-off — left one note, and hand-edited four files. The hand-edits are a
sketch of intent, not finished work: the lap that follows re-derives them from
scratch and must not treat any of those lines as final.

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

Acceptance: no sentence in `docs/development.md` describes the providers as
competing models rather than one configuration.

## Build eval cases for the remaining prompts

PRODUCT.

The human's note: **"build out the eval cases for all other prompts as well".**

Today one case exists — `spec-review`, covering `packages.item.spec.review`.
Every other prompt state in the bundled workflow is ungraded. Each new case
needs the full shape the docs already describe: an `evals/cases/<name>.mjs`
frozen object naming a `state` with two-sided `clean`/`violation` fixtures and
the identifier the violation's feedback must name, a matching
`evals/asserts/<name>.mjs` grader, and both wired into
`evals/promptfooconfig.yaml`'s `tests:`.

**A coder-class case is the first one that exercises the unused half of the
configuration, and `gemini-3.5-flash-lite` has never been measured in that
half** — it must be measured on both variants at full trial count before its
cells are recorded, on the same footing as any planner candidate.

Each case added is a new pair of baseline cells and multiplies run cost and wall
clock; that is the trade the note accepts.

Acceptance: every prompt state the workflow can rest at has a two-sided case, or
a stated reason it cannot have one.
