# Jump to hunk + gitsigns diff

## What to build

Implement opening a hunk's target file with the correct diff base shown via
gitsigns `change_base`, and positioning the cursor at the hunk's `#line`
(best-effort). Bound later to buffer-local `gd` in REVIEW.md.

## Functions to implement (in `lua/gtd/review.lua`)

- `open_file_diff(hunk, base)` — open `./path` (the hunk's file, resolved
  relative to git root), call `require("gitsigns").change_base(base, true)` so
  inline signs show changes vs. the review base, then move the cursor to the
  hunk's `#line` (best-effort; drift accepted). Guard gracefully if gitsigns is
  not installed.
- `jump_to_hunk_under_cursor()` — from the current REVIEW.md buffer, read the
  hunk on the cursor line (via `parse_hunk_line` from task 04-01), resolve the
  review base (via `git.get_base` on REVIEW.md), and call `open_file_diff`.

## Files to create/modify

- `lua/gtd/review.lua` — `open_file_diff`, `jump_to_hunk_under_cursor`.
- `tests/` — specs for base resolution + hunk-line → file/line target
  computation (mock or guard the gitsigns/window side effects).

## Acceptance criteria

- [ ] `jump_to_hunk_under_cursor` reads the hunk on the cursor line, derives the
      target file path and `#line`, and resolves the review base from
      `<!-- base: -->`.
- [ ] `open_file_diff` opens the referenced file relative to git root.
- [ ] `gitsigns.change_base(base, true)` is invoked with the parsed base SHA;
      absence of gitsigns is handled gracefully (no crash).
- [ ] Cursor is positioned at the hunk's `#line` (best-effort), and an
      out-of-range `#line` does not error.
- [ ] Specs cover base extraction wiring and target file/line computation from a
      hunk line.

## Constraints

- Reuse gitsigns `change_base` approach (no custom diff renderer). Line drift is
  accepted — `#line` only positions the cursor.
- Base = the `<!-- base: <full-hash> -->` SHA, obtained via `git.get_base`.
- Resolve file paths relative to git root (`./path` → root-relative).
- Depends on package 02 (`git.lua`) and task 04-01 (`parse_hunk_line`,
  `get_base`). Independent of sibling task 04-03 (checkbox toggle).
- The `gd` buffer-local keymap binding is wired in package 05 — expose
  `jump_to_hunk_under_cursor()` here.
- Keep specs small/composable; reuse the package-01 fixture.
