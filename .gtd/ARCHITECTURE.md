# Architecture

Three packages, all of them **text edits to `src/Install.ts` and assertions in
`src/Install.test.ts`**, plus a four-line rename in `docs/driver.md`. No engine
surface changes: `gtd install` still prints a briefing and writes nothing, no
new CLI flag, no new subcommand, no new dependency. Every behaviour the briefing
asks for already exists — `gtd --entry`, `GTD_<NAME>` var overrides, `gtd lsp`,
`gtd next --json=file` — so this is knowledge, not code.

## Open Questions

### Does the briefing carry per-editor LSP config recipes, or name the editors and leave the recipe to the agent?

- [ ] **Carry a recipe per editor** — the briefing names each of the five
      editors' config file and the exact key to merge (VS Code `settings.json`,
      Neovim `lspconfig` snippet, Helix `languages.toml`, Zed `settings.json`,
      Emacs `eglot`). Deterministic, testable by name, but five recipes to keep
      correct as editors change theirs, in a file with no way to detect drift.
- [ ] **Name the editors, delegate the recipe** — the briefing lists the five
      editors and their detection probes, states the command is `gtd lsp` over
      stdio for `.gtd/` files, and requires ask-then-merge; the agent works out
      that editor's config format itself. Shorter and never stale, but an agent
      with a wrong idea of Neovim config writes a broken entry.
- [ ] _your answer_

### How does the briefing tell the agent which real model names to offer per tier?

- [ ] **A per-CLI hint table** — the briefing names the concrete heavier/cheaper
      tiers per probed CLI. The agent can propose without asking in the common
      case; the table is stale the day a vendor renames a model, and gtd
      releases lag model releases by months.
- [ ] **No table, always derive at install time** — the briefing tells the agent
      to get the model list from the chosen CLI itself (its `--help`, its docs,
      its config) and to ASK the user per tier whenever the mapping is not
      obvious. Never stale, but every install pays an extra interview round.
- [ ] _your answer_

## Answered Questions

Everything below was settled upstream and is carried forward unchanged; the
entries after the rule are this pass's own technical decisions.

### Existing `~/.local/bin/gtd-loop` installs — rename in place, or leave both?

Neither: the briefing does nothing about `gtd-loop` at all. It never deletes it,
never renames it, and never mentions migrating it. The human will run the
install later and clean up by hand.

### Do `gtd-review` and `gtd-fix` drive the process, or only start it?

Start then drive. Each runs its `--entry` script and then `exec`s `gtd-build`,
so a review or a fix is one invocation.

### Where do the resolved model names get written?

`GTD_PLANNERMODEL`/`GTD_CODERMODEL` exports inside `gtd-build` — per machine,
never committed, so one person's model choice binds nobody else.

### Does the LSP step write editor config, or print a snippet?

Write it, after asking. The agent edits the detected editor's config file
itself, so integration works without the human touching anything.

### Which agent CLIs does the briefing probe for?

Probe `PATH` for a known list — `claude`, `codex`, `gemini`, `cursor-agent`,
`aider`, `opencode`, `amp` — present the hits, and still ask, defaulting to
`claude`. A fixed list plus an ask beats guessing, and an unknown CLI the user
names by hand is always accepted.

### Does `gtd-edit` change?

No. The name, the path, and the body stay as they are; it joins the suite
unchanged. The sketch lists it because the suite must be described as a whole,
not because it needs work.

### Is `gtd-review`'s commitish argument required?

Yes — `gtd-review` with no argument prints usage and exits non-zero. The
workflow declares `reviewBase: ""` and the review entry refuses on a blank
value, so a missing argument would fail deeper with a worse message.

### Where do the new commands live?

`~/.local/bin/`, matching the existing default, and the interview can override
each path. One directory for the whole suite keeps the "is it installed?" check
in the next concern simple.

### Are the new command bodies pinned into `docs/driver.md` like `MINIMAL_DRIVER`?

No. Only `MINIMAL_DRIVER` is doc-tested against `docs/driver.md`'s "A complete
minimal driver" fence. The three new bodies are exported constants in
`src/Install.ts` asserted by `src/Install.test.ts` — adding fences to
`docs/driver.md` would add doc-extraction machinery for no reader benefit.

---

### How do the two new bodies capture the `--entry` script without a pipe swallowing a refusal?

Command substitution, never a pipeline. `gtd --entry ... | sh` reports the exit
status of `sh`, not of `gtd`, so `set -e` would sail straight past a refusal and
`exec` a loop over a process that never started. Both bodies do
`script="$(gtd --entry ... )"` — a failing command substitution DOES abort under
`set -e` — then `sh -c "$script"`.

### How does a static exported constant `exec` a path chosen later in the interview?

One assignment line at the top of each body — `GTD_BUILD=~/.local/bin/gtd-build`
— and `exec "$GTD_BUILD"` below it. One greppable edit point the interview
rewrites, rather than a placeholder token the agent might miss or a bare
`gtd-build` that breaks the moment somebody renames the loop.

### Does `MINIMAL_DRIVER` itself change to consume the model exports?

No, and it must not: `Install.test.ts` pins it byte-equal to `docs/driver.md`'s
doc-tested fence. `GTD_PLANNERMODEL`/`GTD_CODERMODEL` are read by **gtd**, not
by the driver — a `GTD_<NAME>` env var overrides the same-named workflow var, so
`gtd next --json=model` already renders the resolved name into the driver's
existing `${model:+--model "$model"}`. The exports are lines prepended at
install time, nothing more.

### How is the model export block recognised so re-install can ignore it?

Comment-delimited. The exports sit between `# gtd-install: model exports` and
`# gtd-install: end`, directly after the shebang. Drift detection strips that
region before comparing, which is mechanical; asking an agent to eyeball "is
this difference only the exports?" is not.

### What exit code does `gtd-review` use for a missing argument?

`2`, matching gtd's own convention that a usage error means nothing was even
attempted. Usage text goes to stderr.

### Which `docs/driver.md` lines move, and does the doc-test survive?

Four prose/comment sites: lines 8, 132, 161, 328 — `~/.local/bin/gtd-loop` →
`~/.local/bin/gtd-build`, including the `env -u HERDR_PANE_ID gtd-loop` line
inside the `gtdh` fence. The doc-tested extraction targets only the "A complete
minimal driver" heading and its single fence, whose body is untouched, so the
rename cannot break it. `docs/**` is already in `test:unit`'s and both e2e
tasks' `turbo.json` inputs, so no task wiring changes.

### Where do the new briefing sections live in `renderBriefing()`?

`referenceImplementation()` and `editCommand()` collapse into one
`commandSuite()` renderer that emits all four commands as sibling subsections,
since the suite is now interviewed and installed as a unit. Two new consts —
`REINSTALL` and `EDITOR_INTEGRATION` — append after it, `PREREQUISITES` stays
last.

### Does the re-install check or the editor step need any engine support?

No. Both are instructions to an agent that already has file tools. `gtd install`
gains no filesystem read, no editor detection, no diffing code — it stays pure
string data with one `package.json` version read.

## Merged Concerns

**Requirements concerns 1 and 2 merge into package 1.** Both rewrite the same
region: the reference command bodies and interview questions 4–9. You cannot
write `gtd-build`'s body without knowing which CLI's flags replace the `claude`
lines and whether a `GTD_*` export block sits at its top, and you cannot ask for
the suite's paths and the agent choice in two separate interviews when the
briefing says to hold one conversation. Neither merely consumes the other's
interface — each mutates the other's text.

Concerns 3 and 4 stay separate. Concern 3 only CONSUMES what package 1 creates
(the four resolved paths and the delimited export block) to decide whether a
file drifted. Concern 4 appends a new final interview step and a new briefing
section, and changes no command body.

Both merged requirements, verbatim:

### Merged requirement — concern 1: The four-command suite

**PRODUCT.** The briefing currently installs two artifacts, `gtd-loop` and
`gtd-edit`, and describes them in two sections. Replace that with **one suite of
four**, interviewed together and installed together:

- **`gtd-build`** — the driver loop, renamed from `gtd-loop`. Same body
  (`MINIMAL_DRIVER`), same default directory, new default name
  `~/.local/bin/gtd-build`.
- **`gtd-edit`** — unchanged; opens `gtd next --json=file`, falling back to
  `.gtd/TODO.md`.
- **`gtd-review <commitish>`** — starts a review round over that commitish by
  running `gtd --entry review-gate.check --var reviewBase=<commitish>`, piping
  the emitted script into `sh`, then `exec`ing `gtd-build`. Refuses with usage
  when the argument is missing.
- **`gtd-fix`** — enters the fix process by running `gtd --entry fix-precheck`,
  piping the emitted script into `sh`, then `exec`ing `gtd-build`. Takes no
  argument.

**`gtd-review` and `gtd-fix` drive, they do not just start.** Each is one
invocation that carries the process all the way to its next human gate.

**Both `exec` only after the `--entry` script actually ran.** `gtd --entry`
exits 1 on a refusal and emits nothing, so both commands run under `set -e` and
never hand an empty script to `sh` or `exec` a loop over a process that was
never started.

Both `exec` the suite's **resolved** `gtd-build` path, not the literal string
`gtd-build`. The interview can rename any of the four, so the chosen name is
baked into the two commands that call it.

Both new commands `cd` to the repository root first, like `gtd-edit` does —
every state subcommand is root-only.

The briefing must say what each entry means, because a user running them blind
will be surprised: **`gtd-fix` on a green suite is a no-op straight back to
`idle`, and the exec'd `gtd-build` exits immediately on it**; **`gtd-review` on
a red baseline hands off to `gtd-build`, which halts at the blocked gate and
prints it** rather than starting the review.

Interview questions 8–9 today ask about the editor and the edit command's name.
They become one block that asks for the suite's install directory and lets the
user rename any of the four.

**Acceptance:** `src/Install.test.ts` asserts the briefing names all four
default paths, contains a `--entry review-gate.check --var reviewBase=` and an
`--entry fix-precheck` invocation, and shows both of those commands `exec`ing
the loop; the existing `~/.local/bin/gtd-edit` assertion still passes.
`docs/driver.md`'s three `gtd-loop` mentions move to `gtd-build` in the same
change, or the docs contradict the briefing.

**Risk:** `.git/gtd-loop.log` is the default log path and is asserted by name in
`src/WorktreeState.test.ts`, `src/program.test.ts`, `src/Beat.test.ts`, and
`tests/integration/features/driver-json-status.feature`. It is **not** renamed
here — the log path is an engine default, not the command name, and renaming it
is a breaking change to every existing driver's log location for no gain.

### Merged requirement — concern 2: Agent and model chosen by asking, not assuming

**PRODUCT.** Two interview steps that today are underspecified, merged because
you cannot pick models before you pick the agent.

**Agent discovery.** Interview question 4 says "whatever coding-agent CLI they
already use (default: `claude`)" and stops there. It becomes: probe `PATH` for
the known list, show what is actually installed, ask which one to drive with,
and accept a name that was not on the list. The chosen CLI's own flags then
replace the `claude` lines in the reference body — session flags per obligation
5, and the permission model per question 5.

**Model variables.** The built-in workflow ships `plannerModel: smart` and
`coderModel: base`. **Those are opaque hints, not model names** — gtd never
interprets them, and passing `--model smart` to a real CLI fails. The briefing
must say so plainly, then have the agent resolve both to real model identifiers
for the chosen CLI: the heavier tier for `plannerModel` (triage, design,
review), the cheaper tier for `coderModel` (build, fix). **When the mapping is
not obvious, ask** — list the CLI's available models and let the user pick per
tier, rather than guessing an identifier that fails on the first prompt beat.

**The resolved names are written as `GTD_PLANNERMODEL`/`GTD_CODERMODEL` exports
at the top of `gtd-build`**, not into `.gtdrc`. They stay per machine and never
get committed, so one person's model choice binds nobody else on the repo.

Two consequences the briefing must state, because both surprise a user who
expects `.gtdrc`: **`gtd-review` and `gtd-fix` inherit the exports only because
they `exec` `gtd-build`** — anything that drives beats without going through
`gtd-build` gets the raw `smart`/`base` hints and fails; and **`GTD_*` is the
highest-precedence config layer**, so these exports silently win over a
`plannerModel`/`coderModel` a teammate later commits to `.gtdrc`.

Interview question 5's existing "whether the workflow's `model` hints should be
honored (default: yes)" stays, and gains its consequence: **answering no means
dropping `--model` entirely and writing no exports, so every turn runs on the
CLI's own default tier.**

**Acceptance:** `src/Install.test.ts` asserts the briefing names `plannerModel`,
`coderModel`, both default values, `GTD_PLANNERMODEL`, `GTD_CODERMODEL`, at
least two probed CLI names, and states that the defaults are not real model
names.

## Packages

### 1. The four-command suite, with agent and models chosen by asking

Merge of requirements concerns 1 and 2.

**Files.** `src/Install.ts`, `src/Install.test.ts`, `docs/driver.md`.

**Module structure.** `src/Install.ts` stays what it is — a flat file of
top-level string constants and nullary render functions, no classes, no Effect,
one `createRequire` read of `package.json` for the version. Two changes to its
shape:

- Two new exported constants, `REVIEW_COMMAND` and `FIX_COMMAND`, siblings of
  the existing `EDIT_COMMAND`. There is **no** `BUILD_COMMAND`: `gtd-build`'s
  body IS `MINIMAL_DRIVER`, which cannot change without breaking its doc-test,
  and the rename is a path, not a body.
- `referenceImplementation()` and `editCommand()` collapse into one
  `commandSuite()` renderer that emits the interview once and then all four
  commands as sibling subsections. `renderBriefing()`'s composition list stays
  flat:
  `HEADER + BEAT_PROTOCOL + JSON_FIELD_REFERENCE + DRIVER_OBLIGATIONS + RECOVERY + commandSuite() + PREREQUISITES`.

**Data model.** The suite is one list of four records the briefing renders and
the interview walks: name, default path, what it does, whether it takes an
argument. There is no runtime type for it — `gtd install` prints text; the list
is prose plus a table in the briefing, and four `toContain` assertions in the
test. Do not introduce a `SuiteCommand` interface for four strings nothing reads
programmatically.

**Command bodies.** Both new bodies follow `EDIT_COMMAND`'s shape — POSIX `sh`,
`set -eu`, `cd "$(git rev-parse --show-toplevel)"`, no `jq`, no bashisms — with
one added line at the top, `GTD_BUILD=~/.local/bin/gtd-build`, and
`exec "$GTD_BUILD"` at the bottom. `gtd-review` guards its argument first:
`[ $# -ge 1 ] || { echo "usage: gtd-review <commitish>" >&2; exit 2; }`.

**Error handling.** The one real hazard is a swallowed refusal. `gtd --entry`
exits 1 and emits a byte-empty stdout on a refusal, but a pipeline reports the
exit status of its LAST command, so `gtd --entry ... | sh` under `set -e`
continues happily and `exec`s a loop over a process that never started. Both
bodies therefore capture first — `script="$(gtd --entry ...)"`, which DOES abort
under `set -e` — and only then `sh -c "$script"`. A pipe in either body is a
bug, and `Install.test.ts` asserts the substitution form.

**Model plumbing.** `GTD_PLANNERMODEL`/`GTD_CODERMODEL` need no driver-body
change at all. A `GTD_<NAME>` env var overrides the same-named workflow var, so
gtd itself resolves the name and `gtd next --json=model` renders it into the
driver's existing `${model:+--model "$model"}`. The exports are two lines the
install prepends to `gtd-build`, wrapped in `# gtd-install: model exports` /
`# gtd-install: end` so package 2 can strip them when diffing.

**Interview.** Questions 4–6 gain the `PATH` probe over `claude`, `codex`,
`gemini`, `cursor-agent`, `aider`, `opencode`, `amp` — hits shown, still asked,
default `claude`, an off-list name accepted — plus the two-tier model
resolution. Questions 8–9 collapse into one block asking for the suite's install
directory and offering to rename any of the four. The numbered list is
renumbered; nothing in `Install.test.ts` asserts a question number.

**docs/driver.md.** Four sites move `gtd-loop` → `gtd-build` (lines 8, 132, 161,
328). The doc-tested fence body is untouched, and `docs/**` is already declared
in the relevant `turbo.json` inputs.

**Risk, carried verbatim from the requirement:** `.git/gtd-loop.log` stays. It
is asserted by name in `src/WorktreeState.test.ts`, `src/program.test.ts`,
`src/Beat.test.ts`, and `tests/integration/features/driver-json-status.feature`.
Renaming it breaks every existing driver's log location for no gain.

**Second risk:** `MINIMAL_DRIVER` is byte-pinned to `docs/driver.md`'s "A
complete minimal driver" fence. Any temptation to bake the exports, the agent's
flags, or the suite paths into that constant reds `Install.test.ts` and
`tests/integration/features/driver-doc.feature` at once. Those substitutions are
the AGENT's job at install time, described in prose, never pre-rendered.

### 2. Re-install detects and upgrades what is already there

**Files.** `src/Install.ts`, `src/Install.test.ts`.

**Module structure.** One new constant, `REINSTALL`, a plain template string
like `RECOVERY` and `PREREQUISITES`, appended by `commandSuite()` after the four
command subsections — it must come after the bodies it tells the agent to
compare against. No new function, no code that reads a file: `gtd install`
prints instructions; the agent has the file tools.

**Data model.** A three-branch decision, stated once per path over the four
suite paths from package 1:

- **Absent** — install it.
- **Present, content-equal to what this gtd emits** — say so, change nothing,
  skip that command's interview questions entirely.
- **Present, different** — show the difference, name the likely cause (a gtd
  upgrade, or the user's own edit), and ask before overwriting.

**Comparison rule.** Content, never a parsed version. An installed command
carries no version marker — the version line lives in the briefing header, not
in the file — so drift is a content comparison. For `gtd-build`, strip the
`# gtd-install: model exports` … `# gtd-install: end` region before comparing:
the resolved model names are per machine, so a `gtd-build` that differs ONLY
inside those markers is **unchanged**, and re-asks nothing. Skipping this makes
every re-install on every machine report drift on the one command everybody has.

**Scope.** Exactly the four suite paths. `gtd-loop` is not one of them — never
read, never diffed, never deleted, never mentioned as something to remove. An
existing `gtd-loop` survives untouched beside the new `gtd-build`.

**Error handling.** Unreadable path, or a path that exists as a directory:
report it and ask, never overwrite. The default on any ambiguity is to leave the
file alone — a wrongly-preserved file costs one manual edit, a wrongly-clobbered
one loses the user's own work.

**Acceptance.** `src/Install.test.ts` asserts the briefing instructs checking
each path before writing, asks before overwriting a differing file, names the
export-block markers as the region to ignore, and never names `gtd-loop` as
something to remove.

### 3. Editor integration offered, not buried in the docs

**Files.** `src/Install.ts`, `src/Install.test.ts`.

**Module structure.** One new constant, `EDITOR_INTEGRATION`, appended by
`renderBriefing()` between `commandSuite()` and `PREREQUISITES` — a final
interview step after the suite is installed. It is prose, not code: no editor
detection, no config parsing, no filesystem read enters `src/Install.ts`.

**Data model.** A detection table — editor, how to detect it (config directory
or binary on `PATH`), what to merge — over VS Code, Neovim, Helix, Zed, Emacs.
How much of the "what to merge" column the briefing spells out is the first open
question above; the table's other two columns are settled either way.

**The offer.** Three or four lines, never a copy of `docs/setup.md`: live
diagnostics on `.gtd/` steering files, an outline of what is left to review,
click-to-check review hunks, pick-an-option actions on open questions, and a
`gtd.openSteeringFile` command that jumps to the current state's file.

**Three guards on the write**, because it lands outside the repository in a file
the user shares across every project:

- **Ask first, per editor, and name the exact file** about to change. Silence is
  not consent for a machine-wide config.
- **Merge, never overwrite.** Read the existing config, add only the gtd
  language-server entry, leave every other key byte-identical.
- **Skip and report when the entry is already present.** A second install must
  not append a duplicate server registration.

**Two facts the offer must carry**, because both bite on a fresh repo: `gtd lsp`
never creates `.gtd/`, so `gtd.openSteeringFile` may point at a path that does
not exist yet before the first sketch; and `gtd lsp` needs no repository root —
it is one of the commands that skips the root guard.

**When no LSP-capable editor is detected, say nothing and move on.** Do not
pitch editor integration to somebody with no editor to integrate.

**Error handling.** A malformed existing config (unparseable JSON, a TOML syntax
error) is a stop-and-report, not a rewrite — the agent says which file it could
not parse and leaves it untouched. The user's editor config is the one artifact
in this whole change that lives outside version control, so it has no undo.

**Acceptance.** `src/Install.test.ts` asserts the briefing names `gtd lsp`, at
least two detected editors, the `gtd.openSteeringFile` command, and instructs
asking before editing an editor config and merging rather than overwriting it.
