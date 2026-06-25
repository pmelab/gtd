# Document that gtd-workflow commits don't re-open a closed review

## Description

Reflect the behavior change from package 01 in `README.md` (per the user's
global rule that significant changes appear in the README): gtd-workflow commits
(`plan(gtd):`, `review(gtd):`, `chore(gtd):`) landing on top of a closed review
do NOT re-open a review — the review frontier advances past them. Only a non-gtd
(real code) commit in `candidate..HEAD` re-opens review.

## Files

- `README.md` — the "Review base" blockquote (~lines 116-121).

## Implementation notes

- Locate the existing **Review base** blockquote:

  > **Review base**: the closest-to-HEAD of {parent-branch merge-base, last
  > `review(gtd):` commit, last `chore(gtd): close approved review` commit},
  > restricted to ancestors of HEAD (computed via `computeReviewBase` — no marker
  > in `REVIEW.md`). When no base exists or `base..HEAD` is empty, there is
  > nothing to review. Because the close commit itself becomes the new base, the
  > run immediately after a close resolves to `verified`.

- Extend it to state that the frontier survives a trailing run of gtd-workflow
  commits: if every commit between the chosen review/close candidate and HEAD is
  a `plan(gtd):` / `review(gtd):` / `chore(gtd):` commit, the frontier is still
  effectively at the candidate and there is nothing to review (so committing a
  fresh `TODO.md` as `plan(gtd): grilling` after a close does not surface a
  spurious `REVIEW.md`). A non-gtd commit in that range re-opens review.

- Keep it concise and consistent with surrounding blockquote prose. Do not
  duplicate into other sections.

## Acceptance criteria

- [ ] The README "Review base" note documents that a trailing run of
      `plan|review|chore(gtd):` commits above the review/close candidate keeps
      the frontier at the candidate (nothing to review).
- [ ] It notes a non-gtd (real code) commit in that range still re-opens review.
- [ ] No other README content is broken; markdown renders cleanly.
- [ ] `npm run test` and `npm run test:e2e` still pass (docs-only change).

## Constraints

- Only edit `README.md`.
- Docs only — no source changes.
