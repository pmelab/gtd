# Review: fc0c9c3

<!-- base: 28cddd15b98ba7a6b236e0cb70e313ff93fac6ab -->

**Five naive-pass concerns, all green.** `tsc` clean; vitest `unit`
(src/workflows, src/workflow-kit), `workflows` (flag off and
`GTD_FLAG_NAIVE_PASS=1`) and the `workflow-module-reuse` e2e pass. No `Risk:`
found.

## Scenarios

- [ ] ./src/workflows/feature/refactor-review.feature#314-365 — a question
      answered at the refactor review, plus an edit note, lands in the
      re-derived `.gtd/REFACTOR.md` under `## Review feedback` as
      `### Answered Questions`
- [ ] ./src/workflows/feature/refactor-review.feature#403-425 — an `edit` note
      the collecting turn leaves out refuses the landing with
      `refactor-feedback`, naming `note-1` and `gtd abandon`; it never signs off
- [ ] ./src/workflows/feature/refactor-review.feature#427-439 — a code hand-edit
      the collecting turn leaves out refuses the same way, naming `src/calc.ts`
- [ ] ./src/workflows/feature/refactor-review.feature#441-476 — a refactor round
      with only a ticked box still signs off and the feature slice reaches
      `build.review.await-review`. **No triage runs here: it pins the no-note
      sign-off, not a `praise` verdict.** The kit unit test covers `praise`
- [ ] ./src/workflows/feature/refactor-review.feature#647-674 — at
      `refactor.build.review.fix.nits.fixing`, `gtd next --json=access.write`
      lists the stray and `.gtd/**`. The non-stray refusal half is the existing
      scenario at line 618
- [ ] ./src/workflows/feature/refactor-review.feature#752-864 — the refactor's
      lens prompt names its entry commit; the feature's names the refactor's
      sign-off commit, before and after a feature feedback lap
- [ ] ./tests/integration/features/workflow-module-reuse.feature#69-179 — a
      custom workflow ending in `afterTail` with `GTD_FLAG_NAIVE_PASS=1`:
      feedback goes `re-unwind → design.triage → implement.building`; the git
      log never names `seam.naive` or `seam.judge`

## Unbuildable refactor-review note refuses (concern 1)

A refactor round with an `edit` note or a hand-edit whose collecting turn
changes nothing now refuses the landing instead of signing off. The kit gains an
optional `dropped` refusal; only the refactor review sets it.

- [ ] ./src/workflow-kit/review.ts#27-32 — new exported `Requested`: the round's
      notes plus hand-edited paths
- [ ] ./src/workflow-kit/review.ts#77-82 — optional `refusals.dropped`; absent
      means today's sign-off, so the change is additive
- [ ] ./src/workflow-kit/review.ts#85-102 — `collect` refuses with `dropped`
      only when nothing changed, `dropped` is set and the round asked for
      something; a changed-but-unwritten tree still hits `unmatched`
- [ ] ./src/workflow-kit/review.ts#178-183 — edit branch passes its edit notes,
      no paths
- [ ] ./src/workflow-kit/review.ts#251-260 — hand-edit branch now passes all
      round notes and edited paths; `reviewNotes` moved above it, behaviour
      otherwise unchanged. Unparsed-notes branch passes nothing, so still signs
      off
- [ ] ./src/workflow-kit/review.test.ts#3-71 — mock grows a `pending` change
      list; `setup` gains `silent` and `dropped` switches
- [ ] ./src/workflow-kit/review.test.ts#96-119 — pins refuse, no-`dropped`
      sign-off, `unmatched` precedence, praise-only sign-off
- [ ] ./src/workflows/feature/review.ts#245-258 — `FeedbackTarget.dropped`
      passed through; feature review's default target sets none
- [ ] ./src/workflows/feature/review.test.ts#321-350 — feature edit round
      collected to nothing signs off; `dropped` reaches the refusal
- [ ] ./src/workflows/shared/text.ts#1252-1259 — `refactorDroppedRefusal`:
      `gtd land: refactor-feedback:` plus one line per note
      (`id (anchor): text`) and per hand-edited path, then the `gtd abandon`
      cost
- [ ] ./src/workflows/shared/text.test.ts#995-1008 — pins prefix, listing,
      abandon wording
- [ ] ./src/workflows/feature/refactor.ts#255-264 — `reviewedRefactor` sets
      `dropped: t.refactorDroppedRefusal`
- [ ] ./src/workflows/feature/refactor.test.ts#824-837 — refactor edit round
      collected to nothing refuses, never `signoff`

## Refactor fix scopes keep the write limit (concerns 2 and 3)

The static `{}` entries reopened every write for refactor nit/risk fixes. They
are gone; the fix turns now open their own scope with the strays plus `.gtd/**`,
set at run time.

- [ ] ./src/workflows/shared/access.ts#6-26 — drops both
      `refactor.build.review.fix.*` entries; comment says who sets them now
- [ ] ./src/workflows/shared/access.test.ts#20-62 — pins the absence and the
      unchanged `review` / `defer` entries
- [ ] ./src/workflows/feature/steps.ts#83-95 — `fixNits(notes, access?)`: with
      `access`, `scope("review.fix.nits") → "fixing"`, so the full step name is
      unchanged; without, byte-identical to before
- [ ] ./src/workflows/shared/steps.ts#108-121 — `fixRisks` mirrors `fixNits`
- [ ] ./src/workflows/feature/review.ts#174-216 — `fixAccess` reaches both
      guarded fix turns
- [ ] ./src/workflows/feature/review.ts#266-269 — `fixAccess` and `lensBase`
      options on `BuildTailOptions`
- [ ] ./src/workflows/feature/refactor.ts#226-234 — `strayAccess` helper, reused
      by the slice scope and `fixAccess`
- [ ] ./src/workflows/feature/refactor.ts#271-272 — `reviewedRefactor` passes
      `fixAccess` and `lensBase: entry`
- [ ] ./src/workflows/feature/steps.test.ts#83-109 — scope name and inner step
      name pinned
- [ ] ./src/workflows/feature/review.test.ts#196-217 — both fix turns scoped
      with `fixAccess`, none without
- [ ] ./src/workflows/feature/refactor.test.ts#857-866 — refactor nit-fix turn's
      write access is strays plus `.gtd/**`
- [ ] ./docs/configuration.md#1334-1355 — access table gains the four
      `refactor.build.review*` rows; precedence of `config.access` spelled out
- [ ] ./docs/configuration.md#625-630 — drops the non-existent
      `refactor.build.review.health.*`

## afterTail naive feedback lap (concern 4)

The naive feedback loop moved into `featureFeedback`; `afterTail` uses it when
`flag_naive_pass` is `"1"`, so a custom tail never re-runs the seam.

- [ ] ./src/workflows/feature/feature.ts#49-71 — loop extracted verbatim; `tier`
      now `const` per lap; `lensBase` threaded to every lap
- [ ] ./src/workflows/feature/feature.ts#73-77 — `afterTail` branches on the
      flag and opens no slice (slices cannot nest); lap reviews from `start()`
- [ ] ./src/workflows/feature/feature.test.ts#124-185 — flag on: design →
      implement, no `seam.*`; flag off: `architecture.*` / `packages.*` as
      before
- [ ] ./src/testkit/steps.ts#124-128 — new Given `step … is no longer scripted`,
      so a later visit can rest at a once-scripted step

## Per-slice quality-lap base (concern 5)

Each slice's lens prompt now reviews from its own base; the spec-challenge brief
still searches history from the process start.

- [ ] ./src/workflows/shared/text.ts#579-599 — `buildQualityReviewingPrompt`
      takes `base` (default `start()`) and names the start beside it; the brief
      says `<start>` is the process start, not the review base
- [ ] ./src/workflows/shared/steps.ts#71-74 — `reviewQuality(lens, base?)`
- [ ] ./src/workflows/shared/tail.ts#32-41 — `qualityLap` threads `base`
- [ ] ./src/workflows/shared/tail.ts#80-98 — `tail` gains trailing `lensBase`;
      eighth positional parameter
- [ ] ./src/workflows/feature/review.ts#283-287 — `buildTail` forwards it
- [ ] ./src/workflows/shared/tail.test.ts#210-276 — `lensBase` reaches every
      lens prompt; absent, `START-SHA`
- [ ] ./src/workflows/shared/text.test.ts#266-288 — default, given base, brief
      wording
- [ ] ./src/workflows/feature/review.test.ts#772-813 — `buildTail` option
      reaches lens prompts
- [ ] ./src/workflows/feature/refactor.test.ts#716-730 — entry commit on both
      laps

## One shared collecting prompt (concern 6)

`refactorReviewCollectingPrompt` is deleted; `buildReviewCollectingPrompt` takes
an optional `{ strays }`. A fixture pins the feature text verbatim.

- [ ] ./src/workflows/shared/text.ts#871-971 — one builder, feature text
      unchanged; the refactor variant targets `.gtd/REFACTOR.md`, fences to the
      strays, says `.gtd/REVIEW.md` is closed, and says an edit note or
      hand-edit MUST write the package. **Partial fold drops left-out concerns
      silently.** A round where some concerns fit the fence writes `REFACTOR.md`
      with the rest omitted; the only trace is the agent's final message. The
      doc comment owns this; concern 1 covers only the all-dropped case.
      **Prompt contradicts itself.** The refactor variant still embeds
      `footnoteFoldIn`, which tells the agent to delete footnotes and write
      `- A:` replies in `.gtd/REVIEW.md`, the file it now calls closed
- [ ] ./src/workflows/shared/text.test.ts#652-663 — equality against the new
      feature-collecting-prompt.txt fixture (97 lines). The fixture is new here,
      so it pins today's output; a manual compare matched it to the old text
- [ ] ./src/workflows/shared/text.test.ts#954-990 — refactor variant: target,
      strays, answered questions, no closed-file check, must-write rule
- [ ] ./src/workflows/feature/steps.ts#108-115 — `refactorCollecting` calls the
      shared builder
- [ ] ./src/workflows/feature/refactor.ts#140-154 — `demoteHeadings`: shifts
      collected headings so the shallowest becomes `###`, skipping fenced code.
      A `######` input becomes 7 `#`s, which is no longer a heading
- [ ] ./src/workflows/feature/refactor.ts#201-201 — re-derived package uses it
- [ ] ./src/workflows/feature/refactor.test.ts#786-823 — `##` → `###`, `#` →
      `###`, fence tracking, shared prompt used

## Docs

- [ ] ./README.md#576-579 — naive-pass summary: refused unbuildable refactor
      change, per-slice quality lap
- [ ] ./docs/configuration.md#668-688 — per-slice lap base, `afterTail` lap, new
      refusal paragraph
- [ ] ./docs/configuration.md#1568-1570 — `refactorQualityReviews`: a lens left
      out never sees the refactor
