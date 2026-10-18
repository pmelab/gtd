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
