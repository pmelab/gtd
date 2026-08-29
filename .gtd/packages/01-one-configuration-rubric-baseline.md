# 01 — One model configuration, one honest rubric, one recorded baseline

Primary paths: `evals/promptfooconfig.yaml`, `evals/run-turn.mjs`,
`evals/baseline.json`.

Everything here is a data and comment edit to two files plus one recorded
artifact. **No new module, no new dependency, no new file.**

## Requirements

Five requirements were merged into this one package: every one of them edits
`evals/promptfooconfig.yaml`, and the fifth is the recorded output of a run of
the other four. None is independently landable, because each moves the pass rate
the others are measured against. Each is carried verbatim below and is reviewed
independently.

### Replace the two-model matrix with one planner/coder configuration

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

### Pick the default configuration and record what was rejected

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

### Grade naming the defect, not prescribing the fix

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

### Show each variant's challenge in the results table

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

### Re-record the baseline for the new configuration

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

## Tasks

### 1. Replace `--model` with a frozen class→env-var map in `evals/run-turn.mjs`

Map `planner`→`GTD_PLANNERMODEL` and `coder`→`GTD_CODERMODEL` in one frozen
object. Everything that read `model` reads that map, so a third class later is
one entry, never a new branch.

`parseArgs` loops the map's keys, records the indices each `--<class> <id>` pair
consumed in a `Set`, and takes the first surviving positional as the variant.
**The index bookkeeping is load-bearing** — promptfoo's `exec:` provider hands
the rendered prompt through as a bare positional in whatever slot it lands.

`modelClassChecks` emits two checks per class — flag present, and the id is not
`JUDGE_MODEL` — flattened into the existing `baseInfraChecks` array.

`modelServedFailures` replaces `modelServedFailure`: it probes `/models` once
per **distinct** id (`new Set(Object.values(models))`), so a configuration whose
halves are equal costs one call, and the unused half still fails at startup.

`scrubbedEnv` receives both vars, built by mapping the class map, so the unused
half is pinned rather than left to the workflow default.

The printed JSON's `model` field becomes `models: "planner=<id> coder=<id>"`.

**Error strategy is unchanged: `fail()` writes to stderr and exits 1 before any
token is spent.** Every new check is a startup check, never a mid-turn one — a
trial that reaches the agent has already proved its whole configuration is
servable.

`gtd next --json=model` read-back stays exactly where it is. It is the only
thing that would expose a renamed `plannerModel`/`coderModel` var in
`src/workflows/unified.yaml`, and the class map has no way to detect that rename
itself.

- [ ] `evals/run-turn.mjs` accepts `--planner <id> --coder <id>` and no longer
      accepts `--model`
- [ ] A run with only one of the two flags fails at startup naming the missing
      class
- [ ] A run naming an unserved model in the _unused_ class fails at startup
- [ ] Either class equal to `JUDGE_MODEL` fails at startup naming that class
- [ ] A configuration whose two halves are the same id costs exactly one
      `/models` probe
- [ ] The positional variant is still found whatever argv slot promptfoo puts it
      in
- [ ] Both `GTD_PLANNERMODEL` and `GTD_CODERMODEL` are injected into the
      scrubbed fixture env on every trial
- [ ] The result JSON carries `models: "planner=<id> coder=<id>"` and no longer
      carries `model`
- [ ] The `gtd next --json=model` read-back is still present and still what
      `writePiConfig` uses

### 2. Collapse `evals/promptfooconfig.yaml` to one configuration and pin the judge

One `providers:` entry:
`exec:node run-turn.mjs --planner gemini-3.5-flash --coder gemini-3.5-flash-lite`,
`label: gemini-3.5`.

The rejection evidence for `deepseek-v3.2` and `gemini-3.5-flash-lite` lives as
a comment directly above that entry — **the config is the only place the next
person picking a model looks**, and no markdown file may carry it (`AGENTS.md`
forbids prose that restates code).

The judge provider becomes `openai:chat:gpt-5.4`, and `JUDGE_MODEL` in
`evals/run-turn.mjs` becomes the same string. Those two constants are
deliberately duplicated, and the comment at each says so.

**Changing the judge means changing two files, and a mismatch disarms the guard
without failing anything.**

- [ ] `evals/promptfooconfig.yaml` has exactly one `providers:` entry, labelled
      `gemini-3.5`
- [ ] That entry pins `--planner gemini-3.5-flash --coder gemini-3.5-flash-lite`
- [ ] A comment above it names `deepseek-v3.2` (read `violation` as clean,
      closed with no feedback) and `gemini-3.5-flash-lite` (flagged `clean` for
      "missing automated unit tests" the spec never asks for)
- [ ] That comment states any replacement must be re-measured on BOTH variants
      at the full trial count, never one trial
- [ ] That comment states the coder half is unmeasured and its model was
      rejected for planner work
- [ ] That comment states the one-configuration rule and that comparing models
      is a two-line edit for one run
- [ ] The judge provider is `openai:chat:gpt-5.4` and `JUDGE_MODEL` in
      `evals/run-turn.mjs` is `gpt-5.4`
- [ ] A comment at each of those two constants says the other exists

### 3. Rewrite the tier-3 rubric to grade naming the defect

The `llm-rubric` `value:` drops "and says specifically what to change to fix
it". It grades that the feedback names the concrete defect: the specific
behaviour that violates the spec, identified precisely enough that a reader
knows which code is wrong and why. It need not prescribe the fix.

`transform:` is untouched — `STRUCTURAL FAILURE` remains the sentinel the rubric
explicitly fails.

**Do not re-add the prescribe-the-fix clause.** Whether spec-review feedback
should prescribe the fix is a question about the workflow prompt, not something
to smuggle in through the grader.

- [ ] The rubric text contains no clause requiring a prescribed fix
- [ ] The rubric still fails vague statements like "the package has problems"
- [ ] The rubric still fails the literal text `STRUCTURAL FAILURE`
- [ ] The `transform:` expression is byte-identical to before

### 4. Add a one-line `challenge` var to each variant

`challenge` is a display var: the `prompts:` template never interpolates it, so
promptfoo renders it as a results-table column and it reaches no model and
changes no turn.

The two lines:

- violation — `safeDivide(a, 0)` returns `Infinity` instead of throwing
  `DivisionByZeroError`; the reviewer MUST write `.gtd/SPEC_FEEDBACK.md` naming
  it.
- clean — `safeDivide` throws `DivisionByZeroError` exactly as the spec
  requires; the reviewer MUST stay silent and change nothing.

**Keep each one to a single line** — the column is a terminal width divided by
the number of columns.

- [ ] Both `tests:` entries carry a `challenge` var
- [ ] Each `challenge` is a single line
- [ ] The results table shows the challenge next to its verdict
- [ ] Editing a `challenge` string changes no turn's behaviour

### 5. Record `evals/baseline.json` from a real run

The last task, after every edit above is in the tree: run `npm run eval`, read
the per-cell matrix, then `npm run eval:baseline` to write `evals/baseline.json`
from that run's `results.json`. **Never hand-edit the JSON** — a hand-written
baseline is exactly the unverified placeholder this repo already removed once.

Two cells, four trials each: **eight real agent turns.**

**A cell that comes back below 4/4 is a flake to re-run, not a number to
record.** `evals/compare-baseline.mjs` only fails on a rate that _drops_, so an
under-recorded cell is a permanently lowered floor with nothing to catch it.

**A violation cell at 0/4 or 1/4 means the rubric change is wrong, not that the
baseline is low.** Treat it as a broken gate, not a recordable baseline.

- [ ] `evals/baseline.json` was produced by `npm run eval:baseline`, not by
      editing JSON
- [ ] Its `recordedAt` corresponds to a real run
- [ ] Its cell keys are `gemini-3.5|clean` and `gemini-3.5|violation`, matching
      the committed provider label
- [ ] The four old cells (`cheap|clean`, `cheap|violation`, `planner|clean`,
      `planner|violation`) are gone
- [ ] No cell is recorded below the rate its run actually earned
- [ ] `npm run eval` passes its own regression gate against the recorded file
