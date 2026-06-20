# Implement the git/path helper module

## What to build

Fill in `lua/gtd/git.lua` with the git and path-resolution primitives every
feature depends on. Re-implement (fresh, not imported) the proven helper
patterns from `review.nvim`, adapted to gtd's `TODO.md` / `REVIEW.md` files.

This is a thin demoable slice: after this package, the plugin can locate the git
root, resolve `TODO.md` / `REVIEW.md`, run safe git commands, and extract the
review base SHA — exercised by specs.

## Functions to implement (in `lua/gtd/git.lua`)

- `git_command(args, opts)` — run git with safety flags (e.g.
  `-c core.hooksPath=` and any others needed to avoid side effects); return
  stdout/exit code. Provide an async variant if the chosen pattern uses one, but
  a synchronous form usable from specs is required.
- `get_root(path?)` — resolve the git toplevel (`git rev-parse --show-toplevel`)
  for the given path or cwd; return `nil` when not in a repo.
- `get_todo_path(root?)` — resolve `TODO.md` relative to the git root.
- `get_review_path(root?)` — resolve `REVIEW.md` relative to the git root.
- `get_base(lines_or_path)` — parse the `<!-- base: <full-hash> -->` marker out
  of REVIEW.md content and return the full hash (or `nil` if absent).

## Files to create/modify

- `lua/gtd/git.lua` — implement all functions above.
- `tests/` — spec(s) for git/path helpers using the package-01 fixtures.

## Acceptance criteria

- [ ] `git_command` runs git with safety flags and returns
      stdout + exit status; failures are reported (not thrown unhandled).
- [ ] `get_root` returns the toplevel for a path inside a repo and `nil`
      outside one.
- [ ] `get_todo_path` / `get_review_path` resolve the files relative to the git
      root.
- [ ] `get_base` extracts the full hash from `<!-- base: <full-hash> -->` and
      returns `nil` when the marker is missing.
- [ ] Specs cover: base extraction (present + absent), root lookup, and path
      resolution against the fixtures.

## Constraints

- Re-implement fresh for `gtd.nvim`; do not import from `review.nvim`.
- Git invocations must use safety flags (no hooks/side effects).
- Base ref is the SHA inside `<!-- base: <full-hash> -->`, later passed to
  gitsigns `change_base`.
- Keep specs small/composable per repo conventions; use the package-01 test
  framework and fixtures.
