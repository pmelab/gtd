# 03 — Editor integration offered, not buried in the docs

Appends a new final interview step and a new briefing section. Changes no
command body.

**Files.** `src/Install.ts`, `src/Install.test.ts`.

## Requirement

**PRODUCT.** `gtd lsp` exists and `docs/setup.md` documents it, but the briefing
never mentions it — so an agent that follows the briefing installs four commands
and leaves editor integration undiscovered.

Add a final step: **detect LSP-capable editors** the user actually has (VS Code,
Neovim, Helix, Zed, Emacs — by config directory or binary on `PATH`), and if any
is found, offer to wire `gtd lsp` up.

The offer carries a **brief** explanation, three or four lines, not a copy of
`docs/setup.md`: live diagnostics on `.gtd/` steering files, an outline of what
is left to review, click-to-check review hunks, pick-an-option actions on open
questions, and a `gtd.openSteeringFile` command that jumps to the current
state's file.

**On yes, the agent edits the editor's own config file itself** — it does not
print a snippet and walk away. Integration works without the human touching
anything.

Three guards on that write, because it lands outside the repository in a file
the user shares across every project:

- **Ask first, per editor, and name the exact file** about to change. Silence is
  not consent for a machine-wide config.
- **Merge, never overwrite.** Read the existing config, add only the gtd
  language-server entry, and leave every other key byte-identical.
- **Skip and report when the entry is already present.** A second install must
  not append a duplicate server registration.

Two facts the offer must carry, because both bite on a fresh repo: **`gtd lsp`
never creates `.gtd/`**, so `gtd.openSteeringFile` may point at a path that does
not exist yet before the first sketch; and **`gtd lsp` needs no repository
root** — it is one of the commands that skips the root guard.

When no LSP-capable editor is detected, say nothing and move on. Do not pitch
editor integration to somebody with no editor to integrate.

**Acceptance:** `src/Install.test.ts` asserts the briefing names `gtd lsp`, at
least two detected editors, the `gtd.openSteeringFile` command, and instructs
asking before editing an editor config and merging rather than overwriting it.

## Settled decisions that OVERRIDE the requirement above

**No biases: the briefing names no editor and carries no config recipe.** The
requirement's five-editor detection list is replaced. The briefing states one
procedure instead: **find the editor from the user's own shell configuration** —
`$EDITOR`/`$VISUAL` first, then the shell rc files (`.zshrc`, `.bashrc`,
`.config/fish/config.fish`) for an alias or an export — and **ask them outright
when that turns up nothing or turns up more than one.** Then the agent looks
that editor's LSP configuration format up itself.

**Why.** Five hardcoded recipes in a string constant have no drift detection,
and gtd would ship a wrong VS Code key for months without a single failing test.
A briefing that lists five editors also quietly tells the agent the sixth does
not count.

**The requirement's "at least two detected editors" assertion is dropped, and
that is deliberate.** A test asserting two editor names would pin the exact bias
this decision removes. Nothing else in the requirement changes — all three write
guards, both fresh-repo facts, the brief explanation, and the say-nothing case
stand as written.

**Three facts replace the recipe**, since the briefing hands the lookup over:
the server is started by `gtd lsp`, it speaks LSP over **stdio**, and it applies
to files under `.gtd/`. That is the whole integration contract, identical for
every editor.

**Risk:** the agent looks the config format up and gets it wrong. The three
write guards are the only thing between that and a broken machine-wide config,
which lives outside version control and has no undo. None of them is optional.

**One new constant, `EDITOR_INTEGRATION`**, appended by `renderBriefing()`
between `commandSuite()` and `PREREQUISITES`. It is prose, not code: no editor
detection, no config parsing, and no filesystem read enters `src/Install.ts`.

## Tasks

### Task 1 — Add the `EDITOR_INTEGRATION` briefing section

Paths: `src/Install.ts`

- [ ] `EDITOR_INTEGRATION` is a new constant in the same flat top-level string
      style as `RECOVERY` and `PREREQUISITES`.
- [ ] `renderBriefing()` emits it between `commandSuite()` and `PREREQUISITES`,
      so it reads as a final interview step after the suite is installed.
- [ ] No editor detection, config parsing, or filesystem read is added to
      `src/Install.ts`.

### Task 2 — Editor discovery with no hardcoded editor list

Paths: `src/Install.ts`, `src/Install.test.ts`

- [ ] The section instructs reading the user's shell configuration to find their
      editor: `$EDITOR`/`$VISUAL` first, then the shell rc files (`.zshrc`,
      `.bashrc`, `.config/fish/config.fish`) for an alias or export.
- [ ] The section instructs asking the user outright when that turns up nothing
      or turns up more than one.
- [ ] The section instructs the agent to look the chosen editor's LSP
      configuration format up itself.
- [ ] The briefing names no specific editor and carries no per-editor config
      recipe. A test asserts the briefing does not name VS Code, Neovim, Helix,
      Zed, or Emacs.
- [ ] The section names the three integration facts: started by `gtd lsp`,
      speaks LSP over `stdio`, applies to files under `.gtd/`. A test asserts
      `gtd lsp` and `stdio` both appear.
- [ ] When the shell configuration names no editor and the user names none
      either, the section instructs saying nothing and moving on.

### Task 3 — The brief offer and its two fresh-repo facts

Paths: `src/Install.ts`, `src/Install.test.ts`

- [ ] The explanation is three or four lines, not a copy of `docs/setup.md`.
- [ ] It names live diagnostics on `.gtd/` steering files, an outline of what is
      left to review, click-to-check review hunks, pick-an-option actions on
      open questions, and the `gtd.openSteeringFile` command that jumps to the
      current state's file. A test asserts `gtd.openSteeringFile` appears.
- [ ] The section states `gtd lsp` never creates `.gtd/`, so
      `gtd.openSteeringFile` may point at a path that does not exist yet before
      the first sketch.
- [ ] The section states `gtd lsp` needs no repository root — it is one of the
      commands that skips the root guard.

### Task 4 — The three guards on writing an editor config

Paths: `src/Install.ts`, `src/Install.test.ts`

- [ ] On yes, the agent edits the editor's own config file itself — the section
      does not tell it to print a snippet and walk away.
- [ ] **Ask first, per editor, naming the exact file** about to change. A test
      asserts the briefing instructs asking before editing an editor config.
- [ ] **Merge, never overwrite** — read the existing config, add only the gtd
      language-server entry, leave every other key byte-identical. A test
      asserts the briefing instructs merging rather than overwriting.
- [ ] **Skip and report when the entry is already present**, so a second install
      never appends a duplicate server registration.
- [ ] A malformed existing config (unparseable JSON, a TOML syntax error) is a
      stop-and-report, not a rewrite: name the file that could not be parsed and
      leave it untouched.
