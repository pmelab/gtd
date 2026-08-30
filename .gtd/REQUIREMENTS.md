# Requirements

The sketch in `.gtd/TODO.md`: **add an eval scenario for
`architecture.decompose` that asserts an `ARCHITECTURE.md` with 3 obvious
concerns is decomposed into 3 files.**

That directly overturns a committed decision.
`evals/cases/architecture-decompose.md` today argues the state ships **no**
case, because it writes a variable-sized set of files with nothing fixed to
compare against. The sketch settles the disagreement: pin the concern count in
the fixture, and the file count stops being variable.

## Open Questions

### What does the `violation` side of the decompose case test?

Every other case is two-sided — one fixture the state must act on, one it must
leave alone. The sketch names only the clean side (3 concerns → 3 files). The
violation side decides what the suite actually protects.

- [ ] A `## Merged Concerns` record — the ARCHITECTURE.md carries 3 concerns
      plus a `## Merged Concerns` section recording an earlier merge; the prompt
      says write no package file for it, so the turn must still produce exactly
      3 files, never 4. Tests the one trap the prompt calls out by name.
- [x] Re-splitting a merged concern — the ARCHITECTURE.md carries 3 concerns,
      one of which visibly bundles two requirements; the turn must carry the
      settled grouping over verbatim as 3 files, not re-split it into 4. Tests
      "do not merge or split concerns here."
- [ ] _your answer_

## Concern 1 — Ship the `architecture.decompose` eval case

**PRODUCT.** The tenth prompt state gets the two-sided case every other one
already has.

**Acceptance:** `npm run eval -- --filter-pattern '^architecture-decompose:'`
runs two cells and both pass; today it matches nothing.

What ships:

- `evals/cases/architecture-decompose.mjs` — a frozen case object with
  `state: "architecture.decompose"`, a `base`, and two variants. Each variant's
  `.gtd/ARCHITECTURE.md` carries **exactly 3 obvious, disjoint concerns**, so
  the correct output file count is fixed at 3, not variable.
- `evals/asserts/architecture-decompose.mjs` — the shared checks plus this
  state's own check: **exactly 3 files under `.gtd/packages/`, plus
  `.gtd/ARCHITECTURE.md` deleted**.
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
fixture, and the open question above picks which trap it plants.

### Should the baseline recording ship in the same concern as the case?

No — separate concern. It needs a full, paid eval run rather than a code change,
and splitting it lets the case land against a green suite.
