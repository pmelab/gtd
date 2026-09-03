# Setup

## Repository requirements

- **Single writer, linear branch.** A process's history is walked via
  **first-parent** commits only.
- **Test/build artifacts must be gitignored.** This is **load-bearing**, not a
  style preference: gtd decides "the check is green" by the working tree going
  clean, and anything `.gitignore` matches is invisible to that decision. If a
  script state's command (or the build it triggers) writes output — a `dist/`, a
  coverage report, a log file — into the working tree, the tree never goes clean
  after a green run and the process cannot advance. Gitignore every path your
  scripts write before wiring gtd into a repo.
- **Repository root invocation.** Every state subcommand must run from the git
  repository root. `--help`/`--version` (and the `help`/`version` subcommands),
  `lsp`, `init`, `visualize`, `check`, and `install` skip this guard entirely
  (`visualize` still reads the `.gtdrc` workflow, but needs no git state; `init`
  may even run outside a repository to seed a shared parent-dir config).
- **Linked worktrees are independent.** N `git worktree` worktrees of one
  repository (sharing a single `.git`) each run their own gtd process, so a
  process underway in one worktree neither blocks nor rewrites any other.

## Editor integration

`gtd lsp` starts an LSP server over stdio for `.gtd/` steering files:

- a symbol per `review`-mode chunk that still has an unchecked hunk (an outline
  of what is left to review), plus check/uncheck actions over those chunks
- go-to-definition from a `review`-mode hunk line into the file it points at, at
  its `#line`
- a document link on a `review`-mode hunk's `./path#line` pointer, clickable
  straight to that file at its `#line` without going through go-to-definition
- symbols over a `qa`-mode file's open questions, plus "pick this option" /
  "uncheck this option" code actions on each option — offered anywhere on the
  option's list item, including wrapped continuation lines
- a "gtd: add a footnote" code action in both formats: it plants a `[^name]`
  marker right after the word your cursor sits in (or at the cursor itself) and
  a seeded definition below the current block, so leaving a footnote never means
  hand-typing the syntax
- go-to-definition on a footnote jumps both ways — marker to definition,
  definition to its first marker's exact column — in both formats, within the
  same file
- live diagnostics for both formats as you edit
- a `gtd.openSteeringFile` command that jumps to the current state's steering
  file, falling back to `.gtd/TODO.md` when the resting state declares none, so
  the keybinding has an answer even before a process has started

The command only names that path — it never creates it — so on a repository that
has never run gtd, `.gtd/` may not exist yet and editors differ on opening a
file whose parent directory is missing. This bites only the very first sketch in
a fresh repository.

Which format a file gets is config-driven via each state's `file:`/`mode:`, with
a fallback to basename dispatch (`REVIEW.md` → `review`) when no config is in
sight.

`qa` and `review` are gtd's two built-in steering-file formats: each has its own
outline, actions, go-to-definition, and a validator gtd implements itself.
Overriding one of their `validate:` commands does not lose the outline or the
actions — those come from the format, not from whoever validates — but `gtd lsp`
never runs a shell command per keystroke, so live diagnostics become one
`Information` notice pointing at `gtd validate` instead. Any other mode name has
no built-in format and gets no live editor support at all; `gtd validate` still
formats and validates it like any other mode.
