# 01 — The four-command suite, with agent and models chosen by asking

Merged package: two requirements, reviewable independently. Both rewrite the
same region of `src/Install.ts` — the reference command bodies and interview
questions 4–9 — and neither merely consumes the other. You cannot write
`gtd-build`'s body without knowing which CLI's flags replace the `claude` lines
and whether a `GTD_*` export block sits at its top.

**Files.** `src/Install.ts`, `src/Install.test.ts`, `docs/driver.md`.

## Requirement A — The four-command suite

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

## Requirement B — Agent and model chosen by asking, not assuming

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

## Settled technical decisions

**Capture the `--entry` script by command substitution, never a pipe.** A
pipeline reports the exit status of its LAST command, so `gtd --entry ... | sh`
under `set -e` sails past a refusal and `exec`s a loop over a process that never
started. Both bodies do `script="$(gtd --entry ...)"` — a failing command
substitution DOES abort under `set -e` — then `sh -c "$script"`.

**`MINIMAL_DRIVER` does not change.** It is byte-pinned to `docs/driver.md`'s "A
complete minimal driver" fence by `src/Install.test.ts` and executed by
`tests/integration/features/driver-doc.feature`. `gtd-build`'s body IS
`MINIMAL_DRIVER`; the rename is a path, not a body. There is no `BUILD_COMMAND`
constant.

**The model exports need no driver-body change.** A `GTD_<NAME>` env var
overrides the same-named workflow var, so gtd itself resolves the name and
`gtd next --json=model` renders it into the driver's existing
`${model:+--model "$model"}`. The exports are two lines prepended at install
time, wrapped in `# gtd-install: model exports` / `# gtd-install: end`.

**One assignment line resolves the loop path.** Each new body carries
`GTD_BUILD=~/.local/bin/gtd-build` at the top and `exec "$GTD_BUILD"` at the
bottom — one greppable edit point the interview rewrites.

**`gtd-review` with no argument exits 2**, matching gtd's convention that a
usage error means nothing was attempted. Usage text goes to stderr.

**No table of model names anywhere in the briefing.** The agent derives the
chosen CLI's model list at install time — its `--help`, its docs, its own config
— and asks the user per tier whenever the heavier/cheaper mapping is not
obvious. A hardcoded per-CLI table is stale the day a vendor renames a model,
and gtd releases lag model releases by months.

**`referenceImplementation()` and `editCommand()` collapse into one
`commandSuite()` renderer** emitting the interview once, then all four commands
as sibling subsections. `renderBriefing()` stays flat.

## Tasks

### Task 1 — Add `REVIEW_COMMAND` and `FIX_COMMAND` to `src/Install.ts`

Paths: `src/Install.ts`, `src/Install.test.ts`

- [ ] `REVIEW_COMMAND` and `FIX_COMMAND` are exported constants, siblings of the
      existing `EDIT_COMMAND`. No `BUILD_COMMAND` is added.
- [ ] Both bodies are POSIX `sh`: `#!/usr/bin/env sh`, `set -eu`, no `jq`, no
      bashisms. A test asserts neither contains `jq`.
- [ ] Both bodies `cd "$(git rev-parse --show-toplevel)"` before any gtd call.
- [ ] Both bodies carry `GTD_BUILD=~/.local/bin/gtd-build` at the top and
      `exec "$GTD_BUILD"` as the last line.
- [ ] `REVIEW_COMMAND` runs
      `gtd --entry review-gate.check --var reviewBase=<commitish>` with the
      commitish from `$1`.
- [ ] `FIX_COMMAND` runs `gtd --entry fix-precheck` and takes no argument.
- [ ] Both capture the emitted script via command substitution
      (`script="$(gtd --entry ...)"`) and run it with `sh -c "$script"`. A test
      asserts neither body pipes `gtd --entry` directly into `sh`.
- [ ] `REVIEW_COMMAND` prints `usage: gtd-review <commitish>` to stderr and
      exits `2` when `$1` is missing.
- [ ] `MINIMAL_DRIVER` is byte-unchanged; its existing doc-equality test still
      passes.

### Task 2 — Collapse the two briefing sections into one `commandSuite()`

Paths: `src/Install.ts`, `src/Install.test.ts`

- [ ] `referenceImplementation()` and `editCommand()` are replaced by one
      `commandSuite()` that renders the interview once, then all four commands
      as sibling subsections.
- [ ] `renderBriefing()` composes
      `HEADER + BEAT_PROTOCOL + JSON_FIELD_REFERENCE + DRIVER_OBLIGATIONS +     RECOVERY + commandSuite() + PREREQUISITES`.
- [ ] The briefing names all four default paths: `~/.local/bin/gtd-build`,
      `~/.local/bin/gtd-edit`, `~/.local/bin/gtd-review`,
      `~/.local/bin/gtd-fix`.
- [ ] The briefing contains `--entry review-gate.check --var reviewBase=` and
      `--entry fix-precheck`, and shows both commands `exec`ing the loop.
- [ ] The briefing states that `gtd-fix` on a green suite is a no-op straight
      back to `idle` and the exec'd loop exits immediately on it.
- [ ] The briefing states that `gtd-review` on a red baseline hands off to the
      loop, which halts at the blocked gate and prints it.
- [ ] The briefing states both new commands `exec` the RESOLVED loop path, not
      the literal string `gtd-build`.
- [ ] Every existing `renderBriefing` test still passes, including the
      `~/.local/bin/gtd-edit`, `gtd next --json=file`, `.gtd/TODO.md`, and
      "absent field prints nothing" assertions.

### Task 3 — Agent probe and model resolution in the interview

Paths: `src/Install.ts`, `src/Install.test.ts`

- [ ] Interview questions 4–6 instruct probing `PATH` for `claude`, `codex`,
      `gemini`, `cursor-agent`, `aider`, `opencode`, `amp`, showing the hits,
      still asking, defaulting to `claude`, and accepting an off-list name.
- [ ] The briefing states the chosen CLI's own flags replace the `claude` lines
      in the reference body — session flags and the permission model.
- [ ] The briefing names `plannerModel`, `coderModel`, and both default values
      `smart` and `base`, and states plainly that they are opaque hints, not
      model names, and that `--model smart` fails against a real CLI.
- [ ] The briefing instructs deriving the chosen CLI's real model list at
      install time and asking the user per tier when the heavier/cheaper mapping
      is not obvious.
- [ ] The briefing contains no concrete model identifier. A test asserts the
      absence of a hardcoded model-name table.
- [ ] The briefing names `GTD_PLANNERMODEL` and `GTD_CODERMODEL` as exports at
      the top of `gtd-build`, wrapped in `# gtd-install: model exports` and
      `# gtd-install: end`, and states they are NOT written to `.gtdrc`.
- [ ] The briefing states `gtd-review`/`gtd-fix` inherit the exports only
      because they `exec` `gtd-build`, and that anything driving beats without
      going through `gtd-build` gets the raw `smart`/`base` hints and fails.
- [ ] The briefing states `GTD_*` is the highest-precedence config layer and
      silently wins over a `plannerModel`/`coderModel` later committed to
      `.gtdrc`.
- [ ] Question 5 keeps "whether the workflow's `model` hints should be honored
      (default: yes)" and states the consequence of no: drop `--model` entirely,
      write no exports, every turn runs on the CLI's default tier.
- [ ] Questions 8–9 collapse into one block asking for the suite's install
      directory and offering to rename any of the four.

### Task 4 — Rename `gtd-loop` to `gtd-build` in `docs/driver.md`

Paths: `docs/driver.md`

- [ ] Lines 8, 132, 161 and 328 name `gtd-build`, not `gtd-loop` — including the
      `env -u HERDR_PANE_ID gtd-loop` line inside the `gtdh` fence.
- [ ] The "A complete minimal driver" heading text is unchanged and its single
      fenced block's body is byte-unchanged.
- [ ] `tests/integration/features/driver-doc.feature` still passes.
- [ ] `.git/gtd-loop.log` is NOT renamed. `src/WorktreeState.test.ts`,
      `src/program.test.ts`, `src/Beat.test.ts`, and
      `tests/integration/features/driver-json-status.feature` still assert it by
      that name and still pass.
- [ ] No `turbo.json` change is needed — `docs/**` is already declared in
      `test:unit`'s and both e2e tasks' `inputs`.
