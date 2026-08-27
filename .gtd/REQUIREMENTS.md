# Requirements

Improve the briefing `gtd install` prints, so an agent reading it installs a
**suite of four commands**, picks the agent CLI and models by asking, upgrades
whatever is already installed, and offers editor integration.

`gtd install` writes nothing itself — it prints knowledge. Every concern below
changes text in `src/Install.ts` (plus its assertions in `src/Install.test.ts`),
never engine behaviour.

## Answered Questions

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

## Concerns

### 1. The four-command suite

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

### 2. Agent and model chosen by asking, not assuming

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

### 3. Re-install detects and upgrades what is already there

**PRODUCT.** A second `gtd install` today re-runs an interview that assumes a
fresh machine. It must instead **read each of the four paths first** and branch:

- Absent — install it, as now.
- Present and byte-equal to what this gtd version emits — say so, change
  nothing, do not re-ask its interview questions.
- Present and different — show the difference, name the likely cause (a gtd
  upgrade, or the user's own edit), and **ask before overwriting**. Never
  silently replace a file the user may have customised.

The version line the briefing already prints in its header is the anchor: an
installed command carries no version marker, so **drift is detected by comparing
content, never by parsing a version out of the file**.

**A `gtd-build` carrying `GTD_*` model exports never matches byte-equal**, since
the resolved model names are per machine. Treat an installed `gtd-build` whose
only difference from the emitted body is its export block as **unchanged**, and
re-ask nothing — otherwise every single re-install reports drift on the one
command everybody has.

**The scope is exactly the four suite paths.** `gtd-loop` is not one of them:
the briefing never reads it, never diffs it, never deletes it. An existing
`gtd-loop` survives untouched beside the new `gtd-build`, and cleaning it up is
the human's own call.

**Acceptance:** `src/Install.test.ts` asserts the briefing instructs checking
each path before writing, asks before overwriting a differing file, and never
names `gtd-loop` as something to remove.

### 4. Editor integration offered, not buried in the docs

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
