feat(gtd): resolve verified after an approved review is closed

Teach `computeReviewBase` to treat the latest
`chore(gtd): close approved review for …` commit as a review-base candidate.
As the closest ancestor of HEAD it wins the tie-break, so `base..HEAD` is empty
on the run after a close and the machine falls through to `verified` instead of
re-triggering a full-branch `human-review`.

- add `lastCloseCommit` git op (grep `^chore(gtd): close approved review for`)
- include the close commit as a candidate in `computeReviewBase`
- add the end-to-end cucumber scenario: after closing, the next run reports
  verified, not a fresh review
- document the close-review leaf and the close commit base candidate in the
  README (state table, review-base note, workflow diagram)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
