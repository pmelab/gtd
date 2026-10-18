# Quality findings

## correctness: refactor in-gate collecting leaves notes for a triage the settled path never runs

Blocking. `src/workflows/shared/text.ts` `buildReviewCollectingPrompt`
(`refactor.open`) tells the in-gate turn to "Leave one-shot footnotes and notes
untouched: the round's triage judges them". But `src/workflow-kit/review.ts`
`finish` only triages when the round is not `settled`, and `settledAfter` judges
that from changes made AFTER `collectedAt`. Anything the human wrote before or
alongside the thread question is already in the baseline at `collectedAt`, so it
never counts.

Trace: in round 1 the human adds `[^q]` (`- H: why?`) and one-shot `[^n1]`
("Rename the helper."). `converse` runs the open collecting turn. It replies to
`q` and leaves `n1`, then rests. In round 2 the human concludes `q` with "no
change needed", and the collecting turn deletes `q`. `converse` returns
`collectedAt`. Nothing changed after `collectedAt`, so `settled` is true and
`unfolded` runs. `REFACTOR.md` was never written, so the round SIGNS OFF and
`n1` is never triaged or folded. The same thing happens to a line note, or to a
stray hand-edit made in round 1. A hand-edit also goes unchecked by `keepGreen`.
The `dropped` refusal is never consulted on this path.

The prompt also contradicts itself. The shared `footnoteFoldIn`, rendered in the
same prompt, says "fold it in and DELETE it in this same turn", and the refactor
`actionable` block says a hand-edit round "MUST write `.gtd/REFACTOR.md`". So
the outcome depends on which line the agent obeys.

Coverage: the new unit test "a one-shot footnote added after an in-gate
collecting turn routes through triage" and the scenario "a one-shot footnote
landed after an in-gate thread reply is judged" only cover a footnote added
AFTER the in-gate turn. No test adds one in the same round as the thread
question.

Fix: choose one of these:

- Have the open turn fold one-shots, notes and hand-edits the way the feature
  in-gate prompt does, and drop the "leave untouched" line.
- Make `settled` compare notes against `reviewed`, not `collectedAt`, when the
  in-gate turn wrote no feedback.

Either way, add a scenario where the footnote lands alongside the question.

## correctness: amend lap tells a now-high-tier change to add no release flag

Blocking. `implementBuildingPrompt` with `amend === true` and a tier other than
`low` renders "Keep the release flag the earlier lap added; add none". This is
fail-open in two reachable cases:

- `naivePlanAndBuild`'s first lap recorded `low`, so it added no flag. A
  feedback lap (`featureFeedback`) re-runs `recordRisk()` on the re-derived
  requirements, which now read `high`. The prompt then says to keep a flag that
  does not exist and add none, so a high-risk change ships unflagged.
- `afterTail` (public API) with `flag_naive_pass=1` goes straight into
  `featureFeedback`. No `implement` lap ever ran there, so no earlier flag
  exists.

`readRiskTier` was built as "under-tiering is the risky direction". This prompt
reverses that guarantee. The new tests only render `amend` with tier `undefined`
or `low`, so nothing pins the low-to-high case.

Fix: on amend with `high`, say "keep the release flag if the earlier lap added
one; otherwise put the behaviour behind a new one".

## correctness: hand-edit round notes are neither triaged nor folded, and the refusal no longer names them

Non-blocking. It is partly pre-existing, but this change locks it in.

`finish` now passes `{ notes: [], paths }` on a hand-edit round. That round runs
no triage, and the capture it collects with (`reviewEditsCapture`) lists no
notes. Both collecting prompts say "Fold each `edit` note the capture lists, no
other note", so the line notes and one-shot footnotes the human left with the
hand-edit are excluded by the prompt's own wording. If the turn folds only the
hand-edit, those notes are lost without a word. The `dropped` refusal used to
name them, but now cannot.

The change fixed "praise named by the refusal" by emptying the list instead of
triaging it. Fix: either triage the notes on a hand-edit round as well, or have
the edits capture list them and the prompt fold them.

## correctness: refactor lap's own escalation describe gets no refactor rules

Nit. `refactorLap` in `src/workflows/feature/refactor.ts` calls
`healthy(..., { describeGuard: guard })` without `rules`. Its `health.describe`
prompt therefore omits the stray, test-file and flag bans. Every tail escalation
in the same refactor scope now carries them (`healthy` and `escalation` with
`rules`). Two write paths to `.gtd/ESCALATION.md` in one scope now give
different constraints. Pass `rules: t.refactorRules(strays, pattern)` there as
well.

## ponytail-review: thread strip in `notesOf` is case-sensitive, thread matching is not

Nit. `src/workflow-kit/review.ts` `notesOf` builds its strip regexes from
`parseThreads(text)` names, which come from the definition label. The parser
ties markers to a thread case-insensitively (`foldName` in
`src/steering/Threads.ts`), but the new regexes have no `i` flag.

Case: the thread is defined as `[^q]:` and its marker in the text is `[^Q]`. The
human concludes it after the in-gate turn by deleting it, as the
`threadsPending` refusal suggests. `[^Q]` was never stripped, so the before and
after texts differ, and `notedSince` reports a note. The round is not `settled`.
It runs a triage and a collecting turn on a thread-only change.

Fix: add the `i` flag to both `new RegExp(...)` calls in `notesOf`. Two
characters, no other change.

## ponytail-review: `markFenced`'s comment still talks about the tier

Nit. `src/workflows/shared/fences.ts` is now shared with `demoteHeadings` in
`src/workflows/feature/refactor.ts`, but its comment still says "so the tier
reads `high` (fail-closed)". In the refactor caller, an unclosed fence means the
rest of the text is never demoted, not that a tier is read. Reword it to the
general fact: "an unclosed fence runs to end of file". Move the tier consequence
to the `markFenced` call in `src/workflows/feature/tier.ts`.

## test-audit: hand-edit refusal tests pin the dropped-notes bug, and one scenario is misnamed

Non-blocking. This is the test side of the correctness finding "hand-edit round
notes are neither triaged nor folded".

- `src/workflow-kit/review.test.ts` "a hand-edit round names the edited paths
  and no notes" sets the line note to `other rename it`, which is a plain edit
  request. It then asserts `dropped` is `{ notes: [], paths: ["a.ts"] }`. The
  test therefore requires an edit note to vanish from the refusal, which pins
  the bug as the contract.
- The scenario "a praise line note on a hand-edit round is never named by the
  refusal" in `src/workflows/feature/refactor-review.feature` has the same
  problem. No triage runs on that path, so nothing judges "lovely work" as
  praise. The step passes because `finish` passes `notes: []` unconditionally.
  An edit note in the same spot would also go unnamed and the scenario would
  stay green. The name claims a praise filter that the code does not have.

Fix: whichever fix the correctness finding gets, rewrite both tests to the
intended contract. Use an edit note on a hand-edit round, and assert that the
round either names the note or folds it. Keep a praise note only if a triage
really runs on that path.

## test-audit: `refused without` step passes on any unrelated refusal

Nit. The new `src/testkit/steps.ts` step "driving the process is refused without
{string}" only asserts that `drive()` rejects with some message that lacks the
string. Used alone, it would pass if the process failed for a completely
different reason. Its one use is guarded by a preceding "refused with" line in
the same scenario, so the scenario is sound today. The step itself is a weak
negative control that the next author can reuse unguarded. Fix: make the step
take the expected refusal too, or document at the step that it must follow a
"refused with" line. Better still, fold the negative into the "refused with"
step as `refused with {string} and without {string}`.

## test-audit: amend-lap tests cover only the flag wording that is safe

Non-blocking. This is the test side of the correctness finding "amend lap tells
a now-high-tier change to add no release flag".

- `src/workflows/feature/seam.test.ts` renders `amend` only with tier
  `undefined` and `low`, and asserts "Keep the release flag" / "add none". No
  case renders amend with `high` after a `low` first lap, so nothing pins the
  fail-open case.
- The `src/workflows/feature/feature.test.ts` afterTail test "flag_naive_pass=1
  rests at design.triage, then implement.building" now asserts "already exists".
  That path never ran an `implement` lap, so the rendered "Keep the release flag
  the earlier lap added" is false there. The test locks in the amend prompt on a
  path where no earlier lap or flag exists, and it does not look at the flag
  line.

Fix: add a `building(undefined, "high", true)` case that asserts the prompt asks
for a flag when none exists. Make the afterTail assertion cover the flag wording
the fixed prompt should give on that path.

## test-audit: refactor lap's own describe prompt is outside the new rules table

Nit. In `src/workflows/feature/refactor.test.ts`, the table "reviewedRefactor's
tail prompts" covers `refactor.build.health.describe`, which is the tail
escalation. It does not cover the describe prompt that `refactorLap`'s own
`healthy(..., { describeGuard })` renders. That is why the correctness nit (that
prompt has no `rules`) got through. When that nit is fixed, add the refactor
lap's describe step to the same table (reds before the tail).
