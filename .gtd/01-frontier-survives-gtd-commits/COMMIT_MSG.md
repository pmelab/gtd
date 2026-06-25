fix(review): keep review frontier past gtd-workflow commits

A new TODO.md committed as `plan(gtd): grilling` on top of a closed review
wrongly re-opened a review whose only diff was the plan commit. The
frontier-at-HEAD guard in `computeReviewBase` only fired when the review/close
commit equalled HEAD, so any commit landing on top lost the frontier.

Generalize the guard: when every commit in `candidate..HEAD` is a gtd-workflow
commit (`plan|review|chore(gtd):`), treat the frontier as still at the candidate
and return Option.none(). Reuses git.commitSubjects; real code commits still
re-open review.

Adds unit tests and cucumber scenarios covering the regression, the real-code
case, and the mixed case.
