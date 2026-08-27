# Requirements

Improve the briefing `gtd install` prints, so an agent reading it installs a
**suite of four commands**, picks the agent CLI and models by asking, upgrades
whatever is already installed, and offers editor integration.

`gtd install` writes nothing itself — it prints knowledge. Every concern below
changes text in `src/Install.ts` (plus its assertions in `src/Install.test.ts`),
never engine behaviour.

## Open Questions

### Existing `~/.local/bin/gtd-loop` installs — rename in place, or leave both?

- [ ] Rename: the briefing deletes `gtd-loop` after writing `gtd-build`, so one
      name survives and nobody drives a stale loop by accident
- [ ] Keep both: leave `gtd-loop` untouched and add `gtd-build` beside it —
      never delete a file the user may have hand-edited
- [ ] _your answer_

### Do `gtd-review` and `gtd-fix` drive the process, or only start it?

- [ ] Start only, matching `gtd-edit`: they run the `--entry` script and return,
      and the human runs `gtd-build` when ready — one command, one job
- [ ] Start then drive: they run the `--entry` script and immediately exec
      `gtd-build`, so a review or fix is a single invocation
- [ ] _your answer_

### Where do the resolved model names get written?

- [ ] `.gtdrc` `vars:` — committed, so every clone and every teammate's driver
      agrees on which tier runs planning versus building
- [ ] `GTD_PLANNERMODEL`/`GTD_CODERMODEL` exports inside `gtd-build` — per
      machine, never committed, so one person's model choice binds nobody else
- [ ] _your answer_

### Does the LSP step write editor config, or print a snippet?

- [ ] Write it, after asking: the agent edits the detected editor's config file
      itself, so integration works without the human touching anything
- [ ] Print only: the agent shows the config block and the human pastes it — an
      editor config is personal and often shared across many projects
- [ ] _your answer_

## Answered Questions

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
  running `gtd --entry review-gate.check --var reviewBase=<commitish>` and
  piping the emitted script into `sh`. Refuses with usage when the argument is
  missing.
- **`gtd-fix`** — enters the fix process by running `gtd --entry fix-precheck`
  and piping the emitted script into `sh`. Takes no argument.

Both new commands `cd` to the repository root first, like `gtd-edit` does —
every state subcommand is root-only.

The briefing must say what each entry means, because a user running them blind
will be surprised: **`gtd-fix` on a green suite is a no-op straight back to
`idle`**, and **`gtd-review` on a red suite blocks at the baseline gate** rather
than starting the review.

Interview questions 8–9 today ask about the editor and the edit command's name.
They become one block that asks for the suite's install directory and lets the
user rename any of the four.

**Acceptance:** `src/Install.test.ts` asserts the briefing names all four
default paths and contains a `--entry review-gate.check --var reviewBase=` and
an `--entry fix-precheck` invocation; the existing `~/.local/bin/gtd-edit`
assertion still passes. `docs/driver.md`'s three `gtd-loop` mentions move to
`gtd-build` in the same change, or the docs contradict the briefing.

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

Interview question 5's existing "whether the workflow's `model` hints should be
honored (default: yes)" stays, and gains its consequence: **answering no means
dropping `--model` entirely, so every turn runs on the CLI's own default tier.**

**Acceptance:** `src/Install.test.ts` asserts the briefing names `plannerModel`,
`coderModel`, both default values, at least two probed CLI names, and states
that the defaults are not real model names.

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

**Acceptance:** `src/Install.test.ts` asserts the briefing instructs checking
each path before writing and asks before overwriting a differing file.

**Risk:** this is the concern the rename question above lands in. If existing
`gtd-loop` files are to be removed, the removal happens in this step, not in
concern 1.

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

Two facts the offer must carry, because both bite on a fresh repo: **`gtd lsp`
never creates `.gtd/`**, so `gtd.openSteeringFile` may point at a path that does
not exist yet before the first sketch; and **`gtd lsp` needs no repository
root** — it is one of the commands that skips the root guard.

When no LSP-capable editor is detected, say nothing and move on. Do not pitch
editor integration to somebody with no editor to integrate.

**Acceptance:** `src/Install.test.ts` asserts the briefing names `gtd lsp`, at
least two detected editors, and the `gtd.openSteeringFile` command.
