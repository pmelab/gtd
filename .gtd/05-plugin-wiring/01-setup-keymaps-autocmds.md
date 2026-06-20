# Wire setup: keymaps, autocmds, refresh triggers, icons, README

## What to build

Tie all features together in `lua/gtd/init.lua`: configurable `setup()`, global
+ buffer-local keymaps, the autocmd that attaches buffer-local maps and refreshes
the count, optional icon/which-key niceties, and final README/docs. This is the
package that makes the plugin usable end-to-end from a lazy.nvim install.

## What to implement (in `lua/gtd/init.lua`)

- `setup(opts)` — merge user opts over defaults, including an overridable `keys`
  table (defaults below); register global keymaps, autocmds, icons; kick off the
  initial count refresh.
- `lazy_keys()` — helper returning the lazy.nvim `keys` spec for the global
  pickers.
- `setup_autocmds()` —
  - `BufEnter`/`FileType` matching `*/TODO.md` and `*/REVIEW.md` → attach
    buffer-local keymaps for the right file.
  - `BufWritePost */TODO.md` + `FocusGained` + a low-frequency timer fallback →
    call `todo.refresh_count()` (and refresh diagnostics on the TODO.md buffer).
- `setup_buffer_keymaps(bufnr)` — attach the buffer-local maps per file type.
- `register_icons()` — mini.icons / which-key niceties only when those plugins
  are present (no hard dependency).

## Default keymaps

| Action                    | File      | Default                           |
| ------------------------- | --------- | --------------------------------- |
| Pick open question        | TODO.md   | `<leader>gq` (global)             |
| Pick review package/chunk | REVIEW.md | `<leader>gp` (global)             |
| Jump to hunk under cursor | REVIEW.md | `gd` (buffer-local)               |
| Toggle checkbox           | REVIEW.md | `<leader>gc` / `<cr>` (buf-local) |

`<leader>gq` → `todo.pick_open_questions`; `<leader>gp` → `review.pick_chunks`;
`gd` → `review.jump_to_hunk_under_cursor`; `<leader>gc` / `<cr>` →
`review.toggle_done`.

## Files to create/modify

- `lua/gtd/init.lua` — `setup`, `lazy_keys`, `setup_autocmds`,
  `setup_buffer_keymaps`, `register_icons`.
- `README.md` — finalize: install (lazy.nvim), config table (`keys` overrides),
  full feature + keymap table, statusline wiring example (`require("gtd").statusline()`),
  diagnostics note.
- `tests/` — spec(s) asserting keymaps/autocmds are registered with the default
  config and that overrides via `setup({ keys = ... })` take effect.

## Acceptance criteria

- [ ] `setup()` merges defaults with user opts; every default key is overridable
      via `setup({ keys = ... })`.
- [ ] Global `<leader>gq` and `<leader>gp` invoke the TODO/REVIEW pickers.
- [ ] Buffer-local maps attach via an autocmd on `*/TODO.md` / `*/REVIEW.md`:
      `gd` (jump), `<leader>gc` / `<cr>` (toggle) in REVIEW.md.
- [ ] `BufWritePost */TODO.md`, `FocusGained`, and a low-frequency timer trigger
      `todo.refresh_count()` and diagnostics refresh.
- [ ] icon/which-key integration is applied only when those plugins are present
      (no hard dependency); plugin works without them.
- [ ] README documents install, configurable keys, statusline wiring, and the
      full keymap table.
- [ ] Specs confirm default keymap/autocmd registration and `keys` overrides.

## Constraints

- `<leader>g` prefix; `gd` kept for jump-to-hunk. All keys overridable.
- `vim.ui.select` for pickers; no hard snacks/telescope/statusline dependency.
- Buffer-local maps only on recognized `*/TODO.md` / `*/REVIEW.md` buffers.
- Depends on packages 02, 03, and 04 (all feature functions must exist).
- Per global CLAUDE.md: ensure every significant change is reflected in the
  README.
