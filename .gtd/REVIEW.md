# Review: 96c2129

<!-- base: 0cd86a2c245c8a0ea2446eca85f7ee2df1831eb1 -->

## Scenarios

- [ ] ./src/workflows/feature/refactor-review.feature#16-93 — Weakened: lost
      `Then driving the process is refused with "refactor-tests"`; the scenario
      (renamed from "…a test-named stray changed by the refactor is refused")
      now pins a refusal by the write access instead, because a test-file stray
      is no longer in it. No `.gtd/REQUIREMENTS.md` exists on this branch, so
      nothing asked to keep the `refactor-tests` line.
- [ ] ./tests/integration/features/refactor-package.feature#377-412 — Weakened:
      the old scenario "a build turn changing a test file is refused even when
      the test file is a stray" is gone, renamed "…even when the shape named it
      a stray". Its lost line: `And stderr contains "refactor-tests"`, now
      `"outside its write access"`. `Then it fails`,
      `stderr contains "src/a.test.ts"` and the last-commit-subject check
      survive under the new name. No `.gtd/REQUIREMENTS.md` asked for them.
- [ ] ./src/workflows/feature/refactor-review.feature#314-465 — the refactor
      review prompt says "the whole refactor since it started" on its second
      round too. The feature review after feature feedback says "only what is
      new since the previous review".
- [ ] ./src/workflows/feature/refactor-review.feature#593-619 — a refactor
      review round with a hand-edit plus a line note rests at a closed
      collecting turn. That turn folds both and carries no footnote-reply or
      code-thread-reply rules.
- [ ] ./src/workflows/feature/refactor-review.feature#897-967 — a change note
      left in a round that thread replies alone then settled is still judged. An
      `edit` verdict the collecting turn does not fold refuses the landing,
      naming `note-1` and `gtd abandon`.
- [ ] ./src/workflows/feature/refactor-review.feature#968-1039 — a code
      hand-edit made before a thread-only settled round refuses, naming
      `hand-edited src/calc.ts`.
- [ ] ./src/workflows/feature/refactor-review.feature#1040-1128 — a praise note
      plus a concluded thread on a settled round signs off, and the feature
      slice follows.
- [ ] ./src/workflows/feature/refactor-review.feature#1593-1609 — a test-file
      stray is left out of the derived `.gtd/REFACTOR.md`; the non-test stray
      stays.
- [ ] ./src/workflows/feature/refactor-review.feature#1610-1619 — a
      `refactor-first` verdict whose strays are all test files skips the
      refactor and rests at `implement.building` with no `.gtd/REFACTOR.md`.
- [ ] ./src/workflows/feature/refactor-review.feature#1620-1706 — collected
      review headings re-derive with the shallowest at `###`. `#####` would land
      past `######`, so it is capped at `######`.

## Test-file strays never enter the refactor

The judge can list a test file as a stray. The refactor now drops it from the
package, scope, write access and collecting fence. A `refactor-first` whose
strays are all test files skips the refactor slice and goes to implement. **Side
effect: `refactor-tests` is now unreachable from a real landing.** The
write-access check fires first, with "outside its write access".

- [ ] ./src/workflows/feature/refactor.ts#44-52 — `isTestFile` extracted from
      `requireNoTestFiles`; same fixed glob list, `seamAllow` still ignored.
- [ ] ./src/workflows/feature/refactor.ts#116-119 — `refactorStrays` filters
      test files out of `shape.strays`.
- [ ] ./src/workflows/feature/refactor.ts#181-182 — `plan` uses the filtered
      strays and returns `undefined` (no step, no scope) when none remain.
- [ ] ./src/workflows/feature/refactor.ts#198-201 — guard order flipped to run
      `requireNoTestFiles` before `requireWithin`. **It only matters in the unit
      harness:** at a real land the scope's write access refuses the test file
      first (see the two `Weakened:` scenarios).
- [ ] ./src/workflows/feature/seam.ts#19-19 — imports `refactorStrays`.
- [ ] ./src/workflows/feature/seam.ts#122-122 — `seamBuild` returns the caller's
      base with no slice when every stray is a test file. The unreadable-stray
      `seam.by-hand` check still runs first.
- [ ] ./docs/configuration.md#584-592 — `refactorFirst` docs: test files are
      dropped from the strays, and an all-test `refactor-first` resolves
      `false`.
- [ ] ./docs/configuration.md#622-626 — Risk: the bullet still says a changed
      test file is refused as `refactor-tests`, but no real landing can reach it
      now. A test file is never in the refactor's write access, so the person
      sees "this turn wrote outside its write access" (the reworded e2e
      scenarios prove it). Either say the write access refuses it, or drop the
      `refactor-tests` code from the docs.
- [ ] ./src/workflows/feature/refactor.test.ts#134-146 — `refactorStrays` unit
      test under a narrowed `seamAllow`.
- [ ] ./src/workflows/feature/refactor.test.ts#349-364 — all-test strays run no
      step and no scope; mixed strays keep only `src/a.ts` in the package and
      the access.
- [ ] ./src/workflows/feature/refactor.test.ts#443-443 — the guard test now uses
      a mixed stray list, so a plan still exists.
- [ ] ./src/workflows/feature/refactor.test.ts#729-750 — `reviewedRefactor`
      drops test strays from scope, access and the collecting prompt; all-test
      resolves `false`.
- [ ] ./src/workflows/feature/refactor.test.ts#958-978 — nit-fix and fix-check
      fixtures switched to mixed strays; the expected write access loses
      `src/a.test.ts`.
- [ ] ./src/workflows/feature/seam.test.ts#115-134 — `driveSeam` takes extra
      vars.
- [ ] ./src/workflows/feature/seam.test.ts#190-209 — all-test strays: no slice,
      no by-hand. An unreadable test stray still rests at `seam.by-hand`.

## Settled refactor rounds still collect earlier change requests

Before, when only thread replies landed after the in-gate reply turn, the round
signed off unjudged. That silently dropped a change note or hand-edit the human
left earlier in the round. Now, when the policy has a `dropped` refusal (only
the refactor review does), such a round is "reopened". Its notes since
`reviewed` get triaged, its hand-edits collected over a
`git diff reviewed..round` range, and anything unfolded refuses.

- [ ] ./src/workflow-kit/review.ts#33-34 — new `CollectRound` type: `reply`,
      `edits`, `notes`, `triaged`.
- [ ] ./src/workflow-kit/review.ts#62-74 — `collecting` receives the round, and
      `captures.edits` takes an optional `from` for a multi-commit range.
- [ ] ./src/workflow-kit/review.ts#98-101 — `collect` passes the round through.
- [ ] ./src/workflow-kit/review.ts#159-159 — the in-gate turn is tagged `reply`.
- [ ] ./src/workflow-kit/review.ts#204-204 — the edit-notes collect is tagged
      `triaged`.
- [ ] ./src/workflow-kit/review.ts#252-272 — `finishNotes`, `toOutcome` and
      `isReopened` extracted. **`isReopened` keys routing on whether a refusal
      message exists** (`p.refusals.dropped !== undefined`). That is an implicit
      policy flag. Consider an explicit policy field.
- [ ] ./src/workflow-kit/review.ts#274-315 — `finish` reworked. A reopened round
      skips the settled early return, collects hand-edits as `edits` with
      `from = reviewed`, and routes notes. With no notes it signs off via
      `unfolded`, never via a notes collect.
- [ ] ./src/workflows/shared/text.ts#709-722 — `reviewEditsCapture` names
      `git diff <from> <commit>` when the hand-edits predate the round commit.
- [ ] ./src/workflow-kit/review.test.ts#9-21 — the mock's `changesSince` returns
      `sinceAfter` for `h2`, which simulates a settled round.
- [ ] ./src/workflow-kit/review.test.ts#94-95 — resets `sinceAfter` and `head`.
- [ ] ./src/workflow-kit/review.test.ts#174-249 — `driveRound` records rounds,
      captures and edit ranges, and gains `settled`/`noDropped` options.
- [ ] ./src/workflow-kit/review.test.ts#289-299 — the `notes` vs `triaged` round
      tags.
- [ ] ./src/workflow-kit/review.test.ts#322-414 — settled-round cases: edit note
      refuses, hand-edit refuses with range `h1`, nit fixes silently, folded
      becomes feedback, praise signs off, thread-only signs off untriaged, and
      no `dropped` keeps the old unjudged sign-off.
- [ ] ./src/testkit/steps.ts#149-158 — new Given
      `step {string} rewrites {string} with:`. It writes only while the file
      exists, so a closed turn changes nothing.
- [ ] ./docs/configuration.md#701-704 — documents the settled-round refusal.

## The closed refactor collecting prompt is chosen by round, not by file presence

The open/closed variant used to depend on whether `.gtd/REVIEW.md` was in the
tree. At the closed round that file is still present (it closes after the
capture), so the open variant leaked. Now the round decides, and each closed
round has its own fold rule with no reply rules.

- [ ] ./src/workflows/feature/steps.ts#1-2 — drops the `read` import and takes
      `CollectRound`.
- [ ] ./src/workflows/feature/steps.ts#114-121 — `refactorCollecting` takes
      `round` and passes it into the prompt.
- [ ] ./src/workflows/feature/refactor.ts#269-269 — the feedback target passes
      the round through.
- [ ] ./src/workflows/feature/review.ts#252-252 — `FeedbackTarget.collecting`
      signature gains the round.
- [ ] ./src/workflows/shared/prose.ts#251-257 — splits `footnoteAnchor` (the
      fold-against-anchor rule) out of `footnoteFoldIn`, so the closed variant
      can keep it without the reply/delete rule.
- [ ] ./src/workflows/shared/text.ts#16-34 — imports.
- [ ] ./src/workflows/shared/text.ts#878-889 — `closedFold`: `edits` folds every
      hand-edit and note, `notes` folds change-asking notes, `triaged` folds
      listed `edit` notes plus hand-edits.
- [ ] ./src/workflows/shared/text.ts#895-897 — `open: boolean` replaced by
      `round`.
- [ ] ./src/workflows/shared/text.ts#961-978 — closed rounds render
      `footnoteAnchor` only, with no `codeThreadReplies`; the reply round and
      the feature prompt keep both.
- [ ] ./docs/configuration.md#602-607 — documents what the closed turn folds.
- [ ] ./src/workflows/shared/text.test.ts#959-985 — the existing closed test now
      asserts that the `- A:` reply rules are gone.
- [ ] ./src/workflows/shared/text.test.ts#1020-1079 — per-round fold wording,
      reply rules absent on every closed round, kept on the reply round and the
      feature prompt.
- [ ] ./src/workflows/feature/steps.test.ts#59-66 — the variant follows the
      round, whatever `.gtd/REVIEW.md` holds.
- [ ] ./src/workflows/feature/refactor.test.ts#920-932 — a closed round with the
      review file still present renders the closed variant.

## Reviewer prompt states its range per lap

The reviewing prompt used to hedge "on a feedback round … only what's new" on
every lap. The caller now passes a `ReviewRange`. `first` means everything since
base, `feedback` means only what is new, and `refactor` means the whole refactor
on every round.

- [ ] ./src/workflows/shared/text.ts#1022-1034 — `ReviewRange` and its wording
      table; a required `lap` parameter.
- [ ] ./src/workflows/shared/text.ts#1082-1082 — the range sentence comes from
      the table.
- [ ] ./src/workflows/shared/steps.ts#94-101 — `reviewing` takes `lap`, default
      `first`.
- [ ] ./src/workflows/shared/tail.ts#120-120 — hand-off review wraps `reviewing`
      so `guarded` cannot pass a third argument as `lap`. Hand-off always
      reviews from a fixed base, so `first` is correct.
- [ ] ./src/workflows/feature/review.ts#191-191 — `review` forwards
      `options.lap`.
- [ ] ./src/workflows/feature/review.ts#272-273 — `BuildTailOptions.lap`.
- [ ] ./src/workflows/feature/feature.ts#30-46 — `planAndBuild` takes
      `firstLap`; after a feedback round it switches to `feedback`.
      `naivePlanAndBuild` ignores `firstLap`, which is safe because the naive
      feedback path goes through `featureFeedback`.
- [ ] ./src/workflows/feature/feature.ts#72-75 — the naive feature feedback lap
      passes `lap: "feedback"`.
- [ ] ./src/workflows/feature/feature.ts#84-84 — `afterTail` re-enters
      `planAndBuild` as `feedback`.
- [ ] ./src/workflows/feature/refactor.ts#286-286 — the refactor tail passes
      `lap: "refactor"`.
- [ ] ./src/workflows/shared/text.test.ts#734-856 — existing call sites pass
      `"first"`.
- [ ] ./src/workflows/shared/text.test.ts#1127-1144 — each lap renders only its
      own wording.
- [ ] ./src/testkit/index.ts#1-1 — exports `Actor` for the feature test.
- [ ] ./src/workflows/feature/feature.test.ts#2-2 — imports `Actor`.
- [ ] ./src/workflows/feature/feature.test.ts#138-155 — captures reviewing
      prompts.
- [ ] ./src/workflows/feature/feature.test.ts#196-230 — under both naive-pass
      flag states, first review says everything, the post-feedback review says
      only what is new. The test drives the process with a `Proxy` actor table
      and 80 beats.
- [ ] ./src/workflows/feature/refactor.test.ts#1043-1056 — both refactor review
      rounds say the whole refactor.

## Demoted collected headings cap at `######`

The shift used to be `max(1, 3 - shallowest)` prepended to the line, which could
produce `#######` and never raised a deep heading. Now the shallowest always
lands at `###`, which can raise a level, and deeper levels cap at `######`.
**The cap merges levels: `#####` and `######` under a `#` top both become
`######`.**

- [ ] ./src/workflows/feature/refactor.ts#156-164 — rebuilds each heading's
      hashes from its depth plus the shift, capped at 6.
- [ ] ./src/workflows/feature/refactor.test.ts#870-883 — `# Top` goes to `###`,
      `##### Deep` to `######`, and fenced or inline `#` stays untouched.

## Version wording in the upgrade notes

- [ ] ./README.md#578-580 — "28.x" becomes "27.5.0 or later" for the
      `refactor-first` abandon note.
- [ ] ./docs/configuration.md#713-713 — same correction in the upgrade
      migration.
