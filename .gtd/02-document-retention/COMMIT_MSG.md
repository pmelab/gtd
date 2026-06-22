docs(gtd): document retain-as-commit behavior in README

Update the states table, the workflow walkthrough, and the Build
orchestration / Decompose section to describe that user-provided content is
retained as a direct commit before gtd transforms or discards it:
review-process commits raw feedback as `docs(review): record raw feedback for
<base>` before reset, and decompose records `TODO.md` as `docs(plan): record
TODO.md` (when not already in HEAD) before deletion.
