i want to create a neovim plugin that supports editing of TODO.md and REVIEW.md
files from the gtd workflow.

## Open Questions

### New plugin (`gtd.nvim`) vs. extend the existing `review.nvim`?

**Recommendation:** Create a **new plugin `gtd.nvim`** rather than extending
`review.nvim`. Reasoning:

- `review.nvim` (at `~/.local/share/nvim/lazy/review.nvim`) targets the **old
  `.review` file-list format** (`- [ ] M path/to/file`), not the current
  `REVIEW.md` chunked-hunk format (`# Review: <hash>`, `## <Chunk>`,
  `- [ ] ./path#line`). Its parsing (`open_file_diff`, `pick_unchecked`,
  `check`) is hard-coded to that format.
- The new plugin must also cover `TODO.md` (open questions picker + statusline),
  which is out of scope for a "review" plugin name.
- A clean `gtd.nvim` lets us model both files coherently and ship a single
  `setup()`. We can lift the proven gitsigns/picker/checkbox helpers from
  `review.nvim` (see below) rather than starting from zero.

Open sub-question for the user: should `gtd.nvim` **supersede** `review.nvim`
(deprecate the old plugin) or coexist? Recommendation: supersede — port the
useful bits, then archive `review.nvim`.

<!-- user answers here -->

### Where does `gtd.nvim` live — this repo, or a separate repo?

**Recommendation:** A **separate repo `pmelab/gtd.nvim`**, mirroring how
`review.nvim` is its own repo and installed via lazy.nvim. This `gtd` repo is a
TypeScript/Effect skill (bun/tsup, vitest, cucumber) and the AGENTS.md testing
conventions here (cucumber.js scenarios) don't map onto a Lua/Neovim plugin.
Bundling Lua into the skill repo would muddy both toolchains.

If the user instead wants it **in this repo** (e.g. under `nvim/` or
`editor/gtd.nvim/`), say so and the plan changes to add a Lua subtree plus
`busted`/`mini.test` config here. Default assumption: separate repo, and the
work-package decomposition will target that new repo's layout.

<!-- user answers here -->

### Diff display for REVIEW.md hunks: reuse gitsigns `change_base`, or render a real diff?

**Recommendation:** Reuse the **gitsigns `change_base` approach** from
`review.nvim` — on jump-to-hunk, open the target file, call
`gitsigns.change_base(base, true)` so inline signs show changes vs. the review
base (the `<!-- base: <full-hash> -->` SHA), then jump the cursor to the hunk
line. This matches the existing UX and avoids reimplementing a diff view.

Caveat the user should weigh: the new `REVIEW.md` hunks carry a **line number**
(`./path#42`) that is explicitly a _drifting hint_, not authoritative. gitsigns
shows live signs regardless, so we use `#line` only to position the cursor
(best-effort). If a richer side-by-side diff is wanted (e.g. `diffview.nvim`),
that's a larger dependency — recommend deferring it as a follow-up.

<!-- user answers here -->

### Statusline integration: how surfaced, and which statusline plugins?

**Recommendation:** Expose a **public function**
`require("gtd").open_questions_count()` (and a formatted
`require("gtd").statusline()` returning e.g. `"? 3"` / `""` when zero or no
TODO.md) that the user wires into their own statusline. Do **not** hard-depend
on any statusline plugin. Additionally surface the count via `vim.diagnostic` on
the TODO.md buffer (one WARN diagnostic per unanswered question, placed on the
`###` line) so it shows in the gutter and any diagnostics-aware statusline "for
free" — this is the "linting/error status" the sketch asks for.

Open sub-question: is the count **global/project-wide** (read TODO.md from git
root regardless of current buffer) or only when TODO.md is the active buffer?
Recommendation: project-wide via git-root lookup, refreshed on
`BufWritePost TODO.md` and a timer/`FocusGained`, so the indicator is useful
from any buffer.

<!-- user answers here -->

### What counts as an "open / unanswered" question for the count?

**Recommendation:** A question is **open** iff its `### ` block under
`## Open Questions` still contains the literal `<!-- user answers here -->`
placeholder (unanswered). Once the user replaces that comment with prose, it's
answered (pending the next gtd run that moves it to `## Answered Questions`).
The count = number of `<!-- user answers here -->` occurrences within the
`## Open Questions` section. This is robust and matches gtd's own contract
(`modified-todo.md` keys off replacing that placeholder).

<!-- user answers here -->

### Checkbox shortcut on REVIEW.md: write-through to disk, or buffer-only?

**Recommendation:** Toggle the checkbox **in-buffer and `:write`** (mirroring
`review.nvim`'s `M.check`), so the on-disk REVIEW.md reflects progress and the
"all hunks checked" state is visible to a later `gtd` run. Toggle should work on
the current hunk line (`- [ ] ./path#n` ↔ `- [x] ...`) via a buffer-local keymap
in REVIEW.md, and also from an arbitrary source buffer by checking off the
hunk(s) for the current file (best-effort, like the old `check`).

<!-- user answers here -->

### Keybinding scheme and picker mechanism?

**Recommendation:** Follow `review.nvim`'s conventions:

- Use `vim.ui.select` for all pickers (no hard dependency on snacks/telescope;
  the user's chosen `vim.ui.select` provider handles UX).
- Provide a `lazy_keys()` helper + `setup({ keys = ... })` config table with
  sensible `<leader>`-prefixed defaults, mini.icons/which-key niceties when
  present (port `register_icons`/buffer-local keymap logic).
- Buffer-local keymaps in TODO.md / REVIEW.md (detected via `BufEnter` autocmd
  on `*/TODO.md` and `*/REVIEW.md`), global keymaps for the pickers.

Proposed default keys (user can override):

| Action                        | File      | Default                           |
| ----------------------------- | --------- | --------------------------------- |
| Pick open question            | TODO.md   | `<leader>gq`                      |
| Jump to question under cursor | TODO.md   | (picker only)                     |
| Pick review package/chunk     | REVIEW.md | `<leader>gp`                      |
| Jump to hunk under cursor     | REVIEW.md | `gd` (buf-local)                  |
| Toggle checkbox               | REVIEW.md | `<leader>gc` / `<cr>` (buf-local) |

Confirm the prefix (`<leader>g` for "gtd") and whether to keep `gd` for
jump-to-hunk (consistent with `review.nvim`).

<!-- user answers here -->

## Plan

Build **`gtd.nvim`**, a Neovim plugin (Lua, Neovim ≥ 0.10) that makes editing
the gtd workflow's `TODO.md` and `REVIEW.md` files fast. It ports the proven
helpers from `review.nvim` (git command runner, gitsigns base-change, picker,
checkbox toggle, lazy/which-key wiring) and adds gtd-specific TODO.md and the
new chunked REVIEW.md support.

### File formats the plugin parses

**TODO.md** (gtd plan file):

```markdown
## Open Questions

### <one-line question>

**Recommendation:** <answer + reasoning>

<!-- user answers here -->        <- unanswered marker

## <plan body ...>

## Answered Questions
```

- Open question = a `### ` block inside `## Open Questions`.
- Unanswered = still contains `<!-- user answers here -->`.

**REVIEW.md** (gtd review file, current chunked format):

```markdown
# Review: <short-hash>

<!-- base: <full-hash> -->

## <Chunk Title>

<explanation>

- [ ] ./path/to/file.ts#42
- [ ] ./path/to/file.ts#99

## <Another Chunk Title>

...
```

- Review package / chunk = a `## ` section with title + explanation + hunks.
- Hunk = a `- [ ] ./path#line` checkbox line (`./` prefix, `#line` is a drifting
  hint used only to position the cursor).
- Base ref = SHA in `<!-- base: <full-hash> -->`, used for gitsigns
  `change_base`.

### Features

**TODO.md:**

1. **Quick picker for open questions** — `vim.ui.select` over all unanswered
   `### ` questions in `## Open Questions`; selecting one jumps the cursor to
   that question's heading in the TODO.md buffer (opening it if needed). Show
   the question text (and maybe a truncated recommendation) per item.
2. **Open-questions count as lint/error status** — expose
   `open_questions_count()` / `statusline()` and publish one `vim.diagnostic`
   (WARN) per unanswered question on its `###` line in the TODO.md buffer.
   Project-wide count via git-root TODO.md lookup, refreshed on write/focus.

**REVIEW.md:**

3. **Pick review package/chunk** — `vim.ui.select` over all `## ` chunks
   (title + hunk count); selecting jumps to the chunk heading.
4. **Jump to a specific hunk + correct diff** — from a hunk line (or via a
   per-hunk picker), open the referenced file, call
   `gitsigns.change_base(<base from REVIEW.md>, true)` to show the diff vs. the
   review base, and move the cursor to `#line` (best-effort).
5. **Checkbox shortcut** — toggle `- [ ]` ↔ `- [x]` on the current hunk line and
   `:write` REVIEW.md (port `toggle_done`/`check`). Optionally check off the
   current source file's hunks from a source buffer.

### Implementation notes (ported / adapted from review.nvim)

- `git_command` async runner with safety flags — reuse as-is.
- `get_root`, `get_review_path` (→ also `get_todo_path`), `get_base` (parse
  `<!-- base: -->`) — reuse, generalize.
- `open_file_diff` → adapt for `./path#line` hunk format + cursor positioning.
- `toggle_done` / `check` → adapt to hunk lines; add TODO.md question handling.
- `pick_*` → add `pick_open_questions` and `pick_chunks`.
- `lazy_keys`, `register_icons`, `setup_buffer_keymaps`, `setup_autocmds`,
  `setup` — reuse; broaden autocmd patterns to `*/TODO.md` and `*/REVIEW.md`.

### Module layout (proposed, separate repo)

```
gtd.nvim/
  lua/gtd/
    init.lua        -- setup, keymaps, autocmds, icons
    git.lua         -- git_command, get_root, get_base
    todo.lua        -- parse/pick open questions, count, diagnostics
    review.lua      -- parse chunks/hunks, jump+gitsigns, checkbox
  README.md
  tests/            -- mini.test or busted specs per feature
```

### Testing

- Spec per feature: parsing TODO.md open questions (answered vs. unanswered),
  counting, parsing REVIEW.md chunks/hunks, checkbox toggle, base extraction.
- Use fixture TODO.md / REVIEW.md files in the exact gtd formats above.
- Keep steps small/composable per the repo conventions where applicable.

## Answered Questions
