# TODO

Follow-up work from the review of the event-sourced state-machine refactor (base
`939f65b`). No blockers were found; these are correctness-hygiene and
test-coverage items.

## Fix payload/IO inconsistencies

- **`src/Events.ts` — keep `reviewBasePresent` and `refDiff` coherent.**
  Currently `reviewBasePresent` is set to `true` whenever `computeReviewBase`
  returns `Some(ref)`, but `refDiff` is only populated when the candidate diff
  is non-empty. This produces a `reviewBasePresent: true` / `refDiff: undefined`
  payload when the review base has the same tree as HEAD. The machine guard
  (`reviewBasePresent && refDiff?.trim().length > 0`) compensates, so there is
  no state-transition bug, but the payload is semantically inconsistent.
  Initialize `reviewBasePresent = false` and only set it to `true` inside the
  non-empty-diff branch so the two fields always agree.

- **`src/Git.ts` — trim each line in `commitSubjects`.** It currently splits on
  `\n` and filters by length but does not trim, unlike sibling methods such as
  `lastCommitSubject`. On a CRLF checkout this leaves a trailing `\r` on each
  subject. Trim each line:
  `out.split("\n").map((l) => l.trim()).filter((l) => l.length)`.

## Close test-coverage gaps

- **`src/Prompt.test.ts` — add `buildPrompt()` tests for the missing leaves.**
  `execute`, `cleanup`, `decompose`, and `execute-simple` have section mappings
  and carry the `auto-advance` tag but lack explicit prompt tests. Add one case
  per leaf asserting the correct section renders and the auto-advance partial is
  included.

- **`src/Machine.test.ts` — add edge cases for the review-base/escalate
  guards.**
  - A case with `reviewBasePresent: true` and an empty/whitespace `refDiff` that
    resolves to `verified` (regression guard for the `Events.ts` fix above).
  - `escalate` winning over states other than `new-todo` once the `fix(gtd):`
    counter hits the cap (e.g. vs `human-review` and `cleanup`).
