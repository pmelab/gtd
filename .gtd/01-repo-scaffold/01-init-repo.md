# Initialize the `gtd.nvim` repository skeleton

## What to build

Bootstrap a brand-new, standalone Neovim plugin repo `pmelab/gtd.nvim` (Lua,
Neovim ≥ 0.10). This repo does **not** yet exist — create it from scratch. It is
a separate repo from this `gtd` skill repo; do not bundle Lua into the
TypeScript/Effect skill.

Set up the module layout, a no-op `setup()` entrypoint, a test harness, and a
README stub so later packages have something to attach features to. No features
yet — just a loadable plugin that other packages extend.

## Files to create (in the new `gtd.nvim/` repo)

- `lua/gtd/init.lua` — `M.setup(opts)` that merges a default config table and
  stores it; exports placeholder `M.statusline()` returning `""` and
  `M.open_questions_count()` returning `0`. No keymaps/autocmds yet.
- `lua/gtd/git.lua` — empty module table `local M = {} ... return M` (filled in
  package 02).
- `lua/gtd/todo.lua` — empty module table (filled in package 03).
- `lua/gtd/review.lua` — empty module table (filled in package 04).
- `tests/` — test harness scaffolding (mini.test or busted; pick one and keep it
  consistent across all packages) plus a `tests/fixtures/` dir.
- `tests/fixtures/TODO.md` and `tests/fixtures/REVIEW.md` — fixture files in the
  exact gtd formats (see constraints) for downstream specs to consume.
- `README.md` — stub: plugin name, one-line purpose, lazy.nvim install snippet,
  placeholder feature/keymap table.
- `.gitignore` — ignore typical Neovim/Lua test artifacts.

## Acceptance criteria

- [ ] New repo `gtd.nvim` exists with the module layout
      (`lua/gtd/{init,git,todo,review}.lua`, `README.md`, `tests/`).
- [ ] `require("gtd").setup({})` loads without error on Neovim ≥ 0.10.
- [ ] `require("gtd").statusline()` returns `""` and
      `require("gtd").open_questions_count()` returns `0` (placeholders).
- [ ] Default config table is defined and user opts are merged over it
      (deep-merge), including a `keys` sub-table placeholder.
- [ ] A test runner is wired up and a trivial smoke test (plugin loads) passes.
- [ ] `tests/fixtures/TODO.md` contains a `## Open Questions` section with at
      least one unanswered (`<!-- user answers here -->`) and one answered `### `
      question, plus an `## Answered Questions` section.
- [ ] `tests/fixtures/REVIEW.md` contains `# Review: <hash>`,
      `<!-- base: <full-hash> -->`, and ≥ 2 `## ` chunks each with `- [ ] ./path#line`
      hunks (mix of checked/unchecked).
- [ ] README documents the lazy.nvim install and a placeholder keymap table.

## Constraints

- Neovim ≥ 0.10, pure Lua, installable via lazy.nvim.
- Coexists with `review.nvim`; do **not** reference or modify `review.nvim`.
- TODO.md format: open question = `### ` block under `## Open Questions`;
  unanswered = block contains literal `<!-- user answers here -->`.
- REVIEW.md format: `# Review: <short-hash>`, `<!-- base: <full-hash> -->`,
  `## <Chunk Title>` sections with `- [ ] ./path/to/file.ts#42` hunk lines.
- Re-implement patterns fresh; do not import from `review.nvim`.
- Pick the test framework here (mini.test or busted) and use it for all later
  packages.
