## Concerns

### 1. Declared-tests guard has a way out for an unchanged test (PRODUCT)

**A plan that lists an existing, unchanged test under `## Tests` dead-ends the
build turn today.** Package 01 of #355 listed `src/judges/providers/llm.test.ts`
while saying it "stays green unchanged"; the builder could only pass by writing
a test nobody asked for or misusing `.gtd/SATISFIED.md`.

**Fix both ends: the planner stops listing unchanged tests, and the package
format gains a marker as the backstop.**

- **Planner rule:** decompose never lists a test the package will not change
  under `## Tests`
- **Marker:** a `## Tests` line can mark a test as existing and unchanged (e.g.
  ``- unit: `path` (unchanged)``); for that line the guard requires only that
  the file exists in the tree, not that it is in the diff
- Every unmarked line keeps today's check: in the package's diff, not deleted,
  present in the tree
- **The guard must keep reading the package as of the turn start** — a builder
  adding the marker to its own `## Tests` must never dodge the guard; only
  decompose can place it
- A marked test that is missing from the tree still refuses the turn

### 2. A package that changes no file completes instead of stalling (PRODUCT)

**A package whose only work is outside the tree (package 03 of #355 filed issues
via `gh`) stalls the build step as an empty attempt.** It must finish and close
out like any other package.

**Proof of done lives in `.gtd/SATISFIED.md`: the builder does the out-of-tree
work, then writes that file with concrete evidence (issue URLs, command
output).**

- The diff is non-empty, so the build step lands normally; closing out already
  removes the file, and the evidence stays in history
- **The build step keeps refusing a genuinely empty turn** — no `allowEmpty`
- The build prompt's `.gtd/SATISFIED.md` rule widens from "every criterion was
  already met" to also cover "every criterion was met by work outside the tree",
  with evidence per criterion either way
- **Accepted risk: `.gtd/SATISFIED.md` relaxes the declared-tests guard to
  "exists in the tree", so a mixed package (out-of-tree work plus declared
  tests) gets the weaker check**

## Answered Questions

### Do the deferred review notes in `.gtd/TODO.md` (note-1, note-2, note-3) fold into this work?

No — the human deleted all three sections in the entry commit and replaced them
with the #373 directive; they are dropped, not built.

### Does the fix reach beyond the feature workflow's package loop?

No — the declared-tests guard, `.gtd/SATISFIED.md`, and package building live
only in the feature workflow's package loop; #373 names nothing else.

### How does a package get past the declared-tests guard for a test it lists but never changes?

Both: decompose stops listing unchanged tests, and a decompose-placed marker on
a `## Tests` line lets the guard accept an existing, unchanged test as the
backstop for a planner slip.

### What lets a package that changes no file (e.g. filing issues with `gh`) finish instead of stalling?

An evidence file: the builder does the work, then writes `.gtd/SATISFIED.md`
with concrete evidence such as issue URLs; the diff is non-empty, closing
removes the file, and the build step still refuses genuinely empty turns.
