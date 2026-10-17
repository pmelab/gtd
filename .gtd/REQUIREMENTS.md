# Requirements

Implement pmelab/gtd#381: on the naive-pass path (`GTD_FLAG_NAIVE_PASS=1`), a
`refactor-first` verdict splits the process into two separately reviewed slices
— `refactor`, then `feature`. Sketch: the one-line `.gtd/TODO.md` directive in
`0e41f1ad`. `slice(name, fn)` (#385) is already on this branch. **Step names and
order are Stable: ships as `feat!` with a literal `BREAKING CHANGE:` footer**
(`refactor!`/a bare `!` cuts no release).

## Open Questions

### What are the refactor review's step names?

Step names are public API: drivers, `skills` config keys and `.feature` files
key on them. The fork is whether the feature review keeps today's
`build.review.*` names on the naive path.

- [ ] Refactor tail nests under `refactor`: `refactor.build.review.*`,
      `refactor.build.quality.<lens>`; the feature tail keeps `build.review.*`
  - feature review named the same on every path; default path untouched
  - asymmetric: only the refactor slice carries a prefix
- [ ] Both tails carry their slice name: `refactor.build.*` and
      `feature.build.*`
  - symmetric, the name says which slice a rest belongs to
  - renames the naive path's feature review too; a `skills` key on
    `build.review` stops reaching it there
- [ ] _your answer_

### What records the refactor approval once `seam.approve` is gone?

`seam.approve` leaves a `Gtd-Approved:` trailer today. A review sign-off ticks
boxes in `.gtd/REVIEW.md` — an edit — which an `approve` gate refuses.

- [ ] The refactor review's sign-off commit is the record, like the feature
      review's
  - no `Gtd-Approved:` trailer on the refactor-first path any more
  - SDLC.md gate table drops the `seam.approve` row, adds a "refactor review
    sign-off" row
- [ ] Keep a `Gtd-Approved:` trailer: the refactor review sign-off also stamps
      it
  - audit trail keeps an attributed approval of the seam
  - needs the engine to stamp approval on a step that accepts an edit — new
    engine surface, a COMPATIBILITY.md trailer change
- [ ] _your answer_

### Which slices does the naive path record when the judge rules `land`?

Only `refactor-first` gets two slices. On `land` (and on overrule at
`seam.steer`, or after `seam.by-hand`) there is one slice; `gtd slices` shows
its name to drivers.

- [ ] Wrap implement + review in `slice("feature")` on every naive-path verdict
  - naive path always shows a `feature` slice; drivers see one name for the
    feature work
  - default path keeps the implicit `main`
- [ ] Slice only on `refactor-first`; `land` keeps the implicit `main`
  - nothing changes for `land`
  - feature work is named `feature` or `main` depending on the verdict
- [ ] _your answer_

### Does feature review feedback re-run the naive pass and judge after a `land` verdict?

The issue says feature feedback re-plans design → implement only, on
`refactor-first`. After `land` nothing about the seam was signed off; today
feedback re-runs `seam.naive` and `seam.judge`.

- [ ] Yes — after `land`, feedback re-runs naive pass and judge, as today
  - a re-plan may turn up a seam and go `refactor-first` mid-process
  - one more agent turn and judge per feedback round
- [ ] No — once judged, every feature feedback round is design → implement
  - same shape on every verdict; cheaper rounds
  - a seam the re-plan needs is built unjudged, unrefactored
- [ ] _your answer_

## 1. Two slices on `refactor-first` (PRODUCT)

```text
design → naive pass → seam.judge
  slice("refactor"): refactor.* → quality lap → refactor review
  slice("feature"):  implement.* → quality lap → feature review
```

- **`seam.approve` is removed**: the refactor review sign-off is the approval
- **Gates on `refactor-first`: design, refactor review, feature review = 3**; on
  `land`: design, feature review = 2; default path unchanged at 3
- **Default path (naive pass off) unchanged**: no `slice()` call, one implicit
  slice
- `seam.by-hand` (unreadable strays, no refactor) and overrule at `seam.steer`
  run no refactor slice
- Design commits before the first slice fold into `refactor` (slice gap rule)

## 2. Refactor review and its feedback loop (PRODUCT)

- **Refactor review covers the refactor slice's commits only**
- Same review flow as the feature review: questions answered in place, nits
  fixed, could-notes deferred to `.gtd/TODO.md`, edits loop
- **An edit note re-runs the refactor, never a re-plan**, under the same guards:
  stray paths only, no new or added flag reads, no test file touched
- **Quality-lap fixes, fix-check turns and nit fixes in the refactor slice run
  under those guards too**
- A note asking for a change outside the strays is refused by the guard; the way
  out is abandon and restart
- The human's code edits at the refactor review are re-unwound, as at the
  feature review

## 3. Feature review and its feedback loop (PRODUCT)

- **Feature review covers the feature slice only** — everything since the
  refactor sign-off
- **Feedback re-plans design → implement**; the seam is never re-judged once the
  refactor is signed off (wrong refactor → abandon and restart)
- The re-plan loop sits inside `slice("feature")` (a loop must sit inside its
  slice)

## 4. No test file touched by the refactor (TECHNICAL)

- **A refactor turn (building, fix, quality fix, nit) that changes a test file
  is refused at `gtd land`**, even when the file is a stray — today's package
  rule "a test file only when it is one of them" goes
- Refactor package text and prompts drop that exception

## 5. `refactorQualityReviews` setting (PRODUCT)

- **New process setting `refactorQualityReviews`, default
  `correctness, ponytail-review, conventions`**: the lenses of the refactor
  slice's quality lap; `qualityReviews` keeps driving the feature slice
- Settable like `qualityReviews`: factory option, `GTD_REFACTORQUALITYREVIEWS`;
  blank runs no refactor lap

## 6. Tests (TECHNICAL)

- **`@inmem` scenarios**: refactor review sign-off then feature review; refactor
  feedback loop; feature feedback skips naive pass and judge; a refactor turn
  touching a test file is refused
- Update `src/workflows/feature/refactor-first.feature` (step path, commit
  subjects, no `Gtd-Approved:` assertion on `seam.approve`) and `seam.feature`
- Assert `gtd slices` lists `refactor` then `feature` on the refactor-first path
- Unit tests beside `src/workflows/feature/` for the new flow shape

## 7. Docs (TECHNICAL)

- **SDLC.md**: gate counts (naive path 2, or 3 on `refactor-first`), gate table,
  fixture list, "What stops a landing" (review sign-off no longer the only human
  look at the full diff — two reviews split it)
- **`docs/configuration.md`**: the naive-pass path list, `seam.approve` removed
  from scope/step lists, `refactorQualityReviews` under the bundled workflows'
  settings, refactor package rules
- **README**: naive-pass mention and settings

## Answered Questions

### Are the two deferred review notes formerly in `.gtd/TODO.md` in scope?

No — the human's sketch replaced them; their removal drops them.

### Does the refactor review use the full review flow (triage, nits, defer)?

Yes — the issue names it a review like the feature one; only the edit route
differs (re-run refactor, not re-plan).

### What happens when a refactor review note needs a path outside the strays?

The guard refuses it; the issue settles it: a wrong refactor means abandon and
restart.
