feat(review): chunk picker, hunk jump via gitsigns, and checkbox toggle

Implement lua/gtd/review.lua: parse_chunks/parse_hunk_line + vim.ui.select chunk
picker; open_file_diff/jump_to_hunk_under_cursor that opens the target file,
applies gitsigns change_base against the REVIEW.md base, and positions the cursor
at the (drifting) #line; and toggle_done/toggle_done_for_current_file write-through
checkbox toggling. Covered by specs against the REVIEW.md fixture.
