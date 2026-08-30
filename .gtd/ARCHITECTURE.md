# Architecture

Two concerns, unchanged in count and order from `.gtd/REQUIREMENTS.md`. **No
merge:** concern 1 owns the eval harness and its case files, concern 2 owns
`evals/baseline.json` alone and only consumes the cells concern 1 creates — the
build-on-top exception, not a shared footprint.

## Concern 1 — Ship the `architecture.decompose` eval case

**PRODUCT.** The tenth prompt state gets the two-sided case every other one
already has.

**Acceptance:** `npm run eval -- --filter-pattern '^architecture-decompose:'`
runs two cells and both pass; today it matches nothing.

**Primary paths:** `evals/expect.mjs` (new),
`evals/cases/architecture-decompose.mjs` (new),
`evals/asserts/architecture-decompose.mjs` (new), `evals/run-turn.mjs`,
`evals/asserts/shared.mjs`, `evals/promptfooconfig.yaml`,
`tests/tooling/run-turn.test.ts`, `docs/development.md`, and the deletion of
`evals/cases/architecture-decompose.md`.

### The shared matcher is one new module, imported twice

`evals/expect.mjs` exports one pure function,
`matchGtdFiles(changed, expected)`, returning `undefined` on a match or a reason
string on a mismatch. **Nothing else in the repo may compare `gtdFilesChanged`
against an expectation.**

`isStructurallyOk` in `evals/run-turn.mjs` and `checkGtdFilesChanged` in
`evals/asserts/shared.mjs` both drop their own `JSON.stringify` equality and
call it. That is the whole point: the two copies exist today and already agree
by coincidence — a count-and-shape rule added to one and not the other makes
every cell report `structurallyOk: false` no matter what the grader says.

Plain ESM, no dependency. `evals/` is not TypeScript and not part of the `src/`
build; `evals/expect.mjs` is imported by both a `node` script and a promptfoo
`javascript` assert, so it must stay importable with no transform.

**Risk: `deadcode` (fallow) reds an export nothing reaches.** `matchGtdFiles`
has two importers from day one, so it is reachable — but a helper split out of
it and used by only one caller is not. Keep the module to the one export.

### `gtdFiles` is one polymorphic field, not two fields

`gtdFiles` keeps accepting the exact array the nine current cases declare, and
additionally accepts a descriptor object:
`{exact: [".gtd/ARCHITECTURE.md"], matching: {pattern: "^\\.gtd/packages/\\d\\d-[a-z0-9-]+\\.md$", count: 3}}`.
`matchGtdFiles` branches on `Array.isArray(expected)` and treats the array as
the default path, so the nine current cases keep byte-identical behaviour and
their recorded baseline cells stay comparable. **No second field, no precedence
rule.**

**Risk: a future case author must learn two shapes behind one name.** Pay it
down in `docs/development.md`'s `gtdFiles` paragraph — document both shapes in
one place — and by having `matchGtdFiles` reject a descriptor missing `exact` or
`matching` with a named reason, never a silent pass.

The decompose expectation asserts three facts together: `.gtd/ARCHITECTURE.md`
appears in the changed list (the turn deleted it), exactly **3** other paths
appear, and every one of those 3 matches `^\.gtd/packages/\d\d-[a-z0-9-]+\.md$`.
**A count alone is not enough** — three files named anything would pass it, and
the `NN` order prefix is settled by the prompt while the `name` segment is the
agent's.

### The case object

`evals/cases/architecture-decompose.mjs` — a frozen plain object, never executed
for behaviour, exactly like the other nine. **No function field**: the case
files are data that both a `node` process and a promptfoo assert import, and a
predicate there would put grading logic in the fixture.

- `state: "architecture.decompose"`.
- `base`: two or three small `src/*.ts` files the fixture's concerns can name,
  so every concern points at a real path — the same shape
  `evals/cases/architecture-author.mjs` uses.
- `variants.clean[".gtd/ARCHITECTURE.md"]`: **exactly 3** `##` concerns,
  disjoint, one requirement each. Nothing tempts a regrouping.
- `variants.violation[".gtd/ARCHITECTURE.md"]`: the same 3 concerns, one of
  which carries **two separately-named requirements under one heading**, plus
  the `## Merged Concerns` record that `architecture.author` would have written.
  The tempting wrong move is 4 files; the turn must write 3 and write **no**
  package file for the `## Merged Concerns` heading itself.
- `expect.clean` and `expect.violation`: the same count-and-shape expectation
  and `otherFiles: "none"` — this is a planner state and must never touch repo
  code.
- **No `artifact`, no `plantedIdentifier`, no `outOfBounds`.** There is no
  single contracted file to read back.

**Risk: both variants expect the same output, so a lazy pass looks identical.**
A turn that ignores the fixture and emits one file per `##` heading passes both
cells, because the bundled concern is still one heading. Mitigation is entirely
in the fixture and the `challenge` text: the two requirements must be visibly
separate items under that one heading, and the `challenge` must say the turn is
being graded on not re-splitting them. **If the violation fixture is not
structurally tempting, this case grades nothing the `clean` cell already
grades** — that is a review point on the fixture text, not something any assert
can catch.

### The grader

`evals/asserts/architecture-decompose.mjs` wires `SHARED_CHECKS` first — the
count-and-shape rule already lives inside `checkGtdFilesChanged` via
`matchGtdFiles`, so shared covers it — then adds one state-specific check: **no
package file references another `.gtd/` file**, which the prompt forbids
outright.

That check needs the package files' content, and the case declares no
`artifact`. Rather than widen `artifact` to a list, `run-turn.mjs` returns the
package file bodies in a new field on its JSON: `packageFiles`, a
`{path: content}` map read from `.gtd/packages/` after landing, empty when the
directory does not exist. Only this grader reads it; every other case ignores
it.

**Alternative rejected:** making `artifact` accept a glob. It is a single
contracted path in `docs/development.md` and in the tier-3 `feedback` contract;
overloading it would change what `feedback` means for all ten cases to serve
one.

### `readFeedback`'s no-`artifact` branch goes live

Both the comment in `evals/run-turn.mjs` (~line 418) and the one at
`tests/tooling/run-turn.test.ts:91` state no bundled case exercises that branch
end to end. **Both become false.** Rewrite them to say `architecture-decompose`
is the case that declares no `artifact`, and keep the unit test — it still pins
the branch's behaviour independent of a paid run.

### A refused `gtd land` must fail the trial, not crash it

`architecture.decompose`'s only edge is `"* .gtd/packages/**"`, and edge
selection fires when **any** pending change matches. So a turn that writes even
one package file lands, and a turn that writes nothing at all lands too — a
clean tree at a `prompt` rest commits an attempt.

**The reachable crash is a dirty tree with no matching change**: the turn
deletes `.gtd/ARCHITECTURE.md` and writes no package file, or writes a scratch
note under `.gtd/`. Then `gtd land` refuses, `gtd land --json=script` exits 1,
`execFileSync` throws, and the trial dies with a stack trace on stderr and
byte-empty stdout — the graders never run.

Fix in `evals/run-turn.mjs`, once, for every case: wrap the `land()` call in
`landAndInspect` in a `try`/`catch`. On failure, print the ordinary result JSON
with `structurallyOk: false`, empty `gtdFilesChanged`/`otherFilesChanged`, and a
new `landError` field carrying the refusal message — then **exit 0**. Exit 0 is
load-bearing: promptfoo's `exec:` provider only hands stdout to the asserts when
the process succeeded, so a non-zero exit is what turns a graded failure into a
harness error. `safeGrade` already reports a failing verdict from that JSON, and
`checkGtdFilesChanged` names the empty list in its reason.

### Config and doc edits

- Two `tests:` entries in `evals/promptfooconfig.yaml`, descriptions
  `architecture-decompose:clean` and `architecture-decompose:violation`, each
  carrying `case`/`variant`/`challenge`. **Neither carries an `llm-rubric`** —
  no `artifact` means no `feedback` to judge, and `docs/development.md` already
  sanctions that shape. Graded on tiers 1 and 2 only.
- `evals/promptfooconfig.yaml`'s "all eighteen cells" → twenty.
- `docs/development.md`: "nine of the ten today" → all ten, and drop the pointer
  to the deleted `.md`. Keep the sentence describing the absent-`artifact` shape
  and name this case as the one that uses it. Also document the count-and-shape
  expectation form next to the existing `gtdFiles` paragraph.
- Delete `evals/cases/architecture-decompose.md`. Its argument is superseded,
  not amended.

**Risk: `docs/**` is a declared input of `test:unit` and both e2e turbo tasks.**
Editing `docs/development.md` invalidates those caches; that is correct and
expected, not a failure. `tests/tooling/development-doc.test.ts` pins the
`## Prompt evals` section — a count edit there may red it, and the test is the
thing to update, in the same change.

## Concern 2 — Record the two new baseline cells

**TECHNICAL.** The new case adds
`claude-opus-sonnet|architecture-decompose|clean` and `...|violation` to the
run. `compareCells` fails any cell present in the run but absent from
`evals/baseline.json` with "not recorded in baseline", so **every full
`npm run eval` reds until the cells are recorded**.

**Acceptance:** a full `npm run eval` exits clean, and `evals/baseline.json`
holds both new cells.

**Primary path:** `evals/baseline.json`, and nothing else. No code changes.

Kept separate from concern 1 on purpose. Recording is a deliberate human action
off a real full run — 20 cells × 4 trials of multi-minute agent turns, real
tokens — and `npm run eval` is not part of `npm test`, so concern 1 lands with
the suite green and this concern is gated on a run someone chooses to pay for.

**The procedure is fixed:** run a full, unfiltered `npm run eval` with
`GTD_EVALS_URL`/`GTD_EVALS_KEY` set, confirm the two new cells pass, then
`npm run eval:baseline`, which rewrites `evals/baseline.json` from
`evals/results.json`.

**Do not run `npm run eval:baseline` off a filtered run.** A filtered run skips
the baseline gate and its `results.json` covers only the cells that ran;
recording from it would erase every other cell.

**Risk: a new cell can pass at less than 4/4 and still be recorded.** `record`
writes whatever rate the run measured, so a flaky cell recorded at 3/4 becomes
the bar every later run is compared to. Read the two new cells' rates before
recording; a rate below 4/4 is a signal to fix the fixture or the prompt, not to
record it.

## Answered Questions

### How does a case declare a non-exact `.gtd/` file expectation?

`gtdFiles` becomes polymorphic: still an exact array for the nine existing
cases, and a `{exact, matching: {pattern, count}}` descriptor for this one. One
field with one documented paragraph beats a second field with a precedence rule.

### Does the "ships no eval case" note stay, amended?

No — delete `evals/cases/architecture-decompose.md` outright. Its whole content
is an argument that is now false, and this repo deletes wrong documentation
rather than updating it.

### Should the case be two-sided like every other case?

Yes. The one-sided assertion the sketch describes ("3 concerns → 3 files") is
the `clean` variant; the suite's own convention is a matching `violation`
fixture.

### What does the `violation` side of the decompose case test?

Re-splitting a merged concern. The `violation` fixture's `.gtd/ARCHITECTURE.md`
carries 3 concerns, one of which visibly bundles two requirements; the turn must
carry that settled grouping over verbatim as 3 package files, never re-split it
into 4. It grades the prompt's own "do not merge or split concerns here"
instruction.

### Should the baseline recording ship in the same concern as the case?

No — separate concern. It needs a full, paid eval run rather than a code change,
and splitting it lets the case land against a green suite.

### Where does the count-and-shape check live?

In one new module, `evals/expect.mjs`, exporting `matchGtdFiles`, imported by
both `evals/run-turn.mjs` and `evals/asserts/shared.mjs`. Two independent copies
of the rule is the failure mode the requirement names by hand; one module makes
divergence impossible.

### How does the grader read package file content with no `artifact` declared?

`run-turn.mjs` adds a `packageFiles` map (path → content, empty when
`.gtd/packages/` is absent) to its JSON. Widening `artifact` to a glob would
change what `feedback` means for all ten cases to serve one.

### What happens when a decompose turn leaves changes no edge claims?

`run-turn.mjs` catches the `gtd land` failure, prints the ordinary result JSON
with `structurallyOk: false` and a `landError` field, and exits 0 so the graders
still run. A non-zero exit would report a harness error instead of a graded
failure.

### Does the case declare `plantedIdentifier` or `outOfBounds`?

Neither. `plantedIdentifier` greps `feedback`, which is empty with no
`artifact`; `outOfBounds` is a coder-case trap and this is a planner state whose
expectation already forbids every path outside the three package files.
