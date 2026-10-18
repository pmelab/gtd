## Interfaces

**One parser change, two prompt changes. No new module, no engine change, no
`allowEmpty`.** Both concerns ship in one package (see `## Merged Concerns`).

```ts
// src/workflows/feature/packages.ts
export interface DeclaredTest {
  readonly level: "unit" | "e2e"
  readonly path: string
  /** Line carries the decompose-placed `(unchanged)` marker. */
  readonly unchanged: boolean
}

// Marker = ` (unchanged)` directly after the closing backtick:
//   - unit: `src/a.test.ts` (unchanged)
// Any other trailing text still parses, with unchanged: false.
const TEST_LINE = /^\s*-\s+(unit|e2e):\s+`([^`]+)`(\s+\(unchanged\))?/

export const declaredTests: (packageText: string) => readonly DeclaredTest[]

/**
 * Unchanged contract: package text read as of `since`, so a builder
 * adding the marker mid-turn gains nothing.
 * Per declared test:
 *   - SATISFIED.md present OR test.unchanged → must exist in the tree
 *   - otherwise → in the diff since `since`, not deleted, exists in the tree
 * Refusal message names which check each missing path failed.
 */
export const requireDeclaredTests: (pkg: string, since: string) => void
```

**Refusal text:** keep the `gtd land: declared-tests:` prefix and the
`  - <path>` list. Split the reason per path, as two groups when both appear:
"not in the package's diff" and "missing from the tree". A marked test that is
missing lands in the second group.

**Prompt changes in `src/workflows/shared/text.ts`:**

- `architectureDecomposePrompt` — the `## Tests` rule gains: **list only tests
  the package writes or changes; never a test it leaves untouched.** If a
  criterion must name an existing test that stays unchanged, write it as
  ``- unit: `<path>` (unchanged)``. Only decompose places the marker
- `packagesItemBuildingPrompt` — the `.gtd/SATISFIED.md` rule widens: write it
  when every criterion **was already met in the tree, or was met by work outside
  the tree** (issues filed, commands run). Evidence per criterion either way:
  commit, file, symbol, issue URL, or command output. For out-of-tree work: do
  the work first, then write the file, and change nothing else in the tree
- `packagesItemBuildingPrompt` — the "every declared test is in your diff" line
  gains: **a line marked `(unchanged)` needs only to exist; leave that file
  alone**

**Untouched, deliberately:**

- The eval grader's parser in `evals/asserts/architecture-decompose.mjs` already
  matches the line prefix, so a marked line still counts as declared
- The build step keeps refusing an empty turn; `.gtd/SATISFIED.md` makes the
  diff non-empty, and `packageItem`'s closing script already removes it

## Call Stacks

- `gtd land` at `packages.item.building` → `packageItem` → `build(pkg)` agent
  turn → `requireDeclaredTests(pkg, from)` → `changesSince(from)` (package text
  as of `from`) → `declaredTests(text)` → per test: `read(path)` (marked, or
  SATISFIED.md present) or `range.get(path)` + `read(path)` (unmarked) →
  `refuse(...)` or return
- `gtd land` at `packages.item.fix.suite.fixing` → `healthy(declared(fixSuite))`
  → same `requireDeclaredTests` path
- `gtd next` at `architecture.decompose.decomposing` →
  `architectureDecomposePrompt()` → prompt content
- `gtd next` at `packages.item.building` → `packagesItemBuildingPrompt(pkg)` →
  prompt content
- `gtd land` at `packages.item.closing` →
  `removeScript([pkg, ".gtd/SATISFIED.md", …])` — unchanged, already drops the
  evidence file

## E2E Scenarios

- e2e: tests/integration/features/declared-tests.feature — a package declaring
  ``- unit: `lib/existing.test.ts` (unchanged)`` whose build turn changes only
  `src/widget.ts` advances to `packages.item.health.check` (covers 1)
- e2e: tests/integration/features/declared-tests.feature — a test marked
  `(unchanged)` that the build turn deletes is refused with `declared-tests` and
  the path (covers 1)
- e2e: tests/integration/features/declared-tests.feature — a builder that adds
  `(unchanged)` to its own `## Tests` line for an unwritten test is still
  refused naming that test (covers 1)
- e2e: tests/integration/features/declared-tests.feature — in one package, an
  unmarked line not written is still refused while its marked sibling passes;
  stderr names only the unmarked path (covers 1)
- e2e: tests/integration/features/default-workflow.feature — a package whose
  only task is out-of-tree (file issues): the build turn writes only
  `.gtd/SATISFIED.md` with issue URLs, lands to `packages.item.health.check`,
  then `packages.item.closing` removes package and SATISFIED.md and the loop
  moves on (covers 2)
- e2e: tests/integration/features/default-workflow.feature — the existing "a
  dead-ended package stalls" scenario stays as is: it is the regression pin that
  a truly empty build turn still stalls, no `allowEmpty` (covers 2)

## Unit Tests

### DeclaredTest / declaredTests

- unit: src/workflows/feature/packages.test.ts — a line ending in
  `` `path` (unchanged)`` parses with `unchanged: true`; plain lines parse with
  `unchanged: false` (covers 1)
- unit: src/workflows/feature/packages.test.ts — trailing text other than the
  exact marker (e.g. `` `path` extra``, `` `path` (unchanged-ish)``) parses with
  `unchanged: false` (covers 1)
- unit: src/workflows/feature/packages.test.ts — the existing malformed-line and
  no-section cases keep their results with the new field added (covers 1)

### requireDeclaredTests

- unit: src/workflows/feature/packages.test.ts — refusal text puts an unmarked
  unwritten test under "not in the package's diff" and a missing marked test
  under "missing from the tree", in one refusal (covers 1)

### architectureDecomposePrompt

- unit: src/workflows/shared/text.test.ts — the prompt forbids listing a test
  the package leaves untouched and names the `(unchanged)` marker form
  (covers 1)

### packagesItemBuildingPrompt

- unit: src/workflows/shared/text.test.ts — the SATISFIED.md rule covers work
  done outside the tree and asks for evidence per criterion, naming issue URLs
  or command output (covers 2)
- unit: src/workflows/shared/text.test.ts — the prompt says an `(unchanged)`
  line needs only to exist and must be left alone (covers 1)

### Chores

- chore: tests/integration/features/declared-tests.feature — update the Feature
  description to name the `(unchanged)` marker (covers 1)

## Merged Concerns

**Concerns 1 and 2 merged into one package: both edit
`packagesItemBuildingPrompt` and both pin through the declared-tests guard and
`.gtd/SATISFIED.md`.** Neither only consumes an interface the other creates.

- Concern 1, verbatim: "Declared-tests guard has a way out for an unchanged test
  (PRODUCT) — A plan that lists an existing, unchanged test under `## Tests`
  dead-ends the build turn today. Fix both ends: the planner stops listing
  unchanged tests, and the package format gains a marker as the backstop.
  Planner rule: decompose never lists a test the package will not change under
  `## Tests`. Marker: a `## Tests` line can mark a test as existing and
  unchanged (e.g. ``- unit: `path` (unchanged)``); for that line the guard
  requires only that the file exists in the tree, not that it is in the diff.
  Every unmarked line keeps today's check: in the package's diff, not deleted,
  present in the tree. The guard must keep reading the package as of the turn
  start — a builder adding the marker to its own `## Tests` must never dodge the
  guard; only decompose can place it. A marked test that is missing from the
  tree still refuses the turn."
- Concern 2, verbatim: "A package that changes no file completes instead of
  stalling (PRODUCT) — A package whose only work is outside the tree (package 03
  of #355 filed issues via `gh`) stalls the build step as an empty attempt. It
  must finish and close out like any other package. Proof of done lives in
  `.gtd/SATISFIED.md`: the builder does the out-of-tree work, then writes that
  file with concrete evidence (issue URLs, command output). The diff is
  non-empty, so the build step lands normally; closing out already removes the
  file, and the evidence stays in history. The build step keeps refusing a
  genuinely empty turn — no `allowEmpty`. The build prompt's `.gtd/SATISFIED.md`
  rule widens from 'every criterion was already met' to also cover 'every
  criterion was met by work outside the tree', with evidence per criterion
  either way. Accepted risk: `.gtd/SATISFIED.md` relaxes the declared-tests
  guard to 'exists in the tree', so a mixed package (out-of-tree work plus
  declared tests) gets the weaker check."

## Answered Questions

### What exact spelling does the marker take?

` (unchanged)` directly after the path's closing backtick, case-sensitive — the
form triage named, and the existing parser already tolerates trailing text, so
old package files parse unchanged.

### Does the builder still need to touch a marked test?

No — a marked line needs only to exist in the tree; the build prompt tells the
builder to leave that file alone.

### Does a builder adding the marker mid-turn need new code to block it?

No — `requireDeclaredTests` already reads the package text as of the turn start;
a new e2e scenario pins that this covers the marker.

### Does the decompose eval grader need to change?

No — its parser matches the line prefix, so a marked line still counts as
declared; the planner rule is pinned by the prompt unit test.

### How does the refusal read when both checks fail in one package?

One refusal, paths grouped by failed check ("not in the package's diff" /
"missing from the tree") — today's single reason would mislabel a missing marked
test.

### Does an out-of-tree package need a new step, kind, or `allowEmpty`?

No — the SATISFIED.md write makes the diff non-empty and closing already removes
it; only the build prompt widens, and the existing stall scenario keeps a truly
empty turn refused.

### Does any user-facing doc change?

No — `docs/` and `README.md` never describe the package file format or
`.gtd/SATISFIED.md`; the prompts are the contract.
