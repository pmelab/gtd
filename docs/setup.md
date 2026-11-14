# Setup

The skills an agent turn loads are the workflow's: it names them, and the
machine running the agent must have them installed.

## Repository requirements

- **Single writer, linear branch.** A process's history is walked via
  **first-parent** commits only.
- **Test/build artifacts must be gitignored.** This is **load-bearing**, not a
  style preference: gtd decides "the check is green" by the working tree going
  clean, and anything `.gitignore` matches is invisible to that decision. If a
  `run` step's command (or the build it triggers) writes output — a `dist/`, a
  coverage report, a log file — into the working tree, the tree never goes clean
  after a green run and the process cannot advance. Gitignore every path your
  scripts write before wiring gtd into a repo.
- **Repository root invocation.** Every state subcommand must run from the git
  repository root. `--help`/`--version` (and the `help`/`version` subcommands),
  `lsp`, `check`, and `install` skip this guard entirely (`lsp` asks
  `gtd next --json` at the repository root itself).
- **Linked worktrees are independent.** N `git worktree` worktrees of one
  repository (sharing a single `.git`) each run their own gtd process, so a
  process underway in one worktree neither blocks nor rewrites any other.

## Editor integration

`gtd lsp` starts an LSP server over stdio for the [steering file](./steering.md)
the step the process rests on declares:

- a symbol per widget, with one child per checkbox
- code actions on a widget's checkboxes: "gtd: pick this option" on a 🔘 option,
  "gtd: write a custom answer" on its ✏️ item, "gtd: tick" / "gtd: untick" on a
  ☑️ option, a ❔ box or a 🔍 hunk, and "gtd: tick every hunk" on a 🔍 heading
- go-to-definition from a 🔍 hunk pointer into the file it points at, at its
  `#start-end` range, and a document link on the pointer itself
- a "gtd: add an annotation" code action anywhere in the file: it plants a
  `[^name]` marker at the end of the line and an empty note below the current
  block, and moves the cursor into the note — the jump needs an editor that
  supports being asked to show a document, but the marker and note are written
  either way
- go-to-definition on an annotation jumps both ways — marker to note, note to
  its first marker's exact column
- live diagnostics as you edit: every broken widget, and every single select or
  review checklist still unanswered — the same checks `gtd land` applies
- a `gtd.openSteeringFile` command that jumps to the current step's steering
  file, falling back to `.gtd/TODO.md` when the resting step declares none, so
  the keybinding has an answer even before a process has started

The command only names that path — it never creates it — so on a repository that
has never run gtd, `.gtd/` may not exist yet and editors differ on opening a
file whose parent directory is missing. This bites only the very first sketch in
a fresh repository.

Which file is a steering file comes from the resting step, read the way any
driver reads it: `gtd next --json`'s `file`. Any other file gets nothing, and so
does a file from any repository other than the one the editor's workspace
belongs to: asking `gtd next` there would run that repository's `gtd.config.ts`.
