# Checkbox write-through toggle

## What to build

Implement a write-through checkbox toggle on REVIEW.md hunk lines: flip
`- [ ]` ↔ `- [x]` and `:write` the buffer so the on-disk file reflects progress
(visible to a later `gtd` run). Bound later to `<leader>gc` / `<cr>` (buf-local).

## Functions to implement (in `lua/gtd/review.lua`)

- `toggle_done(bufnr?, lnum?)` — on the current (or given) hunk line in REVIEW.md,
  flip the checkbox state in-buffer and `:write` the buffer. Use
  `parse_hunk_line` (task 04-01) to confirm the line is a hunk; no-op (with a
  gentle message) on non-hunk lines.
- `toggle_done_for_current_file()` — best-effort: from an arbitrary source
  buffer, locate the hunk(s) for that file in REVIEW.md and check them off
  (write-through). Match by the hunk `path` (root-relative).

## Files to create/modify

- `lua/gtd/review.lua` — `toggle_done`, `toggle_done_for_current_file`.
- `tests/` — specs for toggling a hunk line (checked↔unchecked) and the
  by-file checkoff, asserting the resulting buffer/disk content.

## Acceptance criteria

- [ ] `toggle_done` flips `- [ ]` ↔ `- [x]` on a hunk line and writes the buffer
      (write-through to disk).
- [ ] Toggling is idempotent per call (one toggle = one state flip) and preserves
      the rest of the line (`./path#line`).
- [ ] `toggle_done` is a safe no-op on non-hunk lines.
- [ ] `toggle_done_for_current_file` checks off the REVIEW.md hunk(s) matching
      the current file's root-relative path (best-effort) and writes through.
- [ ] Specs assert the toggled checkbox state and that the rest of the line is
      intact.

## Constraints

- Write-through to disk (mirror review.nvim's check behavior): toggle in-buffer
  then `:write`.
- Match hunks by root-relative `path`; from a source buffer the match is
  best-effort.
- Depends on package 02 (`git.lua`) and task 04-01 (`parse_hunk_line`).
  Independent of sibling task 04-02 (jump-to-hunk).
- The `<leader>gc` / `<cr>` buffer-local keymaps are wired in package 05 —
  expose `toggle_done()` here.
- Keep specs small/composable; reuse the package-01 fixture.
