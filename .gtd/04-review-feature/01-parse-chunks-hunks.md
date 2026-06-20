# Parse REVIEW.md chunks/hunks + chunk picker

## What to build

Implement REVIEW.md parsing and the `vim.ui.select` chunk picker in
`lua/gtd/review.lua`. First vertical slice of the REVIEW.md feature: parse →
pick → jump.

## Functions to implement (in `lua/gtd/review.lua`)

- `parse_chunks(lines)` — return a list of chunks. Each chunk:
  `{ title, line, explanation?, hunks = { { path, lnum, line, done }, ... } }`
  where:
  - chunk = a `## ` section (title + heading `line` + optional explanation).
  - hunk = a `- [ ] ./path#line` / `- [x] ./path#line` line; capture `path`
    (strip `./`), `lnum` (the `#line` hint), buffer `line` of the checkbox, and
    `done` (checked or not).
- `parse_hunk_line(line)` — parse a single checkbox line into
  `{ path, lnum, done }` or `nil` if it isn't a hunk line. (Shared helper for
  packages 04-02 and 04-03.)
- `pick_chunks()` — `vim.ui.select` over all `## ` chunks (show title + hunk
  count); on select, open REVIEW.md (via `git.get_review_path`) and jump the
  cursor to the chunk heading line.

## Files to create/modify

- `lua/gtd/review.lua` — `parse_chunks`, `parse_hunk_line`, `pick_chunks`.
- `tests/` — specs for chunk/hunk parsing using the package-01 REVIEW.md fixture.

## Acceptance criteria

- [ ] `parse_chunks` returns one entry per `## ` chunk with `title`, heading
      `line`, and its list of hunks.
- [ ] Each hunk exposes `path` (with `./` stripped), `lnum` (the `#line` hint),
      checkbox buffer `line`, and `done` state.
- [ ] `parse_hunk_line` correctly parses checked/unchecked hunk lines and returns
      `nil` for non-hunk lines.
- [ ] `# Review:` title line and `<!-- base: -->` marker are not mistaken for
      chunks.
- [ ] `pick_chunks` lists all chunks with title + hunk count and jumps to the
      selected chunk heading.
- [ ] Specs cover multi-chunk parsing, mixed checked/unchecked hunks, and the
      hunk-line parser edge cases.

## Constraints

- Use `vim.ui.select` — no hard dependency on snacks/telescope.
- REVIEW.md format: `# Review: <short-hash>`, `<!-- base: <full-hash> -->`,
  `## <Chunk Title>` with `- [ ] ./path/to/file.ts#42` hunks.
- `#line` is a drifting hint (best-effort cursor position later); store it but
  do not treat it as authoritative.
- Locate REVIEW.md via `git.get_review_path`.
- Depends on package 02 (`git.lua`). `parse_hunk_line` is the shared dependency
  consumed by sibling tasks 02/03 — implement it here.
- Keep specs small/composable; reuse the package-01 fixture.
