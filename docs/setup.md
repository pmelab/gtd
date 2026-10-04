# Setup

## Prerequisites

Install all three skill sources the bundled workflow names in its prompts — none
is optional, all three are hard prerequisites:

- [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills)
- the ponytail skills from
  [`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail) —
  install only `--skill ponytail --skill ponytail-review`
- joshmanders' `test-audit`, from
  [`joshmanders/dotfiles`](https://github.com/joshmanders/dotfiles) — install
  with `npx -y skills add joshmanders/dotfiles --skill test-audit`

The bundled workflow's build/fix/review steps name skills from these sets in
their prompts instead of spelling out their technique in prose. Without a source
installed, your harness has nothing to load at the steps that name it, and the
prompt carries no prose standing in for it. gtd itself never installs, resolves,
or verifies any of this — a repo can also repoint any step's configured skill
list (`.gtdrc` `skills:`, see below) to name a different set its own harness has
instead, or set it to `[]` to drop the skill names from that step.

**Install the skills, never the ponytail plugin** — its hooks inject into every
turn and bypass the per-step `skills:` key above.

A name missing from a step's configured list is skipped silently and costs
nothing. A missing `qualityReviews` entry does not share that rule — see
[Extending the quality-review lap](#extending-the-quality-review-lap) below. Two
of the three default lenses (`ponytail-review`, `test-audit`) come from sources
a reader has no reason to already have, so the default configuration wastes
turns per quality lap until all three are installed.

### Using a different skill set

Every bundled agent step has its own addressable full name — see
[Configuration](./configuration.md#the-skills-key) for the full list and its
validation rules. Two routes, and they combine:

- **Instead of the bundled set** — repoint the step's `.gtdrc` `skills:` entry.
  It also feeds the `skills` key on `gtd next --json` at that step — a driver
  that reads it can preload the same names (see
  [Writing your own driver](./driver.md)):

  ```yaml
  # .gtdrc — packages.item.building loads your own skill instead of the bundled pair
  skills:
    packages.item.building: [my-org-tdd-skill]
  ```

- **In addition to the bundled set** — there is no append mechanism: an entry
  REPLACES the step's bundled list, it never adds to it. Wanting the bundled
  skills plus your own means writing the whole list — bundled names included —
  into your own value:

  ```yaml
  # .gtdrc — keep the bundled pair, add one more
  skills:
    packages.item.building:
      [test-driven-development, incremental-implementation, my-org-tdd-skill]
  ```

  The cost of this route: a later gtd release that changes
  `packages.item.building`'s bundled default is silently lost to you, because
  your override already replaced it — you keep whatever list you wrote until you
  edit it again.

Both routes share the same safety rules:

- A skill name your harness does not have is skipped silently by the preamble.
  An over-long list costs nothing.
- A skill carrying `disable-model-invocation: true` is skipped just as silently
  — the agent cannot load it at all, only a human can, by slash command. Naming
  one in `skills:` is a no-op with no error. This is the trap most likely to
  bite when picking your own set: check the skill's frontmatter before relying
  on it here.

### Extending the quality-review lap

`qualityReviews` (default `owasp-security, ponytail-review, test-audit`) is a
skill set too, but a different shape from a step's `skills:` entry above: each
entry is its own full turn, not a list handed to one step. Extend it for a
project-specific concern — a company security checklist, a house style skill —
the same way as any other var, via `.gtdrc`:

```yaml
# .gtdrc — keep the bundled trio, add a company checklist
vars:
  qualityReviews:
    owasp-security, ponytail-review, test-audit, acme-security-checklist
```

or, highest precedence, via the matching `GTD_<NAME>` environment variable:

```bash
GTD_QUALITYREVIEWS="owasp-security, ponytail-review, test-audit, acme-security-checklist" gtd next
```

Unlike a step's `skills:` entry, gtd DOES split this one — on every comma, one
lens per entry — because each entry is its own turn rather than one step's skill
list. Keep entries free of commas and of characters that don't belong in a
filename: each trimmed entry becomes part of a queued review file's name. It
does NOT share `skills:`'s "costs nothing" rule for a name your harness lacks:
`reviewing` still burns its own full turn with no lens loaded, since the queue
file exists whether or not anything can load it — a typo costs a whole turn,
silently. Blanking the whole var, in contrast, does switch the lap off outright.

`qualityReviews` and `.gtdrc` `skills: { build.quality.reviewing: [...] }` are a
pair, not alternatives: `qualityReviews` decides how many turns the lap runs
(one per lens, in order); by default, each turn's own skill IS that turn's lens.
A `build.quality.reviewing` entry REPLACES the lens on every one of those turns
with the configured list instead — the prompt body still names which lens the
turn is for, but that lens no longer loads as a skill once overridden. Setting
one without the other is rarely what you want. See
[Configuration](configuration.md) for the cost of extending it.

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
  `lsp`, `init`, `check`, and `install` skip this guard entirely (`lsp` still
  loads `gtd.config.ts`, but needs no git state; `init` may even run outside a
  repository to seed a shared parent-dir config).
- **Linked worktrees are independent.** N `git worktree` worktrees of one
  repository (sharing a single `.git`) each run their own gtd process, so a
  process underway in one worktree neither blocks nor rewrites any other.

## Editor integration

`gtd lsp` starts an LSP server over stdio for `.gtd/` steering files — the files
the steps a process has reached declare, plus those the workflow's `steering`
export lists:

- a symbol per `review`-mode chunk that still has an unchecked hunk (an outline
  of what is left to review), plus check/uncheck actions over those chunks
- go-to-definition from a `review`-mode hunk line into the file it points at, at
  its `#start-end` range
- a document link on a `review`-mode hunk's `./path#start-end` pointer,
  clickable straight to that file at its range without going through
  go-to-definition
- symbols over a `qa`-mode file's open questions, plus "pick this option" /
  "uncheck this option" code actions on each option — offered anywhere on the
  option's list item, including wrapped continuation lines
- a "gtd: add a footnote" code action in both formats: it plants a `[^name]`
  marker at the exact cursor position and an empty definition below the current
  block, with no placeholder text to delete, so leaving a footnote never means
  hand-typing the syntax
- that same action moves the cursor into the new, empty definition so you can
  start typing immediately — the jump needs an editor that supports being asked
  to show a document, but the marker and definition are written either way
- go-to-definition on a footnote jumps both ways — marker to definition,
  definition to its first marker's exact column — in both formats, within the
  same file
- a symbol per footnote thread, nested under the question, option or chunk its
  first marker sits in, saying whether it waits on you or on the agent
- a "gtd: reply" code action on an open thread's marker or anywhere in its
  definition: it appends an empty `- H: ` entry after the last one and puts the
  cursor right after it. It is not offered while the agent is the one to answer
- an `Information` diagnostic on the last entry of every open thread, shown even
  when a shell `validate:` replaces the live diagnostics
- live diagnostics for both formats as you edit, including thread syntax
  (`- H:`/`- A:` entries); an open thread — last entry the agent's — blocks
  landing at the requirements, architecture and review gates
- a `gtd.openSteeringFile` command that jumps to the current step's steering
  file, falling back to `.gtd/TODO.md` when the resting step declares none, so
  the keybinding has an answer even before a process has started

The command only names that path — it never creates it — so on a repository that
has never run gtd, `.gtd/` may not exist yet and editors differ on opening a
file whose parent directory is missing. This bites only the very first sketch in
a fresh repository.

Which format a file gets is config-driven via each step's `file`/`mode`, with a
fallback to basename dispatch (`REVIEW.md` → `review`) when no config is in
sight.

`qa` and `review` are gtd's two built-in steering-file formats: each has its own
outline, actions, go-to-definition, and a validator gtd implements itself.
Overriding one of their `validate:` commands does not lose the outline or the
actions — those come from the format, not from whoever validates — but `gtd lsp`
never runs a shell command per keystroke, so live diagnostics become one
`Information` notice pointing at `gtd validate` instead. Any other mode name has
no built-in format and gets no live editor support at all; `gtd validate` still
formats and validates it like any other mode.
