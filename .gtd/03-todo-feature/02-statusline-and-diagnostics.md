# Open-questions count: statusline + diagnostics

## What to build

Surface the count of unanswered open questions as (a) a public count + formatted
`statusline()` string, and (b) `vim.diagnostic` WARN entries on the TODO.md
buffer. Project-wide, cached, and refreshed on events.

## Functions to implement (mostly in `lua/gtd/todo.lua`, wired into `init.lua`)

- `count_open_questions(root?)` — count = number of `<!-- user answers here -->`
  occurrences **within the `## Open Questions` section** of the project's
  TODO.md (located via `git.get_todo_path`/`get_root`). Cache the count keyed by
  git root.
- `require("gtd").open_questions_count()` — public accessor returning the cached
  count (recompute lazily / on refresh).
- `require("gtd").statusline()` — formatted string, e.g. `"? 3"`, and `""` when
  zero or no TODO.md. Cheap to call on every redraw (reads cache).
- `refresh_count()` — recompute + cache; safe to call from autocmds/timer.
- `publish_diagnostics(bufnr)` — set one `vim.diagnostic` (WARN) per unanswered
  question on its `### ` line in the TODO.md buffer (use a dedicated namespace).

## Files to create/modify

- `lua/gtd/todo.lua` — counting, caching, refresh, diagnostics.
- `lua/gtd/init.lua` — wire `open_questions_count()` / `statusline()` to the real
  implementation (replace package-01 placeholders).
- `tests/` — specs for the counting rule and diagnostic placement.

## Acceptance criteria

- [ ] Count = number of `<!-- user answers here -->` occurrences within
      `## Open Questions` only (placeholders elsewhere are ignored).
- [ ] `open_questions_count()` returns the count; `statusline()` returns `"? N"`
      for N>0 and `""` for N==0 or no TODO.md.
- [ ] Count is cached keyed by git root; `statusline()` reads the cache (no git
      call per redraw).
- [ ] One WARN diagnostic is published per unanswered question, on the question's
      `### ` line, in a dedicated namespace.
- [ ] A `refresh_count()` recomputes and updates the cache and diagnostics.
- [ ] Specs cover the counting rule (in-section vs. out-of-section placeholders)
      and diagnostic line placement.

## Constraints

- Scope is project-wide via git-root TODO.md lookup, independent of the current
  buffer.
- No hard dependency on any statusline plugin; expose plain functions the user
  wires in.
- Caching required so `statusline()` is cheap on every redraw.
- The actual autocmd/timer refresh triggers (`BufWritePost */TODO.md`,
  `FocusGained`, low-frequency timer) are wired in package 05 — expose
  `refresh_count()` here so package 05 can call it. Do not register the autocmds
  in this package.
- Depends on package 02 (`git.lua`). Independent of sibling task
  `01-parse-open-questions.md` (may share parsing helpers but no ordering).
- Keep specs small/composable; reuse the package-01 fixture.
