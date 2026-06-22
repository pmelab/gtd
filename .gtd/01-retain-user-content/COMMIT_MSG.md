feat(gtd): retain user-provided content as direct commits before transform

Edit the static review-process and decompose prompts so user-authored
content lands as a real commit before gtd discards or transforms it.

- review-process: insert a step before the reset that commits the reviewer's
  dirty tree verbatim (annotated REVIEW.md, source edits, in-place TODO:
  markers) as `docs(review): record raw feedback for <base>`; the existing
  reset + synthesis commit then run on top.
- decompose: before deleting TODO.md, commit it as `docs(plan): record TODO.md`
  when it is not already in HEAD (untracked or differs), preserving the user's
  plan and its Q&A history on the direct-to-decompose path; no-op in the normal
  new-todo/modified-todo flow.

No state-machine change: commits are classified only by isFixGtd, so the new
docs(...) commits fold as ordinary commits and are never selected as a review
base. Adds cucumber scenarios asserting the emitted prompts carry the new
instructions.
