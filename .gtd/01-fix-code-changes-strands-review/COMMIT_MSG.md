fix(gtd): stop code-changes from committing REVIEW.md

When both a source file and REVIEW.md were dirty, the code-changes leaf fired
(codeDirty sits above reviewModified) and its prompt swept REVIEW.md into the
commit via `git add -A`. On the next run the committed-unmodified REVIEW.md
resolved to await-review instead of review-process, silently stranding the
reviewer's feedback.

The code-changes prompt now unstages REVIEW.md after `git add -A` (same as it
already does for TODO.md), so source edits commit verbatim while REVIEW.md stays
pending for the review-process fold. This matches the codeEntries exclusion in
src/Events.ts, which already drops both TODO.md and REVIEW.md from the "code"
set. Adds a review.feature scenario asserting the emitted prompt commits the
source edit and instructs `git restore --staged REVIEW.md`.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
