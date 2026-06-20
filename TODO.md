i want to create a neovim plugin that supports editing of TODO.md and REVIEW.md
files from the gtd workflow.

## Plan

Build **`gtd.nvim`**, a **new, standalone** Neovim plugin (Lua, Neovim ≥ 0.10)
that makes editing the gtd workflow's `TODO.md` and `REVIEW.md` files fast. It
lives in its **own repo** (`pmelab/gtd.nvim`), installed via lazy.nvim, and
**coexists with `review.nvim`** — `review.nvim` keeps its own purpose for the
old `.review` file-list format and is **not touched**. `gtd.nvim` re-implements
(rather than ports from a shared module) the proven helper patterns from
`review.nvim`: git command runner, gitsigns base-change, `vim.ui.select`
pickers, checkbox toggle, and lazy/which-key wiring — adapted to the gtd
`TODO.md` and chunked `REVIEW.md` formats.

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

- Open question = a `### ` block inside the `## Open Questions` section.
- Unanswered = the block still contains the literal `<!-- user answers here -->`
  placeholder.

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
- Hunk = a `- [ ] ./path#line` checkbox line (`./` prefix, `#line` is a
  **drifting hint** used only to position the cursor — we accept the drift and
  rely on gitsigns for the authoritative change display).
- Base ref = SHA in `<!-- base: <full-hash> -->`, used for gitsigns
  `change_base`.

### Features

**TODO.md:**

1. **Quick picker for open questions** — `vim.ui.select` over all unanswered
   `### ` questions in `## Open Questions`; selecting one jumps the cursor to
   that question's heading in the TODO.md buffer (opening it if needed). Show
   the question text (and a truncated recommendation) per item. Bound to
   `<leader>gq`.
2. **Open-questions count as lint/error status** — expose
   `require("gtd").open_questions_count()` and a formatted
   `require("gtd").statusline()` (e.g. `"? 3"`, or `""` when zero / no TODO.md)
   that the user wires into their own statusline (no hard dependency on any
   statusline plugin). Also publish one `vim.diagnostic` (WARN) per unanswered
   question on its `###` line in the TODO.md buffer, so it shows in the gutter
   and in any diagnostics-aware statusline for free.
   - **Counting rule:** the count = number of `<!-- user answers here -->`
     occurrences **within the `## Open Questions` section** (matching gtd's own
     `modified-todo.md` contract, which keys off replacing that placeholder).
   - **Scope:** project-wide. Locate `TODO.md` via git-root lookup (independent
     of the current buffer) so the indicator is useful from any buffer. Refresh
     on `BufWritePost */TODO.md` and on `FocusGained` (and a low-frequency timer
     as a fallback). Cache the count keyed by git root so `statusline()` is
     cheap to call on every redraw.

**REVIEW.md:**

3. **Pick review package/chunk** — `vim.ui.select` over all `## ` chunks
   (title + hunk count); selecting jumps to the chunk heading. Bound to
   `<leader>gp`.
4. **Jump to a specific hunk + correct diff** — from a hunk line (or via a
   per-hunk picker), open the referenced file, call
   `gitsigns.change_base(<base from REVIEW.md>, true)` to show the diff vs. the
   review base, and move the cursor to `#line` (best-effort; drift accepted).
   Bound to `gd` (buffer-local) in REVIEW.md.
5. **Checkbox shortcut (write-through)** — toggle `- [ ]` ↔ `- [x]` on the
   current hunk line and `:write` REVIEW.md, so the on-disk file reflects
   progress and the "all hunks checked" state is visible to a later `gtd` run.
   Works on the current hunk line via a buffer-local keymap in REVIEW.md
   (`<leader>gc` / `<cr>`), and best-effort from an arbitrary source buffer by
   checking off that file's hunk(s).

### Keybindings

All defaults under the `<leader>g` ("gtd") prefix; user can override via
`setup({ keys = ... })`. Pickers use `vim.ui.select` (the user's chosen provider
handles UX — no hard snacks/telescope dependency). Buffer-local keymaps are
attached via a `BufEnter`/`FileType` autocmd matching `*/TODO.md` and
`*/REVIEW.md`; global keymaps wire the pickers. which-key/mini.icons niceties
applied when present.

| Action                    | File      | Default                           |
| ------------------------- | --------- | --------------------------------- |
| Pick open question        | TODO.md   | `<leader>gq`                      |
| Pick review package/chunk | REVIEW.md | `<leader>gp`                      |
| Jump to hunk under cursor | REVIEW.md | `gd` (buf-local)                  |
| Toggle checkbox           | REVIEW.md | `<leader>gc` / `<cr>` (buf-local) |

### Implementation notes

Re-implement the following patterns (proven in `review.nvim`, but written fresh
for `gtd.nvim`'s formats — `review.nvim` stays untouched):

- `git_command` — async git runner with safety flags (`-c core.hooksPath=`
  etc.).
- `get_root` — git toplevel; `get_todo_path` / `get_review_path` resolve the
  files relative to root.
- `get_base` — parse `<!-- base: <full-hash> -->` from REVIEW.md.
- `open_file_diff` — open `./path`, `gitsigns.change_base(base, true)`, position
  cursor at `#line` (best-effort).
- `toggle_done` — flip checkbox on a hunk line and write the buffer.
- `pick_open_questions` (TODO.md) and `pick_chunks` (REVIEW.md) —
  `vim.ui.select` wrappers.
- `setup`, `setup_autocmds`, `setup_buffer_keymaps`, `register_icons` — config
  entrypoint, autocmds broadened to `*/TODO.md` and `*/REVIEW.md`, buffer-local
  and global keymaps.

### Module layout (separate repo `pmelab/gtd.nvim`)

```
gtd.nvim/
  lua/gtd/
    init.lua        -- setup, keymaps, autocmds, icons, statusline()
    git.lua         -- git_command, get_root, get_base, path resolution
    todo.lua        -- parse/pick open questions, count, diagnostics
    review.lua      -- parse chunks/hunks, jump+gitsigns, checkbox toggle
  README.md
  tests/            -- mini.test or busted specs per feature
```

### Testing

- Spec per feature: parsing TODO.md open questions (answered vs. unanswered),
  the `<!-- user answers here -->` counting rule, parsing REVIEW.md
  chunks/hunks, checkbox write-through toggle, base extraction.
- Use fixture TODO.md / REVIEW.md files in the exact gtd formats above.
- Keep steps small/composable per the repo conventions where applicable.

## Answered Questions

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
  `setup()`.

Open sub-question for the user: should `gtd.nvim` **supersede** `review.nvim`
(deprecate the old plugin) or coexist?

**Answer:** Do not touch review.nvim — it still has a purpose without gtd.
`gtd.nvim` is a separate plugin that coexists with (does not replace)
`review.nvim`.

### Where does `gtd.nvim` live — this repo, or a separate repo?

**Recommendation:** A **separate repo `pmelab/gtd.nvim`**, mirroring how
`review.nvim` is its own repo and installed via lazy.nvim. This `gtd` repo is a
TypeScript/Effect skill (bun/tsup, vitest, cucumber) and the AGENTS.md testing
conventions here (cucumber.js scenarios) don't map onto a Lua/Neovim plugin.
Bundling Lua into the skill repo would muddy both toolchains.

**Answer:** Agreed — build in a separate repo.

### Diff display for REVIEW.md hunks: reuse gitsigns `change_base`, or render a real diff?

**Recommendation:** Reuse the **gitsigns `change_base` approach** from
`review.nvim` — on jump-to-hunk, open the target file, call
`gitsigns.change_base(base, true)` so inline signs show changes vs. the review
base (the `<!-- base: <full-hash> -->` SHA), then jump the cursor to the hunk
line. This matches the existing UX and avoids reimplementing a diff view.

Caveat the user should weigh: the new `REVIEW.md` hunks carry a **line number**
(`./path#42`) that is explicitly a _drifting hint_, not authoritative. gitsigns
shows live signs regardless, so we use `#line` only to position the cursor
(best-effort).

**Answer:** Agreed — use gitsigns `change_base`, and we accept the line drift
(`#line` is best-effort cursor positioning only).

### Statusline integration: how surfaced, and which statusline plugins?

**Recommendation:** Expose a **public function**
`require("gtd").open_questions_count()` (and a formatted
`require("gtd").statusline()` returning e.g. `"? 3"` / `""` when zero or no
TODO.md) that the user wires into their own statusline. Do **not** hard-depend
on any statusline plugin. Additionally surface the count via `vim.diagnostic` on
the TODO.md buffer (one WARN diagnostic per unanswered question, placed on the
`###` line) so it shows in the gutter and any diagnostics-aware statusline "for
free".

Open sub-question: is the count **global/project-wide** or only when TODO.md is
the active buffer?

**Answer:** Agreed — project-wide via git-root TODO.md lookup, refreshed on
`BufWritePost */TODO.md` (and `FocusGained`/timer fallback).

### What counts as an "open / unanswered" question for the count?

**Recommendation:** A question is **open** iff its `### ` block under
`## Open Questions` still contains the literal `<!-- user answers here -->`
placeholder (unanswered). The count = number of `<!-- user answers here -->`
occurrences within the `## Open Questions` section. This is robust and matches
gtd's own contract (`modified-todo.md` keys off replacing that placeholder).

**Answer:** Agreed — count `<!-- user answers here -->` occurrences within the
`## Open Questions` section.

### Checkbox shortcut on REVIEW.md: write-through to disk, or buffer-only?

**Recommendation:** Toggle the checkbox **in-buffer and `:write`** (mirroring
`review.nvim`'s `M.check`), so the on-disk REVIEW.md reflects progress and the
"all hunks checked" state is visible to a later `gtd` run. Toggle should work on
the current hunk line (`- [ ] ./path#n` ↔ `- [x] ...`) via a buffer-local keymap
in REVIEW.md, and also from an arbitrary source buffer by checking off the
hunk(s) for the current file (best-effort).

**Answer:** Agreed — write-through to disk.

### Keybinding scheme and picker mechanism?

**Recommendation:** Follow `review.nvim`'s conventions:

- Use `vim.ui.select` for all pickers (no hard dependency on snacks/telescope).
- Provide a `lazy_keys()` helper + `setup({ keys = ... })` config table with
  sensible `<leader>`-prefixed defaults, mini.icons/which-key niceties when
  present.
- Buffer-local keymaps in TODO.md / REVIEW.md (detected via autocmd on
  `*/TODO.md` and `*/REVIEW.md`), global keymaps for the pickers.

Proposed default keys:

| Action                    | File      | Default                           |
| ------------------------- | --------- | --------------------------------- |
| Pick open question        | TODO.md   | `<leader>gq`                      |
| Pick review package/chunk | REVIEW.md | `<leader>gp`                      |
| Jump to hunk under cursor | REVIEW.md | `gd` (buf-local)                  |
| Toggle checkbox           | REVIEW.md | `<leader>gc` / `<cr>` (buf-local) |

**Answer:** Agreed — use the `<leader>g` prefix (and keep `gd` for
jump-to-hunk).

### Runtime coexistence with `review.nvim` — do the two plugins collide on keymaps, autocmds, or filetypes?

**Recommendation:** Since `review.nvim` stays installed and active, audit it for
overlapping bindings before settling `gtd.nvim`'s defaults. Two concrete risks:

- **Keymaps:** if `review.nvim` already binds anything under `<leader>g` or a
  buffer-local `gd`, `gtd.nvim`'s defaults would shadow or be shadowed
  (load-order dependent). Recommendation: keep `<leader>g` but make every
  default overridable via `setup({ keys = ... })`, and only set buffer-local
  maps on buffers `gtd.nvim` actually recognizes (a `TODO.md`/`REVIEW.md` whose
  content matches the gtd formats), so non-gtd review buffers are left to
  `review.nvim`.
- **Buffer detection:** `review.nvim` may attach to `*.review` /
  `REVIEW`-pattern buffers. `gtd.nvim` matches `*/TODO.md` and `*/REVIEW.md`
  (uppercase `.md`), which should not overlap the old `.review` file-list format
  — but confirm `review.nvim`'s autocmd patterns don't also grab `REVIEW.md`. If
  they do, gate `gtd.nvim`'s attach on a content sniff (first line `# Review:` +
  a `<!-- base: -->` marker) so only the new chunked format is claimed by
  `gtd.nvim`.

**Answer:** review.nvim will not be active in parallel
