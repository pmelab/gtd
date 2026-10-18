## correctness: a wrongly placed `(unchanged)` marker is now a dead end every retry hits the same way

`src/workflows/feature/packages.ts` (`diffBucket` → `addedMarked`),
`src/workflows/shared/text.ts` (`packagesItemBuildingPrompt`, `(unchanged)`
bullet), `README.md` step 3.

Traced the retry path for a package whose `## Tests` marks a test `(unchanged)`
that does not exist at `from`:

- build creates it → `addedMarked` refusal ("stop and leave it to a person")
- build does not create it (or deletes it again) → `notInTree` refusal
- a person edits the package to drop the marker → no effect: the guard reads the
  package text as of `from` (`range.get(pkg)?.before`), and `from` is the
  `head()` captured before the build, so it never moves while the package item
  runs
- `.gtd/SATISFIED.md` does not relax a marked line

So every retry refuses, with no in-process way out; the only exit is
`gtd abandon`, discarding the whole process. Before this change the same package
passed (the build wrote the file and "existing suffices"), which is the hole
being closed, so the refusal itself is right — but the hand-off it asks for has
nothing the person can do short of abandoning, and nothing tells them so. The
prompt is also narrower than the guard: it says to stop only when "the package
must change that test", not when a marked test is missing at turn start, so an
agent's first move on a missing marked test is to create it and burn a refused
turn.

Fix (small, text only): in the build prompt's `(unchanged)` bullet, also say to
stop without creating the file when a marked test does not exist yet; and in
README step 3 state that a wrong marker is fixed upstream and a process stuck on
one is ended with `gtd abandon`. (A real in-process escape, e.g. letting a
person's edit to the marker count, is a design change — out of scope here.)

Coverage of the new guard is real: the unit cases "refuses a marked test the
build added…", "does not refuse a marked test a fix turn added", the order case,
and the e2e "a build that creates a test marked (unchanged) is refused" each
fail with the `addedMarked` branch or its `turn !== "build"` check removed. The
`seen` dedupe cases fail without the set. Statuses are only
`added|modified|deleted` (`src/flows/runtime.ts`), so a rename onto a marked
path shows as `added` and is refused too — consistent.
