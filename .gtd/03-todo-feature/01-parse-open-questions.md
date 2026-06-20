# Parse open questions + quick picker

## What to build

Implement TODO.md open-question parsing and the `vim.ui.select` picker in
`lua/gtd/todo.lua`. This is the first vertical slice of the TODO.md feature:
parse → pick → jump.

## Functions to implement (in `lua/gtd/todo.lua`)

- `parse_open_questions(lines)` — return a list of open-question items found in
  the `## Open Questions` section. Each item: `{ title, line, answered,
  recommendation? }` where:
  - title = the `### ` heading text, `line` = its 1-based line number.
  - answered = whether the `### ` block still contains the literal
    `<!-- user answers here -->` placeholder (contains placeholder ⇒ unanswered).
  - optionally a truncated `recommendation` (from `**Recommendation:**`).
  - Only `### ` blocks **inside** `## Open Questions` count; stop at the next
    `## ` heading (e.g. `## Answered Questions`).
- `pick_open_questions()` — `vim.ui.select` over unanswered questions; show
  title + truncated recommendation per item; on select, open TODO.md (locate via
  `git.get_todo_path`, opening the buffer if needed) and move the cursor to that
  question's `### ` heading line.

## Files to create/modify

- `lua/gtd/todo.lua` — `parse_open_questions`, `pick_open_questions`.
- `tests/` — specs for parsing (answered vs. unanswered, section boundary) using
  the package-01 TODO.md fixture.

## Acceptance criteria

- [ ] `parse_open_questions` returns one item per `### ` block under
      `## Open Questions`, with correct `title` and `line`.
- [ ] Blocks containing `<!-- user answers here -->` are flagged unanswered;
      blocks without it are flagged answered.
- [ ] `### ` blocks outside `## Open Questions` (e.g. under
      `## Answered Questions`) are excluded.
- [ ] `pick_open_questions` lists only unanswered questions, shows
      title + truncated recommendation, and jumps the cursor to the selected
      heading (opening TODO.md if needed).
- [ ] Specs cover answered/unanswered detection and the section boundary.

## Constraints

- Use `vim.ui.select` — no hard dependency on snacks/telescope.
- Locate TODO.md project-wide via `git.get_todo_path` (git-root), independent of
  the current buffer.
- Counting/answered contract keys off the literal `<!-- user answers here -->`
  placeholder (matches gtd's `modified-todo.md` contract).
- Depends on package 02 (`git.lua`). No dependency on the sibling task
  (`02-statusline-and-diagnostics.md`) — both build on parsing independently.
- Keep specs small/composable; reuse the package-01 fixture.
