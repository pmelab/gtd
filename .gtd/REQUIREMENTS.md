# PR 390 follow-up fixes

Six fixes to the refactor-first slice work on this branch (PR 390, closes #381).
Each one ships green on its own, in this order.

## Open Questions

### After an unbuildable refactor note is refused, what is the human's way out?

The refusal is settled (see below). Still open: is `gtd abandon` the only exit,
or does the human get a rest where they can drop the note and sign off on
purpose.

- [ ] Refuse the collecting turn's landing; the only way out is `gtd abandon`
  - matches the current docs ("abandon and restart")
  - the driver re-prompts once, then the process shows as blocked
  - **abandoning throws away the naive pass, the refactor and its review**
- [ ] Rest at a new human step that names the notes the refactor cannot build;
      landing clean signs off without them, `gtd abandon` restarts
  - no work is lost to a note that only belongs to the feature
  - **adds a public step name** (for example
    `refactor.build.review.unbuildable`), so it is API and docs
  - the sign-off is explicit, never silent
- [ ] _your answer_

## 1. Refactor review: never sign off silently on an unbuildable edit note (PRODUCT)

Today a refactor-review edit note the refactor cannot build (it needs a path
outside the strays, a test file, a new flag read, or a behaviour change) is left
out of `.gtd/REFACTOR.md` by the collecting turn. The kit then sees no package
and no change and returns `signoff`. **The human's change request vanishes and
the refactor signs off as if approved.**

- **When the round carried an `edit` note or a code hand-edit and the collecting
  turn wrote no `.gtd/REFACTOR.md`, refuse — never `signoff`**
- A round with only an approving remark (nothing actionable) still signs off by
  changing nothing
- The refusal names the notes left out and the way out the open question settles
- The collecting prompt drops "say in the reply" wording that points at
  `.gtd/REVIEW.md`: the round closes that file before collecting runs
- Pin with a `@inmem` scenario in `refactor-review.feature` and unit tests in
  `refactor.test.ts`; update `docs/configuration.md`'s refactor-review paragraph

## 2. Refactor review fix scopes keep the refactor's write limit (TECHNICAL)

The access table gives `refactor.build.review.fix.nits` and
`refactor.build.review.fix.risks` `{}`, copied from the feature review. **`{}`
reopens all writes, so a nit or risk fix inside the refactor review can edit any
file**, past the strays-plus-`.gtd/**` limit the `refactor` scope sets.

- Both scopes get the strays plus `.gtd/**` as `write`, never `{}`
- The strays are only known at run time, so the limit comes from the refactor's
  own `scope()` option, not the static table; the static `{}` entries go
- `refactor.build.review` (`.gtd/REVIEW.md`) and `refactor.build.review.defer`
  (`.gtd/TODO.md`) stay as they are
- Tests: `access.test.ts`, plus a scope-access scenario where a refactor nit fix
  writing outside the strays is refused

## 3. `docs/configuration.md` access and scope lists match the code (TECHNICAL)

- Add the refactor review rows to the "Bundled defaults" table:
  `refactor.build.review`, `refactor.build.review.defer`, and the two fix scopes
  with the write limit from concern 2
- Drop `refactor.build.review.health` from the refactor-tail rest list: no such
  scope exists — the tail's health loop is `refactor.build.health.*`
- Check every other `refactor.build.*` name in the doc against what the flow
  actually opens

## 4. `afterTail` on the naive-pass path skips the seam (TECHNICAL)

`afterTail` (public, for custom workflows whose tail skipped planning) handles
feedback with `planAndBuild`. With `flag_naive_pass=1` that runs `seam.naive`
and `seam.judge` again. **That contradicts the rule that a feedback lap is
design → implement and never re-runs the seam.**

- On the naive path, `afterTail`'s feedback lap runs design, then `implement.*`,
  then the feature review — no `seam.naive`, no `seam.judge`, no refactor slice
  — looping until sign-off, the same as the shipped flow's feedback loop
- Off the naive path, nothing changes
- Share the feedback loop with `naivePlanAndBuild` rather than copy it
- Tests: `feature.test.ts` plus a scenario using `afterTail` with
  `GTD_FLAG_NAIVE_PASS` on

## 5. Each quality lap reviews from its slice's base (TECHNICAL)

The quality-lens prompt reviews "from `start()` to the working tree". **On
`refactor-first` the feature's quality lap re-reviews the refactor, and the
refactor's lap reviews the naive-pass history before it.**

- The refactor slice's lap reviews from the refactor's entry commit
- The feature slice's lap reviews from the feature review's base (after the
  refactor's sign-off on `refactor-first`, the caller's base otherwise)
- Feedback laps keep the slice base, not the round commit: the lap still covers
  the whole slice
- The non-naive path keeps `start()`
- The base passes through the tail into the lens prompt; pin it in
  `tail.test.ts` / `text.test.ts`

## 6. Refactor collecting keeps answered questions and shares one prompt (TECHNICAL)

`refactorReviewCollectingPrompt` is a hand copy of `buildReviewCollectingPrompt`
and has already drifted: **it lacks the rule that carries answered review
questions forward**, so a question answered at the refactor review is lost when
the round replaces `.gtd/REVIEW.md`.

- One collecting prompt, taking the target file and an optional refactor
  constraint block (allowed paths, no test file, no flag read, no behaviour
  change)
- The refactor variant carries answered questions into `.gtd/REFACTOR.md` under
  `## Answered Questions`, and the re-derived package keeps them under
  `## Review feedback`
- `text.test.ts` pins both variants; the feature variant's text does not change

## Answered Questions

### Should an unbuildable refactor-review edit note sign off, or refuse?

Refuse. `.gtd/TODO.md` says so outright: "must never sign off silently - refuse
instead".

### Do the two deferred-review-note sections removed from `.gtd/TODO.md` become concerns?

No. The human deleted both (note-3, the garbled-flag stdout assertion; note-2,
the `gtd history list` kept-tip scenario) in the same edit that wrote the fix
list. Deleting a parked note drops it.

### Should the refactor review's fix scopes stay unrestricted like the feature review's?

No. The TODO asks for strays plus `.gtd/**` write, and the refactor slice's
whole promise is that it touches only the strays.

### Should a feedback lap reached through `afterTail` re-run the seam on the naive path?

No. The TODO says it skips the seam, and the shipped flow already never re-runs
the seam once judged.
