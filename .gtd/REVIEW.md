# Review: 80d9fec

<!-- base: 7ec474802711a0a93023ed7699dc3842f9dc0367 -->

**Verdict: approve.** The branch closes the refactor-review gaps (footnotes,
in-gate thread replies, stray rules on every tail turn, amend wording on feature
feedback laps). **The risk fix resolved the 28.0.0-only upgrade wording; no risk
remains.** Two nits stay open (a test title, a stray comment clause).

**FYI: this branch must ship as a major (29.0.0).** It removes the
`seam.approve` step and changes the exported `seamBuild` signature, both
SemVer-tier surfaces in COMPATIBILITY.md. "Any 28.x" in the upgrade notes is
correct only under that release.

## Scenarios

- [ ] ./src/workflows/feature/refactor-review.feature#441-464 — **The refusal
      for a hand-edit round names the edited path and never a praise note.** A
      praise line note on that round does not appear in the refusal.
- [ ] ./src/workflows/feature/refactor-review.feature#466-502 — **A `- H:`
      thread at the refactor review gets one `- A:` reply.** The gate rests
      again and no `.gtd/REFACTOR.md` is written.
- [ ] ./src/workflows/feature/refactor-review.feature#504-587 — **Closing a
      thread with no change after the in-gate reply signs the refactor off.**
      The feature slice's review follows.
- [ ] ./src/workflows/feature/refactor-review.feature#589-631 — **A one-shot
      footnote judged `praise` signs off.** The feature slice follows.
- [ ] ./src/workflows/feature/refactor-review.feature#633-658 — **A one-shot
      footnote judged `edit` that collecting drops refuses the landing.** The
      refusal names `[^n1]` and its text.
- [ ] ./src/workflows/feature/refactor-review.feature#660-716 — **A footnote
      added after an in-gate reply is still judged.** It is never signed off
      unjudged and gets the same `[^n1]` refusal.

## Footnotes count as notes in the review kit

`notesOf` used to strip every footnote, so a footnote-only edit read as "no
notes". Now it strips only thread footnotes (`- H:`/`- A:`), and one-shot
footnotes reach the triage. A hand-edit round passes no notes to the dropped
refusal, so praise is never named.

- [ ] ./src/workflow-kit/review.ts#111-132 — rebuilds `notesOf` per thread name
      with an escaped, case-insensitive regex. **FYI: this is not gated by a
      flag.** It also changes the default `feature` build review (`notedSince`
      after an in-loop collect) and `reviewToHandOff`: a footnote-only edit
      there now hands off where it used to sign off silently. That fixes a
      dropped note, but README describes footnote judging only in the naive-pass
      section.
- [ ] ./src/workflow-kit/review.ts#279-279 — hand-edit round: `notes: []`, paths
      only.
- [ ] ./src/workflow-kit/review.ts#33-35 — `Requested` doc updated to match.
- [ ] ./src/workflow-kit/review.ts#12-18 — imports `parseThreads`.
- [ ] ./src/workflow-kit/review.test.ts#140-313 — covers a one-shot footnote
      after an in-gate collect, a thread reply that settles, the dropped refusal
      (paths only, or edit notes including footnotes), and the `reviewToHandOff`
      footnote hand-off.
- [ ] ./src/workflow-kit/review.test.ts#7-38 — mock additions (`parseThreads`,
      changes state) for the above.
- [ ] ./src/workflow-kit/review.test.ts#87-90 — resets the new mock state.

## In-gate refactor collecting turn

The collecting turn at the refactor gate now has an "open" variant, used while
`.gtd/REVIEW.md` still exists. It replies to waiting threads and folds only the
threads and notes that ask for a change. Before this, the prompt always said the
file was closed.

- [ ] ./src/workflows/shared/text.ts#875-879 — `open` flag added to the refactor
      option.
- [ ] ./src/workflows/shared/text.ts#946-957 — open-variant wording: one `- A:`
      per waiting `- H:`, run `gtd check review`, fold change-requesting threads
      and footnotes, delete praise.
- [ ] ./src/workflows/feature/steps.ts#114-124 — `refactorCollecting` picks the
      variant from `read(REVIEW) !== undefined`. The kit closes the file before
      an end-of-round collect, so the check is correct.
- [ ] ./src/workflows/feature/steps.test.ts#49-72 — pins the feature collecting
      prompt to a fixture and checks that refactorCollecting switches variant.
- [ ] ./src/workflows/shared/text.test.ts#1015-1033 — Nit: the test title says
      the in-gate prompt "leaves one-shot footnotes and notes untouched", but
      the body asserts "Fold each one-shot footnote and note". Rename the test.

## Refactor rules on every tail turn

`reviewedRefactor` passes `refactorRules(strays, pattern)` through `buildTail`.
Fix-check, quality-fix, risk-fix, nit-fix and escalation-describe prompts now
carry the stray list, the test-file ban and the flag-read ban. Without rules,
every prompt renders as before.

- [ ] ./src/workflows/shared/text.ts#449-460 — exports `refactorRules` and adds
      the `withRules` helper.
- [ ] ./src/workflows/shared/text.ts#502-559 — the describe, fix and quality-fix
      prompts append rules.
- [ ] ./src/workflows/shared/text.ts#756-771 — the nit and risk prompts append
      rules. **With rules, the risk prompt drops "add a test that fails without
      the fix".** This is intended, because a refactor turn may not touch tests,
      but a behavioural risk fixed in the refactor slice now ships without a
      regression test.
- [ ] ./src/workflows/shared/steps.ts#23-115 — `fixCheck`, `describeEscalation`,
      `fixQuality`, `fixRisks` take `rules`.
- [ ] ./src/workflows/shared/health.ts#24-155 — `escalationSteps` becomes a
      factory so describe gets the rules. The stop and exhausted human rests
      stay rule-free.
- [ ] ./src/workflows/shared/tail.ts#48-102 — threads `rules` through fix,
      healthy and the quality fix.
- [ ] ./src/workflows/feature/review.ts#174-289 — `BuildTailOptions.rules`
      reaches the risk fix, nit fix and keepGreen.
- [ ] ./src/workflows/feature/steps.ts#84-93 — `fixNits` takes `rules`.
- [ ] ./src/workflows/feature/refactor.ts#220-220 — the refactor lap's own
      describe turn gets the rules.
- [ ] ./src/workflows/feature/refactor.ts#272-272 — the review tail gets the
      rules.
- [ ] ./src/workflows/feature/refactor.test.ts#930-962 — each `refactor.build.*`
      turn's prompt names every stray and both bans.
- [ ] ./src/workflows/feature/refactor.test.ts#588-630 — `driveReviewed` script
      grows `firstReviewNote`/`reds` knobs.
- [ ] ./src/workflows/feature/review.test.ts#814-887 — the feature tail's
      prompts render unchanged without rules.
- [ ] ./src/workflows/shared/text.test.ts#1035-1075 — each prompt renders with
      and without rules, and the risk prompt drops its add-a-test line.
- [ ] ./src/workflows/shared/text.test.ts#15-18 — new imports.
- [ ] ./src/workflows/shared/text.test.ts#958-960 — adjusts an existing
      refactor-prompt assertion.

## Feature feedback laps amend instead of rewrite

On the naive-pass path, `featureFeedback` now calls
`implement(undefined, tier, true)`. The prompt says the change already exists,
so the agent amends it, keeps any flag the earlier lap added, and drops "write
fresh".

- [ ] ./src/workflows/feature/feature.ts#66-66 — feedback lap passes
      `amend: true`.
- [ ] ./src/workflows/feature/seam.ts#44-50 — `implement` takes `amend`.
- [ ] ./src/workflows/shared/text.ts#1206-1235 — `implementBuildingPrompt`'s
      amend branch. Without risk tier, amend asks it to keep the earlier flag or
      add one. With tier `low`, it says to add no flag.
- [ ] ./src/workflows/feature/seam.test.ts#203-261 — first lap vs amend wording,
      and amend on tier low.
- [ ] ./src/workflows/feature/feature.test.ts#103-104 — feedback lap rests at
      `implement.building` with "already exists".
- [ ] ./src/workflows/feature/feature.test.ts#178-181 — same check on the
      `afterTail` path.

## Shared fence scanner

`markFenced` moves from `tier.ts` to `shared/fences.ts`. `demoteHeadings` in the
refactor collect now uses it, so CommonMark-ish rules apply there too: a 0–3
space indent opens a fence, a closer must be at least as long, and a closer must
be bare.

- [ ] ./src/workflows/shared/fences.ts#1-3 — Nit: the comment still says "worst
      case is `high`". That is risk-tier wording, now in a shared module that
      `demoteHeadings` also uses. Move that clause back to `tier.ts`.
- [ ] ./src/workflows/feature/tier.ts#2-16 — imports the shared scanner and
      keeps the fail-closed note at its use.
- [ ] ./src/workflows/feature/refactor.ts#16-16 — import.
- [ ] ./src/workflows/feature/refactor.ts#143-147 — `demoteHeadings` on
      `markFenced`.
- [ ] ./src/workflows/feature/refactor.test.ts#817-845 — a four-backtick fence
      survives an inner three-backtick line, and a four-space-indented backtick
      line opens no fence.
- [ ] ./src/workflows/feature/tier.test.ts#80-83 — same indent rule for the tier
      reader.

## Upgrade path and docs

`seam.approve` is gone. A `refactor-first` process from before this change fails
replay and must `gtd abandon`. The test forges `Gtd-Step:` trails and checks
that every rest replays, except the ones from the `refactor-first` verdict on.

- [ ] ./README.md#578-580 — **fix: "A 28.0.0 process" now reads "A 28.x
      process".** Covers 28.0.0 and 28.1.x, both of which shipped
      `seam.approve`.
- [ ] ./docs/configuration.md#687-708 — **fix: the Upgrading list now says "from
      any 28.x release".** Text reflowed only. The rest of the hunk is accurate:
      refusal contents, footnote judging, the in-gate thread reply, and the
      `seamBuild(base)` signature change.
- [ ] ./docs/configuration.md#596-598 — notes that the review tail's turns carry
      the refactor rules.
- [ ] ./docs/configuration.md#638-642 — the shipped flow now runs
      `reviewedRefactor`, and custom flows may call either.
- [ ] ./src/workflows/feature/feature.test.ts#191-303 — forged-trail replay
      test: land, land then a feedback lap, and rejected/steered paths replay at
      every rest. Every `refactor-first` rest throws "the workflow changed under
      this process".
- [ ] ./src/testkit/steps.ts#210-216 — new
      `driving the process is refused without {string}` step. It passes on any
      rejection whose message lacks the string, so pair it with a positive
      `refused with` (as the scenario does).
