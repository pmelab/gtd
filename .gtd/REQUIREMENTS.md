# Requirements

The sketch in `.gtd/TODO.md`: **add an eval scenario for
`architecture.decompose` that asserts an `ARCHITECTURE.md` with 3 obvious
concerns is decomposed into 3 files.**

That directly overturns a committed decision.
`evals/cases/architecture-decompose.md` today argues the state ships **no**
case, because it writes a variable-sized set of files with nothing fixed to
compare against. The sketch settles the disagreement: pin the concern count in
the fixture, and the file count stops being variable.

## Concern 1 — Ship the `architecture.decompose` eval case

**PRODUCT.** The tenth prompt state gets the two-sided case every other one
already has.

**Acceptance:** `npm run eval -- --filter-pattern '^architecture-decompose:'`
runs two cells and both pass; today it matches nothing.

What ships:

- `evals/cases/architecture-decompose.mjs` — a frozen case object with
  `state: "architecture.decompose"`, a `base`, and two variants. Each variant's
  `.gtd/ARCHITECTURE.md` carries **exactly 3 concerns**, so the correct output
  file count is fixed at 3, not variable.
  - `clean` — 3 obvious, disjoint concerns, each one requirement. Nothing tempts
    a regrouping; the turn writes 3 files.
  - `violation` — the same 3 concerns, except **one visibly bundles two
    requirements** that `architecture.author` merged. The tempting wrong move is
    re-splitting it into its two halves for 4 files. The turn must carry the
    settled grouping over verbatim and still write **exactly 3**. This is the
    prompt's own instruction under test: "Do not merge or split concerns here."
- `evals/asserts/architecture-decompose.mjs` — the shared checks plus this
  state's own check: **exactly 3 files under `.gtd/packages/`, plus
  `.gtd/ARCHITECTURE.md` deleted**. Both variants assert the same count — the
  two sides differ in the fixture's temptation, not in the expected output.
- Two `tests:` entries in `evals/promptfooconfig.yaml`, descriptions
  `architecture-decompose:clean` and `architecture-decompose:violation`, each
  carrying `case`/`variant`/`challenge`.
- Delete `evals/cases/architecture-decompose.md`. Its argument is superseded,
  not amended — per this repo's own rule, a document that is now wrong gets
  deleted.
- Correct the stale counts the addition creates: `docs/development.md`'s "nine
  of the ten today" sentence and its pointer to the deleted `.md`;
  `evals/promptfooconfig.yaml`'s "all eighteen cells"; `evals/run-turn.mjs`'s
  and `tests/tooling/run-turn.test.ts`'s "every one of the nine" comments.

**No tier-3 judge on either cell.** `architecture.decompose` is the only prompt
state with no `file:` — there is no single contracted artifact to read back as
`feedback`, so the case declares no `artifact`, ships no `plantedIdentifier`,
and carries no `llm-rubric`. `docs/development.md` already sanctions exactly
this shape ("absent for a case with no contracted state file — that case's
`tests:` entries then carry no `llm-rubric` either"). The case is graded on
tiers 1 and 2 only.

**This makes `readFeedback`'s no-`artifact` branch live for the first time.**
Both the comment in `evals/run-turn.mjs` and the one at
`tests/tooling/run-turn.test.ts:91` state no bundled case exercises it end to
end. Both become false and must be updated.

### Risk: the exact-list check cannot match agent-chosen filenames

`isStructurallyOk` in `evals/run-turn.mjs` and `checkGtdFilesChanged` in
`evals/asserts/shared.mjs` both compare `gtdFilesChanged` against
`expect[variant].gtdFiles` by exact `JSON.stringify` equality. Package filenames
are `NN-name.md` — the `NN` order prefix is settled by the prompt, **the `name`
segment is chosen by the agent per concern**. An exact list cannot be written
down in advance.

The case therefore needs a count-and-shape check where every other case needs an
exact list, in **both** places — the grader and `run-turn.mjs`'s own copy.
Missing the `run-turn.mjs` copy makes the cell report `structurallyOk: false` no
matter what the grader says. How that check is expressed is a TECHNICAL decision
for the next phase.

### Risk: both variants expect the same output, so a lazy pass looks identical

Every other case's two sides expect DIFFERENT artifacts — feedback written vs.
silence, a merge recorded vs. not. Here both sides expect exactly 3 package
files and a deleted `.gtd/ARCHITECTURE.md`. **A turn that ignores the fixture
entirely and always emits one file per `##` heading passes both cells**, because
the bundled concern is still one heading. The violation fixture must therefore
make the bundled concern's two requirements structurally tempting to split — two
named requirements under one concern heading — and the `challenge` text must say
so, or the case grades nothing the `clean` cell did not already grade.

### Risk: a failed decompose turn may crash the trial instead of failing it

`architecture.decompose`'s only edge is `"* .gtd/packages/**"`. A turn that
writes no package file has no edge to take, so `gtd land` may refuse — and
`run-turn.mjs`'s `land()` runs the landing script through `sh` with no catch,
which kills the trial with a shell error rather than reporting a graded failure.
Confirm the worst-case turn still lands; if it does not, the trial must fail
with a reason, never a stack trace.

## Concern 2 — Record the two new baseline cells

**TECHNICAL.** The new case adds
`claude-opus-sonnet|architecture-decompose|clean` and `...|violation` to the
run. `compareCells` fails any cell present in the run but absent from
`evals/baseline.json` with "not recorded in baseline", so **every full
`npm run eval` reds until the cells are recorded**.

**Acceptance:** a full `npm run eval` exits clean, and `evals/baseline.json`
holds both new cells.

Kept separate from Concern 1 on purpose. Recording is a deliberate human action
off a real full run — 20 cells × 4 trials of multi-minute agent turns, real
tokens — and `npm run eval` is not part of `npm test`, so Concern 1 lands with
the suite green and this concern is gated on a run someone chooses to pay for.

**Do not run `npm run eval:baseline` off a filtered run.** A filtered run skips
the baseline gate and its `results.json` covers only the cells that ran;
recording from it would erase every other cell.

## Answered Questions

### Does the "ships no eval case" note stay, amended?

No — delete `evals/cases/architecture-decompose.md` outright. Its whole content
is an argument that is now false, and this repo deletes wrong documentation
rather than updating it.

### Should the case be two-sided like every other case?

Yes. The one-sided assertion the sketch describes ("3 concerns → 3 files") is
the `clean` variant; the suite's own convention is a matching `violation`
fixture, and the resolved question below picks which trap it plants.

### What does the `violation` side of the decompose case test?

Re-splitting a merged concern. The `violation` fixture's `.gtd/ARCHITECTURE.md`
carries 3 concerns, one of which visibly bundles two requirements; the turn must
carry that settled grouping over verbatim as 3 package files, never re-split it
into 4. It grades the prompt's own "do not merge or split concerns here"
instruction.

### Should the baseline recording ship in the same concern as the case?

No — separate concern. It needs a full, paid eval run rather than a code change,
and splitting it lets the case land against a green suite.
