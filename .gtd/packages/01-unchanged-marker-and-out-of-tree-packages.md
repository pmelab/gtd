# 01 — `(unchanged)` test marker and out-of-tree packages

See `.gtd/ARCHITECTURE.md` (Interfaces, Call Stacks) for the pinned shapes.

## Requirements

**Concern 1 — Declared-tests guard has a way out for an unchanged test.** A plan
that lists an existing, unchanged test under `## Tests` dead-ends the build turn
today. Fix both ends: the planner stops listing unchanged tests, and the package
format gains a marker as the backstop. Planner rule: decompose never lists a
test the package will not change under `## Tests`. Marker: a `## Tests` line can
mark a test as existing and unchanged (``- unit: `path` (unchanged)``); for that
line the guard requires only that the file exists in the tree, not that it is in
the diff. Every unmarked line keeps today's check: in the package's diff, not
deleted, present in the tree. The guard keeps reading the package as of the turn
start — a builder adding the marker to its own `## Tests` must never dodge the
guard; only decompose places it. A marked test missing from the tree still
refuses the turn.

**Concern 2 — A package that changes no file completes instead of stalling.** A
package whose only work is outside the tree (e.g. filing issues via `gh`) stalls
the build step as an empty attempt. It must finish and close out like any other
package. Proof of done lives in `.gtd/SATISFIED.md`: the builder does the
out-of-tree work, then writes that file with concrete evidence (issue URLs,
command output). The diff is non-empty, so the build step lands normally;
closing out already removes the file, and the evidence stays in history. The
build step keeps refusing a genuinely empty turn — no `allowEmpty`. The build
prompt's `.gtd/SATISFIED.md` rule widens from "every criterion was already met"
to also cover "every criterion was met by work outside the tree", with evidence
per criterion either way. Accepted risk: `.gtd/SATISFIED.md` relaxes the
declared-tests guard to "exists in the tree", so a mixed package (out-of-tree
work plus declared tests) gets the weaker check.

## Tasks

### 1. Parse the `(unchanged)` marker

Paths: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`

- [ ] `DeclaredTest` gains `readonly unchanged: boolean`
- [ ] `declaredTests` sets `unchanged: true` only for ` (unchanged)` directly
      after the closing backtick, case-sensitive; any other trailing text
      (`` `path` extra``, `` `path` (unchanged-ish)``) parses with
      `unchanged: false`
- [ ] Existing malformed-line and no-section cases keep their results, now with
      the new field
- [ ] Unit tests for all three cases pass

### 2. Guard honours the marker, groups refusal reasons

Paths: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`

- [ ] `requireDeclaredTests` keeps reading the package text as of `since` — a
      marker added mid-turn changes nothing
- [ ] Per test: `.gtd/SATISFIED.md` present OR `unchanged` → must exist in the
      tree; otherwise → in the diff since `since`, not deleted, exists in the
      tree
- [ ] Refusal keeps the `gtd land: declared-tests:` prefix and `  - <path>`
      lists, grouped under "not in the package's diff" and "missing from the
      tree" (both groups in one refusal when both apply); a missing marked test
      lands in "missing from the tree"
- [ ] Unit test: one refusal with an unmarked unwritten test under the first
      group and a missing marked test under the second

### 3. Prompt changes

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] `architectureDecomposePrompt`'s `## Tests` rule: list only tests the
      package writes or changes, never one it leaves untouched; an existing
      unchanged test a criterion must name is written
      ``- unit: `<path>` (unchanged)``; only decompose places the marker
- [ ] `packagesItemBuildingPrompt`'s `.gtd/SATISFIED.md` rule: write it when
      every criterion was already met in the tree OR met by work outside the
      tree (issues filed, commands run); evidence per criterion either way —
      commit, file, symbol, issue URL, or command output; for out-of-tree work,
      do the work first, then write the file, change nothing else in the tree
- [ ] `packagesItemBuildingPrompt`'s "every declared test is in your diff" line:
      a line marked `(unchanged)` needs only to exist; leave that file alone
- [ ] Unit tests for all three prompt rules pass

### 4. E2E: marker in the declared-tests feature

Paths: `tests/integration/features/declared-tests.feature` (and its step
definitions only if a new generic Given is needed)

- [ ] Feature description names the `(unchanged)` marker (chore)
- [ ] Scenario: package declares ``- unit: `lib/existing.test.ts` (unchanged)``,
      build turn changes only `src/widget.ts` → advances to
      `packages.item.health.check`
- [ ] Scenario: a marked test the build turn deletes → refused with
      `declared-tests` and the path
- [ ] Scenario: builder adds `(unchanged)` to its own `## Tests` line for an
      unwritten test → still refused naming that test
- [ ] Scenario: unmarked unwritten line plus marked sibling in one package →
      refused; stderr names only the unmarked path
- [ ] All scenarios tagged `@inmem`, built from composable Given steps showing
      file content

### 5. E2E: out-of-tree package completes

Paths: `tests/integration/features/default-workflow.feature`

- [ ] Scenario: package whose only task is out-of-tree (file issues); build turn
      writes only `.gtd/SATISFIED.md` with issue URLs → lands to
      `packages.item.health.check`; `packages.item.closing` removes the package
      and `.gtd/SATISFIED.md`; loop moves on
- [ ] Existing "a dead-ended package stalls, then a human's .gtd/SATISFIED.md
      unsticks it" scenario left as is — regression pin that a truly empty build
      turn still stalls (no `allowEmpty`)
- [ ] Scenario tagged `@inmem`

### 6. Leave untouched

- [ ] No change to `evals/asserts/architecture-decompose.mjs` (prefix match
      already counts a marked line)
- [ ] No change to `docs/` or `README.md` (neither describes the package format
      or `.gtd/SATISFIED.md`)
- [ ] Full suite (`npm test`) green

## Tests

- unit: `src/workflows/feature/packages.test.ts`
- unit: `src/workflows/shared/text.test.ts`
- e2e: `tests/integration/features/declared-tests.feature`
- e2e: `tests/integration/features/default-workflow.feature`
