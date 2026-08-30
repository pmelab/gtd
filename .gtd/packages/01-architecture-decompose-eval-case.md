# Ship the `architecture.decompose` eval case

## Requirement

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

## Task 1 — One shared expectation matcher, imported twice

`evals/expect.mjs` exports one pure function,
`matchGtdFiles(changed, expected)`, returning `undefined` on a match or a reason
string on a mismatch. **Nothing else in the repo may compare a turn's changed
`.gtd/` paths against an expectation.**

`isStructurallyOk` in `evals/run-turn.mjs` and `checkGtdFilesChanged` in
`evals/asserts/shared.mjs` both drop their own `JSON.stringify` equality and
call it. The two copies exist today and agree only by coincidence — **a
count-and-shape rule added to one and not the other makes every cell report
`structurallyOk: false` no matter what the grader says.**

`gtdFiles` becomes polymorphic. It keeps accepting the exact array the nine
current cases declare, and additionally accepts a descriptor object:
`{exact: [".gtd/ARCHITECTURE.md"], matching: {pattern: "^\\.gtd/packages/\\d\\d-[a-z0-9-]+\\.md$", count: 3}}`.
`matchGtdFiles` branches on `Array.isArray(expected)` and treats the array as
the default path. **No second field, no precedence rule.**

Plain ESM, no dependency. `evals/` is not TypeScript and not part of the `src/`
build; the module is imported by both a `node` script and a promptfoo
`javascript` assert, so it must stay importable with no transform.

**Risk: `deadcode` (fallow) reds an export nothing reaches.** `matchGtdFiles`
has two importers from day one, so it is reachable — a helper split out of it
and used by only one caller is not. Keep the module to the one export.

**Risk: a future case author must learn two shapes behind one name.** Pay it
down in the `gtdFiles` paragraph of `docs/development.md` (task 6) and by
rejecting a descriptor missing `exact` or `matching` with a named reason, never
a silent pass.

- [ ] `evals/expect.mjs` exists and exports exactly one function,
      `matchGtdFiles`
- [ ] `matchGtdFiles` returns `undefined` on a match and a reason string on a
      mismatch — it never throws
- [ ] An exact-array expectation behaves byte-identically to today's
      `JSON.stringify` equality, so the nine current cases and their recorded
      baseline cells are unaffected
- [ ] A descriptor expectation passes only when every `exact` path is present,
      the remaining path count equals `count`, and every remaining path matches
      `pattern`
- [ ] A descriptor missing `exact` or missing `matching` returns a reason naming
      the missing key, never a pass
- [ ] `evals/run-turn.mjs`'s `isStructurallyOk` and `evals/asserts/shared.mjs`'s
      `checkGtdFilesChanged` both call `matchGtdFiles`, and neither retains its
      own comparison

## Task 2 — The case object

`evals/cases/architecture-decompose.mjs` is a frozen plain object, never
executed for behaviour, exactly like the other nine. **No function field**: case
files are data that both a `node` process and a promptfoo assert import, and a
predicate there would put grading logic in the fixture.

The `violation` fixture's `.gtd/ARCHITECTURE.md` carries 3 concerns, one of
which visibly bundles two requirements; the turn must carry that settled
grouping over verbatim as 3 package files, never re-split it into 4. That is the
prompt's own "do not merge or split concerns here" instruction under test.

**Risk: both variants expect the same output, so a lazy pass looks identical.**
A turn that ignores the fixture and emits one file per `##` heading passes both
cells, because the bundled concern is still one heading. The mitigation lives
entirely in the fixture text and the `challenge` text — **if the violation
fixture is not structurally tempting, this case grades nothing the `clean` cell
already grades**, and no assert can catch that.

- [ ] `evals/cases/architecture-decompose.mjs` exports a frozen plain object
      with `state: "architecture.decompose"` and no function-valued field
- [ ] `base` carries two or three small `src/*.ts` files, so every fixture
      concern names a real path
- [ ] `variants.clean` writes an `.gtd/ARCHITECTURE.md` with **exactly 3**
      disjoint `##` concerns, one requirement each, nothing tempting a
      regrouping
- [ ] `variants.violation` writes an `.gtd/ARCHITECTURE.md` with the same 3
      concerns, one of which carries **two separately-named requirements under
      one heading**, plus the `## Merged Concerns` record that would have
      produced it
- [ ] Both variants declare the same descriptor expectation:
      `.gtd/ARCHITECTURE.md` in `exact`, plus exactly **3** paths matching
      `^\.gtd/packages/\d\d-[a-z0-9-]+\.md$`
- [ ] Both variants declare `otherFiles: "none"` — a planner state must never
      touch repo code
- [ ] The case declares no `artifact`, no `plantedIdentifier`, and no
      `outOfBounds`

## Task 3 — The grader

`evals/asserts/architecture-decompose.mjs` wires `SHARED_CHECKS` first — the
count-and-shape rule already rides inside `checkGtdFilesChanged` via
`matchGtdFiles` — then adds one state-specific check: **no package file
references any other `.gtd/` file**, which the decompose prompt forbids
outright.

That check needs the package files' content, and the case declares no
`artifact`. `evals/run-turn.mjs` therefore returns a new `packageFiles` field on
its JSON: a `{path: content}` map read from the landed `.gtd/packages/`
directory, empty when the directory does not exist. Only this grader reads it.

**Rejected:** widening `artifact` to a glob. It is a single contracted path in
`docs/development.md` and in the tier-3 `feedback` contract; overloading it
would change what `feedback` means for all ten cases to serve one.

- [ ] `evals/run-turn.mjs` emits `packageFiles`, a path-to-content map of
      `.gtd/packages/`, and emits `{}` when that directory is absent
- [ ] `evals/asserts/architecture-decompose.mjs` runs `SHARED_CHECKS` before its
      own check
- [ ] Its own check fails a turn whose package file content references any other
      `.gtd/` path, and passes one that references none
- [ ] The grader returns a failing verdict rather than throwing on any input,
      matching the other nine

## Task 4 — A refused `gtd land` fails the trial, never crashes it

`architecture.decompose`'s only edge is `"* .gtd/packages/**"`, and edge
selection fires when **any** pending change matches. A turn that writes one
package file lands; a turn that writes nothing at all lands too, because a clean
tree at a prompt rest commits an attempt.

**The reachable crash is a dirty tree with no matching change** — the turn
deletes `.gtd/ARCHITECTURE.md` and writes no package file, or leaves a scratch
note under `.gtd/`. Then `gtd land` refuses, `gtd land --json=script` exits 1,
`execFileSync` throws, and the trial dies with a stack trace on stderr and
byte-empty stdout, so the graders never run.

Fix once, in `evals/run-turn.mjs`, for every case: wrap the `land()` call in
`landAndInspect` in a `try`/`catch`. On failure, print the ordinary result JSON
with `structurallyOk: false`, empty `gtdFilesChanged`/`otherFilesChanged`, and a
new `landError` field carrying the refusal message — then **exit 0**. Exit 0 is
load-bearing: promptfoo's `exec:` provider only hands stdout to the asserts when
the process succeeded, so a non-zero exit turns a graded failure into a harness
error.

- [ ] A `gtd land` refusal makes `evals/run-turn.mjs` print result JSON and exit
      0, never a stack trace with byte-empty stdout
- [ ] That JSON carries `structurallyOk: false`, empty `gtdFilesChanged` and
      `otherFilesChanged`, and a `landError` field with the refusal message
- [ ] `safeGrade` reports a failing verdict with a reason from that JSON
- [ ] A successful land is unchanged in output shape apart from the added fields

## Task 5 — `readFeedback`'s no-`artifact` branch goes live

The comment near `readFeedback` in `evals/run-turn.mjs` and the one at
`tests/tooling/run-turn.test.ts:91` both state that no bundled case exercises
that branch end to end. **Both become false** once this case ships.

- [ ] Both comments name `architecture-decompose` as the case that declares no
      `artifact`, and neither still claims the branch has no live case
- [ ] The `readFeedback` unit tests stay, pinning the branch independent of a
      paid eval run

## Task 6 — Config and doc edits

Two `tests:` entries in `evals/promptfooconfig.yaml`, descriptions
`architecture-decompose:clean` and `architecture-decompose:violation`, each
carrying `case`/`variant`/`challenge`. **Neither carries an `llm-rubric`** — no
`artifact` means no `feedback` to judge, and `docs/development.md` already
sanctions that shape. The case is graded on tiers 1 and 2 only.

The `violation` entry's `challenge` must state that the turn is graded on not
re-splitting the bundled concern, or the fixture's temptation goes unstated.

**Risk: `docs/**` is a declared input of `test:unit` and both e2e turbo tasks.**
Editing `docs/development.md` invalidates those caches; that is correct, not a
failure. `tests/tooling/development-doc.test.ts` pins the `## Prompt evals`
section — a count edit there may red it, and that test is updated in this same
change.

- [ ] `evals/promptfooconfig.yaml` gains exactly two `tests:` entries with
      descriptions `architecture-decompose:clean` and
      `architecture-decompose:violation`
- [ ] Neither entry carries an `llm-rubric`
- [ ] The `violation` entry's `challenge` says the turn must write exactly 3
      package files and must not re-split the bundled concern
- [ ] `evals/promptfooconfig.yaml`'s "all eighteen cells" reads twenty
- [ ] `docs/development.md`'s "nine of the ten today" reads all ten, and its
      pointer to the deleted `evals/cases/architecture-decompose.md` is gone
- [ ] `docs/development.md` keeps the sentence describing the absent-`artifact`
      shape and names this case as the one that uses it
- [ ] `docs/development.md`'s `gtdFiles` paragraph documents both accepted
      shapes — exact array and `{exact, matching}` descriptor — in one place
- [ ] `evals/cases/architecture-decompose.md` is deleted, not amended
- [ ] `tests/tooling/development-doc.test.ts` passes against the edited section
- [ ] `npm test` is green
- [ ] `npm run eval -- --filter-pattern '^architecture-decompose:'` runs two
      cells and both pass
