# Review: ca35920

<!-- base: e8b71ede7b061be6aa4b8a0ef5c902b978de8ca4 -->

Implements gtd#381: with `GTD_FLAG_NAIVE_PASS=1` a `refactor-first` verdict now
runs a `refactor` slice (refactor, its own quality lap, its own review) before a
`feature` slice. `seam.approve` is gone. The default path is unchanged. Workflow
unit and feature tests pass locally (`vitest run src/workflows`: 494 tests).

**The tail-guard risk is fixed**: the refactor's review tail no longer guards
its human escalation rests (`guardRests: false`). A new unit test pins it, and
fails when the flag is flipped back (checked by mutation).

**The README risk is fixed**, but **docs/configuration.md still says feedback at
any review re-runs design**, which is wrong for the refactor review.

## Scenarios

- [ ] ./src/workflows/feature/refactor-first.feature#41-167 — Weakened: renamed
      from "runs approval, refactor, implement and review to idle". Lost lines:
      `rests at "seam.approve"`,
      `resting step's content contains "src/calc.ts"`, the
      `seam.judge → seam.approve` judge-body assertion and the
      `Gtd-Approved: {"step":"seam.approve#1",…}` trailer assertion.
      REQUIREMENTS §1 and §6 asked for all of them to go (`seam.approve`
      removed, no `Gtd-Approved:`). The other listed lines (`refactor.building`,
      `REFACTOR.md` contains/absent, `implement.building`, `op(a, b, 1)`,
      `await-review`, `idle`, `subtract`, the `Gtd-Var`/`Gtd-Kept` bodies, no
      `Gtd-Workflow:`) are still there under the new name. Now pins: the judge
      goes straight to `refactor.deriving`, the refactor rests at
      `refactor.build.review.await-review`, its sign-off leads to
      `implement.building`, no commit carries `Gtd-Approved:`, and `gtd slices`
      lists `refactor` then `feature`
- [ ] ./src/workflows/feature/seam.feature#225-319 — Weakened: renamed from
      "review feedback re-runs design and the whole seam phase". The three
      `rests at` lines are kept. The `commit subjects end with` block lost
      `design.gate.answer → seam.naive`, `seam.naive → seam.judge` and
      `seam.judge → implement.building`. REQUIREMENTS §3 asked for this change
      (no naive pass or judge after judging). Now pins: feedback after a `land`
      verdict goes re-unwind → design → `implement.building` and never reaches
      `seam.*`
- [ ] ./src/workflows/feature/one-step-land.feature#108-111 — a `land` verdict
      records only the `feature` slice
- [ ] ./src/workflows/feature/seam-rejection.feature#146-149 — overruling at
      `seam.steer` records only the `feature` slice
- [ ] ./tests/integration/features/default-workflow.feature#253-257 — the
      default path still records one implicit `main` slice, no `feature` or
      `refactor`
- [ ] ./tests/integration/features/refactor-package.feature#377-412 — a
      `refactorFirst` build turn that changes a test file is refused with
      `refactor-tests`, even when that file is a stray
- [ ] ./src/workflows/feature/refactor-review.feature#16-93 — with `seamAllow`
      narrowed to `docs/**`, a test file becomes a stray, and a refactor build
      turn changing it is still refused (`refactor-tests`)
- [ ] ./src/workflows/feature/refactor-review.feature#96-171 —
      `refactorQualityReviews=correctness` runs only
      `refactor.build.quality.correctness`, and `qualityReviews=owasp-security`
      does not reach the refactor lap
- [ ] ./src/workflows/feature/refactor-review.feature#241-312 — an edit note at
      the refactor review is collected into `.gtd/REFACTOR.md`, then the flow
      goes re-unwind → deriving (with `Review feedback`) → building → review
      again, never `design.triage`
- [ ] ./src/workflows/feature/refactor-review.feature#314-348 — a human code
      edit at the refactor review is reverted by `refactor.re-unwind` before the
      refactor is rebuilt
- [ ] ./src/workflows/feature/refactor-review.feature#350-386 — the feature
      review's base is the refactor sign-off commit
      (`refactor.build.review.closing → implement.building`)
- [ ] ./src/workflows/feature/refactor-review.feature#388-488 — feature feedback
      after `refactor-first` goes re-unwind → design → `implement.building`, and
      never back to the seam
- [ ] ./src/workflows/feature/refactor-review.feature#490-517 — a refactor nit
      fix writing a non-stray is refused (`refactor-scope`), even though a
      glob-named stray `src/*.ts` widens write access
- [ ] ./src/workflows/feature/refactor-review.feature#519-526 — a blank
      `refactorQualityReviews` runs no refactor lens turn. FYI: scenarios at 16
      and 96 repeat the Rule's Background setup almost word for word, and the
      file has stray double blank lines (81-82, 94-95, 161-162, 172-173)

## Naive path: refactor and feature slices

`planAndBuild` now hands the naive path to its own function. Design and the seam
phase run once. Implement and the feature review loop sit inside
`slice("feature")`. `seamBuild` runs `reviewedRefactor` inside
`slice("refactor")` and returns the feature review's base.

- [ ] ./src/workflows/feature/feature.ts#1-11 — imports trimmed; `reUnwind` and
      `implement` come from their new homes
- [ ] ./src/workflows/feature/feature.ts#27-27 — re-exports `reUnwind`, which
      moved to `review.ts`, so the public surface stays the same
- [ ] ./src/workflows/feature/feature.ts#29-43 — the default path loop now has
      no naive branch; the flag check comes first and returns early
- [ ] ./src/workflows/feature/feature.ts#45-62 — new naive loop: design, risk
      tier, `seamBuild`, then `slice("feature")` holding implement plus the
      review loop. Feedback runs re-unwind → design → implement with no
      reference (`undefined`). The first review uses `seam.base`; later ones use
      `outcome.base`
- [ ] ./src/workflows/feature/seam.ts#1-19 — imports: `seamGate` out; `slice`,
      `head` and `reviewedRefactor` in
- [ ] ./src/workflows/feature/seam.ts#44-44 — `implement` takes an optional
      reference so a re-plan lap carries no `git show` line
- [ ] ./src/workflows/feature/seam.ts#75-79 — `seamGate("approve")` removed;
      `refactor-first` returns straight to the build
- [ ] ./src/workflows/feature/seam.ts#98-120 — `seamBuild` returns
      `{ reference, base }`. `land`/overrule and unreadable strays
      (`seam.by-hand`) keep the caller's base and get no refactor slice.
      `refactor-first` runs the reviewed refactor in `slice("refactor")` and
      returns `head()` as the feature base

## Refactor review and its feedback loop

The refactor gets the full review tail, scoped under `refactor` so the steps are
`refactor.build.*`. Review feedback is collected into `.gtd/REFACTOR.md` and
added to the re-derived package under `## Review feedback`. It never re-plans.

- [ ] ./src/workflows/feature/refactor.ts#1-23 — imports; `REFACTOR_PACKAGE` now
      aliases the shared `REFACTOR` constant
- [ ] ./src/workflows/feature/refactor.ts#145-209 — `plan` pulls out the shape
      check and the pattern check; `guardOf` builds the scope + flags + tests
      guard; `refactorLap` is the old body with an optional feedback section in
      the package and the building prompt
- [ ] ./src/workflows/feature/refactor.ts#211-221 — `refactorFirst` is now
      `plan` + one lap; its behaviour is unchanged apart from the new test-file
      guard
- [ ] ./src/workflows/feature/refactor.ts#223-262 — `reviewedRefactor`: one
      `refactor` scope, a lap, then `buildTail` with the guard, the refactor
      lenses and the `REFACTOR.md` feedback target; feedback re-unwinds and runs
      another lap carrying the collected notes. Fix: the tail now gets
      `guardRests: false`, so the human rests
      `refactor.build.health.stop`/`exhausted` and
      `refactor.build.review.health.stop`/`exhausted` are unguarded, as in the
      lap. The doc comment now says every round reviews from `entry` on purpose.
      A missing `REFACTOR.md` after feedback now throws instead of becoming an
      empty feedback section; the kit only returns `feedback` once that file
      exists, so the throw guards an invariant, not a user path
- [ ] ./src/workflows/feature/steps.ts#1-12 — imports `REFACTOR`
- [ ] ./src/workflows/feature/steps.ts#103-112 — `refactorCollecting`: the
      `review.collecting` turn for the refactor, which writes `.gtd/REFACTOR.md`
- [ ] ./src/workflows/shared/text.ts#462-472 — the building prompt gets an "act
      on the `## Review feedback` section" line on feedback laps only
- [ ] ./src/workflows/shared/text.ts#868-919 — new collecting prompt: folds
      concerns into `.gtd/REFACTOR.md`, lists the strays, and refuses to fold a
      concern needing a non-stray, a test file, a flag read or a behaviour
      change (answer: `gtd abandon`)
- [ ] ./src/workflows/shared/steps.ts#15-15 — new `REFACTOR` path constant

## Review tail: guard, lenses, feedback target

`buildTail`/`review` take options so the same tail can serve the refactor: a
guard run after each turn that changes code, whether that guard also covers the
human escalation rests, a list of lenses that overrides the setting, and a
feedback file with its own collecting turn and refusal text.

- [ ] ./src/workflows/feature/review.ts#1-16 — imports for the moved `reUnwind`
      and `guarded`
- [ ] ./src/workflows/feature/review.ts#168-246 — `review` takes the options:
      the feedback target defaults to `REQUIREMENTS.md` with the old refusal
      text; `fixRisks`, `fixNits` and `keepGreen` are guarded. Fix: `keepGreen`
      now also passes `guardRests`
- [ ] ./src/workflows/feature/review.ts#248-280 — `FeedbackTarget`,
      `BuildTailOptions` (new `guardRests` field); `buildTail` passes guard,
      lenses and `guardRests` into `tail`
- [ ] ./src/workflows/feature/review.ts#282-297 — `reUnwind` moved here from
      `feature.ts`, unchanged, so the refactor scope can use it without an
      import cycle
- [ ] ./src/workflows/shared/health.ts#41-48 — fix: `guardedSteps` takes `rests`
      (default `true`); `false` drops the guard from `stop` and `exhausted`,
      while `describe` stays guarded
- [ ] ./src/workflows/shared/health.ts#53-57 — fix: `escalation` takes
      `guardRests`, default `true`, so the feature tail keeps its old behaviour
- [ ] ./src/workflows/shared/health.ts#106-107 — fix: `HealthOptions.guardRests`
- [ ] ./src/workflows/shared/health.ts#131-131 — fix: `healthy` passes it on
- [ ] ./src/workflows/shared/tail.ts#32-52 — `qualityLap` takes a lenses
      override and still falls back to `qualityReviews`; fix:
      `fixQualityFindings` passes `guardRests` to its escalation
- [ ] ./src/workflows/shared/tail.ts#75-101 — `tail` passes `lenses` through;
      fix: every `healthy` call and the quality-fix escalation get `guardRests`.
      Consider: `tail` now takes six positional parameters (`guard`, `lenses`,
      `guardRests` all optional); an options object like `BuildTailOptions`
      would read better

## No test file touched by a refactor

The refactor guard now refuses any changed path that matches a fixed list of
test globs, strays included. That list also builds `seamAllow`'s default, so the
two stay in step.

- [ ] ./src/workflows/feature/refactor.ts#42-52 — `requireNoTestFiles`: refuses
      with `refactor-tests` and lists each path. It uses the fixed list on
      purpose, so narrowing `seamAllow` cannot let a test through
- [ ] ./src/workflows/feature/refactor.ts#129-129 — the package rule becomes
      "never a test file"
- [ ] ./src/workflows/shared/text.ts#451-453 — prompt rules drop the stray
      exception; stray paths now go through `displayPath`
- [ ] ./src/workflows/shared/vars.ts#7-15 — `testFileGlobs` exported
- [ ] ./src/workflows/shared/vars.ts#27-27 — `seamAllow` is now built from
      `testFileGlobs` (pinned to the same string by options.test.ts)

## `refactorQualityReviews` setting and the `refactor.build.*` scopes

- [ ] ./src/workflows/shared/vars.ts#36-36 — default
      `correctness, ponytail-review, conventions`
- [ ] ./src/workflows/shared/options.ts#22-22 — accepted as a factory option
- [ ] ./src/workflows/shared/skills.ts#12-54 — the `build.*` lists are copied to
      `refactor.build.*`, plus one `refactor.build.quality.<lens>` per refactor
      lens. `refactor` keeps `ponytail` for the refactor's own turns
- [ ] ./src/workflows/shared/access.ts#21-29 — `refactor.build.review` limits
      writes to `REVIEW.md`, defer to `TODO.md`, the fixes reopen to the
      `refactor` scope's access, and refactor lens scopes write nothing

## implement prompt without a reference

- [ ] ./src/workflows/shared/text.ts#1202-1221 — the `git show` "Reference only"
      bullet appears only when a reference is given (the first lap, not re-plan
      laps)

## Testkit steps

- [ ] ./src/testkit/TestRepo.ts#75-76 — `hashes()`: every commit's full hash,
      oldest first
- [ ] ./src/testkit/TestRepo.ts#291-291 — its implementation
- [ ] ./src/testkit/steps.ts#214-223 — step: the resting content contains the
      hash of the last commit with a given subject
- [ ] ./src/testkit/steps.ts#264-272 — step: `gtd <cmd>` output lines start with
      the listed prefixes, one for one and in order

## Unit tests

- [ ] ./src/workflows/feature/feature.test.ts#33-123 — naive path after `land`:
      feedback goes to design and then implement, with no `seam.` subject after
      re-unwind
- [ ] ./src/workflows/feature/refactor.test.ts#10-18 — imports
- [ ] ./src/workflows/feature/refactor.test.ts#74-132 — recording-context
      helpers extended for the tail
- [ ] ./src/workflows/feature/refactor.test.ts#309-309 — helper tweak
- [ ] ./src/workflows/feature/refactor.test.ts#411-425 — the test-file refusal
      and the "never a test file" package rule
- [ ] ./src/workflows/feature/refactor.test.ts#550-801 — `reviewedRefactor`:
      tail step names, review base, lenses, the feedback lap (collect,
      re-unwind, re-derive with `## Review feedback`), and the guard after
      quality-fix, nit-fix and fix-check turns
- [ ] ./src/workflows/feature/refactor.test.ts#803-821 — fix: a person's
      test-file edit at `refactor.build.health.stop` is not refused, and the
      tail's `health.describe` turn outside the strays still is. Flipping
      `guardRests` back to `true` reds the first case. Gap: no case covers
      `refactor.build.review.health.stop` or either `exhausted` rest; dropping
      `guardRests` from `review`'s `keepGreen` would stay green
- [ ] ./src/workflows/feature/review.test.ts#8-14 — imports
- [ ] ./src/workflows/feature/review.test.ts#50-57 — helper widened
- [ ] ./src/workflows/feature/review.test.ts#80-83 — helper widened
- [ ] ./src/workflows/feature/review.test.ts#130-130 — helper tweak
- [ ] ./src/workflows/feature/review.test.ts#148-151 — helper tweak
- [ ] ./src/workflows/feature/review.test.ts#220-342 — guard after the risk and
      nit fixes, the feedback-target default and override, the `unmatched`
      refusal, and `reUnwind` in the caller's scope
- [ ] ./src/workflows/feature/seam.test.ts#11-11 — import
- [ ] ./src/workflows/feature/seam.test.ts#89-232 — `seamBuild` slice behaviour
      for each verdict, and `implement` with and without a reference
- [ ] ./src/workflows/shared/tail.test.ts#9-9 — import
- [ ] ./src/workflows/shared/tail.test.ts#209-261 — lens override, empty list,
      and `tail` passing lenses and a guard
- [ ] ./src/workflows/shared/text.test.ts#23-25 — imports
- [ ] ./src/workflows/shared/text.test.ts#857-864 — implement prompt without a
      reference
- [ ] ./src/workflows/shared/text.test.ts#893-940 — refactor building, fix and
      collecting prompt rules
- [ ] ./src/workflows/shared/access.test.ts#25-31 — new access keys
- [ ] ./src/workflows/shared/access.test.ts#44-59 — one refactor lens scope per
      `refactorQualityReviews` entry
- [ ] ./src/workflows/shared/access.test.ts#62-66 —
      `refactor.build.review.defer` is a script scope
- [ ] ./src/workflows/shared/options.test.ts#59-76 — `seamAllow`'s default is
      byte-for-byte the same; the `refactorQualityReviews` default and override
- [ ] ./src/workflows/shared/skills.test.ts#42-50 — new skill keys
- [ ] ./src/workflows/shared/skills.test.ts#62-62 — `seam.approve` dropped from
      the list of keys with no skills
- [ ] ./src/workflows/shared/skills.test.ts#95-105 — refactor lens keys follow
      the setting, none when blank

## Docs

- [ ] ./README.md#571-576 — fix: feedback at the feature review re-runs design
      and the implementation; feedback at the refactor review re-runs the
      refactor, never design
- [ ] ./README.md#661-663 — `seamGate` is still described; the note says the
      shipped flow does not use it
- [ ] ./SDLC.md#40-47 — gate counts: naive path 2, or 3 on `refactor-first`
- [ ] ./SDLC.md#52-58 — gate table: the `seam.approve` row is replaced by
      "refactor review sign-off"
- [ ] ./SDLC.md#87-90 — fixture list adds `refactor-review.feature`
- [ ] ./SDLC.md#109-112 — "What stops a landing": two reviews split the diff;
      `refactor-tests`
- [ ] ./docs/configuration.md#592-597 — `refactorFirst` vs `reviewedRefactor`
      (both public exports of `@pmelab/gtd/workflows`)
- [ ] ./docs/configuration.md#612-619 — the `refactor-tests` refusal and its
      fixed glob list; the `refactor-scope` label
- [ ] ./docs/configuration.md#625-631 — fix: the review tail's human rests are
      listed as never guarded too. Nit: `refactor.build.health.*` and
      `refactor.build.review.health.*` also match the `describe` turn, which
      stays guarded; name `stop` and `exhausted`
- [ ] ./docs/configuration.md#652-680 — Risk: "Feedback at a review, whatever
      the verdict, re-runs design and `implement.*`" (lines 669-670) is wrong
      for the refactor review, whose feedback re-runs `refactor.deriving`, never
      design — the next paragraph says so, contradicting it. Say "Feedback at
      the feature review", as the README now does. The rest of the hunk covers
      the slices, the refactor review, the feedback routes and the upgrade note
      for processes resting at `seam.approve`
- [ ] ./docs/configuration.md#695-696 — overrule wording: "no seam gate" dropped
- [ ] ./docs/configuration.md#1226-1230 — new addressable `refactor.build.*`
      scopes
- [ ] ./docs/configuration.md#1240-1241 — `seam.approve` dropped from the scopes
      with no key
- [ ] ./docs/configuration.md#1262-1263 — when a `refactor.build.quality.<lens>`
      key is valid
- [ ] ./docs/configuration.md#1326-1338 — access: `refactor.build.*` inherits
      the refactor restriction; refactor lens row
- [ ] ./docs/configuration.md#1548-1552 — the `refactorQualityReviews` setting
- [ ] ./docs/driver.md#23-38 — approval-gate paragraph: the shipped flow rests
      at none
- [ ] ./docs/setup.md#95-97 — a lens added to `qualityReviews` does not reach
      the refactor review
- [ ] ./docs/setup.md#132-135 — the refactor lens pair, keyed separately
