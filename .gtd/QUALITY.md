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

## test-audit: new guard is properly covered; one unit case pins an unreachable path, one e2e duplicates a unit contract

`src/workflows/feature/packages.test.ts`,
`tests/integration/features/declared-tests.feature`.

Checked each new/changed test against "fails with the guarded behaviour
removed":

- "refuses a marked test the build added…" fails without the `addedMarked`
  branch; old code returned `undefined` for `added`. Real coverage
- order case fails if the `addedMarked` group moves. Real coverage
- both dedupe cases ("lists a duplicated … once") fail without `seen`. Real
- "lets an unmarked entry win over a marked one the build added" now actually
  pins the `continue` for mixed entries. Before this change a marked `added`
  returned `undefined`, so that `continue` could not be tested through `added`.
  Real
- e2e "a build that creates a test marked (unchanged) is refused" fails before
  the fix (the file exists, so "existing suffices"). "stop and leave it to a
  person" only reaches stderr from the refusal group, so the assertion is
  specific. Real
- `text.test.ts` checks prompt wording that is part of the contract. Fine

Findings (non-blocking):

1. "does not refuse a marked test a fix turn added" pins a path that cannot
   happen. `packageItem` captures `from` once before the build and rechecks with
   that same `from` after each fix. A marked test absent at `from` either makes
   the build turn refuse (`addedMarked`) or, if the build leaves it out, refuse
   (`notInTree`). So no fix turn ever sees a marked test with status `added`.
   The test does fail without `turn !== "build"`, but it pins a choice nothing
   can reach, and it reads as a supported scenario. Either delete it, or keep it
   and note in its name that it guards the turn split, not a real fix-turn flow.
2. e2e "a build that creates a test listed both unmarked and marked (unchanged)
   passes" tests the same contract as the unit case "lets an unmarked entry win
   over a marked one the build added". It runs on the same in-memory tier with
   no extra transport or lifecycle risk. It is a duplicate owner, so drop one of
   the two (keep the unit case).
3. Feature preamble in `declared-tests.feature` still says a marked line "must
   exist in the tree and stay untouched on the build turn". The new scenario
   adds "and must not be created by it", so align the wording with the README
   and the prompt ("must exist before the turn").

## conventions: dropping `turn`'s default breaks a published export's type

`src/workflows/feature/packages.ts` (`requireDeclaredTests` signature).

Rule (AGENTS.md → COMPATIBILITY.md, "Follows package SemVer"): "Entrypoint
exports — every subpath of the one package, each export's name, type and
behaviour … an incompatible change, shipped as a major". AGENTS.md: "Whether a
change is breaking (`!`) is decided by the tiers in COMPATIBILITY.md."

`requireDeclaredTests` is published via `src/workflows/feature/index.ts`
(`export * from "./packages.js"`) as `@pmelab/gtd/workflows/feature`. Released
v29.1.0 has `(pkg: string, since: string)`. Commit 08eaee96 kept two-arg callers
compiling with `turn: DeclaredTestsTurn = "fix"`; this change makes `turn`
required, so any external `gtd.config.ts` calling it with two args stops
type-checking. That is an incompatible change to an entrypoint export: it needs
`!` / `BREAKING CHANGE` and a major, which the branch's `fix(workflows): …`
commits do not carry. The only in-repo caller (`packageItem`, line ~150) already
passes `kind`, so nothing here needed the default gone.

Fix: restore `turn: DeclaredTestsTurn = "fix"` (the two-arg behaviour then stays
what it was before this branch). Otherwise mark the squash commit breaking per
docs/commits.md.

## conventions: build prompt bullet reads as a comma splice and runs past the wrap

`src/workflows/shared/text.ts` `packagesItemBuildingPrompt`, the `(unchanged)`
bullet. Not an AGENTS.md rule — a nit. "the turn must not create, edit or delete
it, that refuses the turn; if the marker is wrong because the package" is a
comma splice on one ~110-column line while every neighbouring line wraps at ~66.
oxfmt does not reflow template literals, so it stays. Suggest e.g. "which must
exist before the turn and stay untouched — creating, editing or deleting it
refuses the turn; if the marker is wrong…", rewrapped. (Folds in with the
correctness lens's wording fix to the same bullet.)

## spec-challenge: concern 2 ("`turn` is required") conflicts with the entrypoint-export SemVer tier

Decision: REQUIREMENTS concern 2 / ARCHITECTURE "Interfaces" — "`turn` has no
default any more; every caller names it", classed TECHNICAL, shipped under
`fix(workflows):`.

Invariant: COMPATIBILITY.md "Entrypoint exports — … each export's name, type and
behaviour", which lists `@pmelab/gtd/workflows/feature`. `requireDeclaredTests`
is exported there, and released v29.1.0 has `(pkg: string, since: string)`. The
spec reasons only about the in-repo caller ("the only production caller
(`packageItem`) already passes it, so nothing else changes"). It never looks at
external `gtd.config.ts` callers, and those are exactly who the tier protects. A
two-arg call that compiles against v29.1.0 fails type-checking after this
change. So the spec decision is a breaking change that its TECHNICAL
classification and the branch's commit type hide. Same outcome as the
conventions finding, but this traces the cause to the plan, not the code.

Resolve: keep `= "fix"` (concern 2's goal is then met for in-repo callers only,
by review), or keep the decision and mark the squash breaking (`BREAKING CHANGE`
footer; `refactor!`/`fix!` alone cuts no release here).

## spec-challenge: concern 1 says "refused until a human fixes the package", but the guard is built so editing the package cannot change the verdict

Decision: REQUIREMENTS concern 1 — "The turn stays refused until a human fixes
the package". The refusal text, "stop and leave it to a person", rests on that.

Invariant: `requireDeclaredTests` reads the package as of `since`
(`range.get(pkg)?.before`), "so a builder editing its own `## Tests` (or adding
`(unchanged)`) cannot dodge the guard" (its JSDoc, pinned by existing tests in
`packages.test.ts` / `declared-tests.feature`). And `packageItem` captures
`from = head()` once, before the build, then reuses it for every recheck. So a
person who drops the wrong marker mid-item changes nothing. The verdict is fixed
by the package text at `from`. The next build either creates the file
(`addedMarked`) or doesn't (`notInTree`). The fix turns never run because the
build check comes first. The only way out is `gtd abandon`. What the spec
expects to rescue the person, editing the package, is exactly what the
anti-dodge invariant blocks. It never says which actor, or which point in the
process, may fix the marker.

Resolve: say what really happens: a wrong marker means `gtd abandon` and fixing
the plan upstream, in the refusal/prompt/README (this overlaps the correctness
lens's text fix). The other option is a design change: let a human-authored
commit move `from`, or let a human's edit to the package count. Either option
weakens the anti-dodge invariant, so it needs its own decision.
