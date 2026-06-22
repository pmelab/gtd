feat(gtd): add close-review leaf for approved, no-change reviews

Route a forward-tick-only REVIEW.md edit to a new terminal `close-review`
leaf instead of `review-process`. When the reviewer ticks checkboxes
(`- [ ]` → `- [x]`) with no prose, un-ticks, or source edits, gtd treats it
as "approved as-is" and the close-review prompt discards the ticked working
edits, deletes the committed REVIEW.md, and commits the deletion as
`chore(gtd): close approved review for <short-sha>`.

- add `showHead(path)` git op (`git show HEAD:<path>`) to read committed REVIEW.md
- compute `reviewApprovedNoChanges` in Events.ts (forward-tick-only predicate)
- add the `close-review` leaf + guard, ordered BEFORE `reviewModified` so close
  wins the priority race; tagged auto-advance so the loop re-runs after close
- add `src/prompts/close-review.md` and wire it into Prompt.ts SECTIONS
- replace the contradicting "checkbox-only processed as valid" cucumber scenario
  with the close-review happy path; add un-tick / prose-edit / source-edit
  negatives proving the predicate is strict

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
