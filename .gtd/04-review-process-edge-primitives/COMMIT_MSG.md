feat(gtd): add edge primitives for review-process

Introduce the building blocks for the edge-driven review-process flow,
without wiring them yet.

- Git.ts: add `recordAndRevertReview(base)` — commit verbatim feedback,
  capture its diff, `git revert --no-edit`, `git rm REVIEW.md`, close-commit;
  on revert conflict `git revert --abort` + fail. Returns `{ diff, recordSha }`.
- Prompt.ts/State.ts: extend `PromptOverride` with a `review-process` kind
  carrying the diff + record-sha; `buildPrompt` renders it like a normal leaf
  (section + fenced diff + auto-advance), not as the fix-tests collapse.

main.ts wiring and the slimmed prompt land in the next package.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
