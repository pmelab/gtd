# Setup

## Prerequisites

Install [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills)
— the bundled workflow's build/fix/review states name skills from this set
(`skills:` in a state's prompt) instead of spelling out their technique in
prose. This is a real prerequisite, not an optional boost: without it installed,
your harness has nothing to load at those states, and the prompt no longer
carries the prose that used to stand in for it. gtd itself never installs,
resolves, or verifies this — a repo can also repoint any of the bundled
`*Skills` config vars to name a different set its own harness has instead.
Blanking the `skillsPreamble` var turns the skill names off but does not restore
the deleted prose.

### Using a different skill set

Two routes, and they combine:

- **Instead of the bundled set** — repoint the `*Skills` var for the state you
  want to change. There are nine: `triageSkills`, `architectureSkills`,
  `decomposeSkills`, `buildSkills`, `fixSkills`, `reviewFixSkills`,
  `reviewSkills`, `specReviewSkills`, `escalateSkills`. Each is an ordinary
  workflow var, overridable per repo via `.gtdrc`:

  ```yaml
  # .gtdrc — build states load your own skill instead of the bundled pair
  vars:
    buildSkills: my-org-tdd-skill
  ```

  or, highest precedence, via the matching `GTD_<NAME>` environment variable:

  ```bash
  GTD_BUILDSKILLS="my-org-tdd-skill" gtd next
  ```

- **In addition to the bundled set** — declare `skills:` on any `prompt` state
  in your own workflow; the field is not reserved to the bundled twelve. There
  is no append mechanism: an override REPLACES the var's default, it never adds
  to it. Wanting the bundled skills plus your own means writing the whole list —
  bundled names included — into your own value:

  ```yaml
  # .gtdrc — keep the bundled pair, add one more
  vars:
    buildSkills:
      test-driven-development, incremental-implementation, my-org-tdd-skill
  ```

  The cost of this route: a later gtd release that changes `buildSkills`'
  bundled default is silently lost to you, because your override already
  replaced it — you keep whatever list you wrote until you edit it again.

Both routes share the same safety rules:

- The value is prose gtd never splits or validates — a comma-separated list is
  convention only, not a parsed format.
- A skill name your harness does not have is skipped silently by the preamble.
  An over-long list costs nothing.
- A skill carrying `disable-model-invocation: true` is skipped just as silently
  — the agent cannot load it at all, only a human can, by slash command. Naming
  one in a `*Skills` var is a no-op with no error. This is the trap most likely
  to bite when picking your own set: check the skill's frontmatter before
  relying on it here.

### Extending the quality-review lap

`qualityReviews` (default `owasp-security, code-simplification`) is a skill set
too, but a different shape from the `*Skills` vars above: each entry is its own
full turn, not a list handed to one state. Extend it for a project-specific
concern — a company security checklist, a house style skill — the same way as
any other var, via `.gtdrc`:

```yaml
# .gtdrc — keep the bundled pair, add a company checklist
vars:
  qualityReviews: owasp-security, code-simplification, acme-security-checklist
```

or, highest precedence, via the matching `GTD_<NAME>` environment variable:

```bash
GTD_QUALITYREVIEWS="owasp-security, code-simplification, acme-security-checklist" gtd next
```

Unlike the `*Skills` vars, gtd DOES split this one — on every comma, one lens
per entry — because each entry is its own turn rather than prose handed verbatim
to one state: it is the `var:` source of an `each:` loop (see
[Configuration](configuration.md)), one pass through `reviewing` per trimmed
entry, entry order preserved. It does NOT share the `*Skills` vars' "costs
nothing" rule for a name your harness lacks: `reviewing` still burns its own
full turn with no lens loaded, since nothing checks a lens name against what
your harness can actually load before that turn starts — a typo costs a whole
turn, silently. Blanking the whole var, in contrast, does switch the lap off
outright. See [Configuration](configuration.md) for the cost of extending it.

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
