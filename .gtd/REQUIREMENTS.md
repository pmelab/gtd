## Open Questions

### How does a package get past the declared-tests guard for a test it lists but never changes?

The guard reads the package text as of the turn start and refuses unless every
`## Tests` path is in the package's diff. `.gtd/SATISFIED.md` already relaxes
this to "exists in the tree", but only by claiming every criterion is met. The
fork: stop the plan from listing such tests, give the package format a
sanctioned marker, or both.

- [ ] Planner rule only: decompose never lists an unchanged test under
      `## Tests`
  - prompt change only; guard and package format stay as they are
  - a planner slip still dead-ends the build turn exactly as in #373
- [ ] Marker only: a `## Tests` line can mark a test as existing (e.g.
      ``- unit: `path` (unchanged)``), and the guard then requires only that it
      exists
  - sanctioned out that survives a planner slip
  - marker must come from decompose; the builder still cannot edit its way past
    the guard
  - planner keeps listing unchanged tests, so packages carry more lines the
    build ignores
- [x] Both: planner rule first, marker as the backstop
  - largest change: prompt, package grammar, guard
  - no dead end either way
- [ ] _your answer_

### What lets a package that changes no file (e.g. filing issues with `gh`) finish instead of stalling?

Today its build turn lands an empty attempt and the step stalls ("another
dispatch would repeat it"). The fork is where the proof of done lives: nowhere,
in an evidence file, or the plan never produces such packages.

- [ ] `allowEmpty` on the build step: an empty build turn completes, the package
      closes
  - smallest change; no trail of what the turn did
  - **risk: any package declaring no tests (chore packages) passes a do-nothing
    turn silently**
- [x] Evidence file: the builder does the work, then writes `.gtd/SATISFIED.md`
      with concrete evidence (issue URLs) — the diff is non-empty, closing
      removes the file
  - no engine change; build step keeps refusing genuinely empty turns
  - evidence lands in history
  - **risk: `.gtd/SATISFIED.md` also relaxes the declared-tests guard to
    "exists", so a mixed package with tests gets the weaker check**
- [ ] Planner forbids tree-less packages: decompose folds such work into a slice
      that changes files, or leaves it out of gtd
  - nothing in the engine changes
  - work like filing follow-up issues is no longer something gtd builds
- [ ] _your answer_

## Concerns

### 1. Declared-tests guard has a way out for an unchanged test (PRODUCT)

**A plan that lists an existing, unchanged test under `## Tests` dead-ends the
build turn today.** Package 01 of #355 listed `src/judges/providers/llm.test.ts`
while saying it "stays green unchanged"; the builder could only pass by writing
a test nobody asked for or misusing `.gtd/SATISFIED.md`. **The guard must keep
reading the package as of the turn start** — a builder editing its own
`## Tests` must never dodge it. The fix shape waits on the first open question.

### 2. A package that changes no file completes instead of stalling (PRODUCT)

**A package whose only work is outside the tree (package 03 of #355 filed issues
via `gh`) stalls the build step as an empty attempt.** It must finish and close
out like any other package. The mechanism waits on the second open question.

## Answered Questions

### Do the deferred review notes in `.gtd/TODO.md` (note-1, note-2, note-3) fold into this work?

No — the human deleted all three sections in the entry commit and replaced them
with the #373 directive; they are dropped, not built.

### Does the fix reach beyond the feature workflow's package loop?

No — the declared-tests guard, `.gtd/SATISFIED.md`, and package building live
only in the feature workflow's package loop; #373 names nothing else.
