# Review: 50e800f

<!-- base: 717079d1c60f82cccc74f8ae1873ab5a0f51fd3f -->

The briefing `gtd install` prints grew from **two commands to four**: `gtd-loop`
is renamed `gtd-build`, and `gtd-review <commitish>` / `gtd-fix` are added as
thin front doors onto the existing `--entry` side doors. The briefing also
gained two new instruction sections — re-install drift detection and editor LSP
wiring. No engine code changed: everything here is generated prose plus two new
shell command bodies, pinned by string assertions.

## Rename: `gtd-loop` → `gtd-build`

The loop command's suggested name changes everywhere it is user-facing. Only
prose and the two new command bodies use the new name; the engine's own log path
stays `.git/gtd-loop.log`, untouched.

- [x] ./docs/driver.md#8 — the doc-tested minimal driver is now saved as
      `gtd-build`; the fenced block itself is unchanged, so the doc test still
      extracts and runs it
- [x] ./docs/driver.md#132 — the `gtdh` wrapper example now calls `gtd-build`
      (prose + a non-doc-tested block, so nothing enforces this one)
- [x] ./README.md#259 — "two commands" → "four commands", with one-line
      descriptions of each and the new editor-integration sentence
- [x] ./README.md#269 — new claim that the briefing offers editor wiring,
      "asking first and naming the exact file, and merging rather than
      overwriting" — matches the briefing text exactly, checked
- [x] ./src/Install.ts#500 — the reinstall section deliberately EXCLUDES
      `gtd-loop` from the drift check: an existing one survives untouched and
      cleanup is the human's call. Worth confirming that's the intent rather
      than offering to clean it up
- [x] ./docs/driver.md#456 — **naming wart, not a bug**: `--json=log` still
      defaults to `.git/gtd-loop.log` and every test pins that string. A user
      who now only ever types `gtd-build` finds a log named after a command that
      no longer exists. Renaming it is a breaking change for anyone tailing that
      path, so leaving it may well be right — but it is an inconsistency this
      commit creates

## New commands: `gtd-review` and `gtd-fix`

Two new exported sh bodies, each a four-line wrapper: cd to the repo root, run
one `gtd --entry` invocation, run the script it printed, then `exec` the build
loop so the entry carries all the way to the next human gate. I verified
`gtd --entry` writes the combined entry script to stdout and fails non-zero on a
refusal, so `set -e` aborts before the `exec` on a refused entry.

- [x] ./src/Install.ts#105 — `REVIEW_COMMAND`: argument guard first (`usage:` on
      stderr, exit `2`), then cd, then
      `script="$(gtd --entry review-gate.check --var reviewBase="$1")"`. Command
      substitution rather than a pipe is the right call and the reason is stated
      in the prose: a pipeline reports only its last command's status, so
      `gtd --entry ... | sh` under `set -e` would sail past a refusal
- [x] ./src/Install.ts#117 — `FIX_COMMAND`: same shape, no argument,
      `--entry fix-precheck`
- [x] ./src/Install.ts#107 — `GTD_BUILD=~/.local/bin/gtd-build` relies on POSIX
      tilde expansion in an assignment (correct in dash/sh), and the briefing
      tells the installing agent to bake the RESOLVED path here instead. A user
      who renames `gtd-build` and whose installer forgets that substitution gets
      a working review entry followed by an `exec` failure — the process is
      started but not driven. The prose warns about it twice; nothing enforces
      it
- [x] ./src/Install.ts#105 — **`sh -c "$script"` output goes to the terminal,
      not to `$(gtd next --json=log)`**, unlike the build loop, which logs every
      script rest. Deliberate for an interactive front door, but it means the
      entry commit's script output is the one thing in the whole flow that lands
      nowhere
- [x] ./src/Install.ts#441 — the `gtd-review` prose covers the RED-baseline
      case: the command hands off to `gtd-build`, which halts at the blocked
      gate and prints it, rather than starting the review
- [x] ./src/Install.ts#459 — the `gtd-fix` prose covers the GREEN case: no-op
      straight back to `idle`, and the exec'd loop exits immediately

## Briefing restructure: one interview, four commands, resolved models

`referenceImplementation()` + `editCommand()` collapse into a single
`commandSuite()` with four `###` subsections, and the interview list is
renumbered and extended. The substantive addition is question 6: the workflow's
`plannerModel: smart` / `coderModel: base` are opaque hints, and the installer
must resolve them to real model names at install time.

- [x] ./src/Install.ts#314 — `commandSuite()` replaces the two old renderers;
      `renderBriefing()` (line 566) now composes it plus `EDITOR_INTEGRATION`
- [x] ./src/Install.ts#341 — question 4 now probes `PATH` for seven known agent
      CLIs and explicitly accepts a name that was not on the list, so the probe
      cannot become a whitelist
- [x] ./src/Install.ts#357 — question 6: derive real model names from the chosen
      CLI, **never a hardcoded table**, and ask when the heavy/cheap mapping is
      not obvious. Both consequences are stated: `gtd-review`/`gtd-fix` inherit
      the exports only via `exec`, and `GTD_*` silently outranks a
      `plannerModel` a teammate later commits to `.gtdrc`
- [x] ./src/Install.ts#357 — **the worked example never shows the marker
      region.** The prose says write `GTD_PLANNERMODEL`/`GTD_CODERMODEL` wrapped
      in `# gtd-install: model exports` / `# gtd-install: end` at the top of
      `gtd-build`, and the reinstall section's drift exemption depends on those
      exact markers existing. But `MINIMAL_DRIVER` (line 7) carries no such
      region, so every installer invents its own placement. Get the markers
      slightly wrong and every re-install reports false drift on the one command
      everybody has — precisely the failure the exemption exists to prevent
- [x] ./src/Install.ts#387 — question 9 folds path, editor, and renaming into
      one question, and restates the resolved-`GTD_BUILD` rule
- [x] ./docs/driver.md#388 — **pre-existing trap this change documents but does
      not fix**: the doc-tested paste passes `--model "$model"`, and the bundled
      workflow's `model` resolves to the literal `smart`. Paste that driver and
      drive with a real `claude` and the first prompt beat fails. The briefing
      now warns about it in question 6; `docs/driver.md`, which is where a human
      actually pastes from, still does not. The doc test passes because the stub
      ignores `--model`

## New briefing section: re-install detection

A second install on a machine that already has a suite must read all four paths
and branch per path rather than overwrite.

- [x] ./src/Install.ts#471 — four-way branch (absent / content-equal / different
      / unreadable-or-a-directory), content comparison only, and the
      model-export region stripped from `gtd-build` before comparing
- [x] ./src/Install.ts#488 — "never by parsing a version out of the installed
      file" is correct: an installed command carries no version marker. Note the
      consequence — a gtd upgrade that changes a command body is
      indistinguishable from a user's own edit, so the user is asked in both
      cases. The prose names both causes, which is the honest handling

## New briefing section: editor integration

The briefing now ends by offering to wire `gtd lsp` into the user's editor.

- [x] ./src/Install.ts#504 — states the whole contract (`gtd lsp`, stdio, files
      under `.gtd/`) and names **no specific editor and no per-editor recipe** —
      the installer looks the format up itself. Verified against
      `docs/cli.md#72`: `gtd lsp` is real and is one of the standalone commands
      that skips the root guard, as the section claims
- [x] ./src/Install.ts#512 — detection reads `$EDITOR`/`$VISUAL` then shell rc
      files, asks when ambiguous, and **says nothing when there is no editor at
      all** — no pitch to somebody with nothing to integrate
- [x] ./src/Install.ts#533 — three guards on a write that lands OUTSIDE the
      repository in a file shared across every project: ask first naming the
      exact file, merge never overwrite, skip when already present. A malformed
      existing config is stop-and-report, not a rewrite
- [x] ./src/Install.ts#504 — **scope question**: this is the first thing the
      briefing asks an agent to change outside the repository and outside
      `~/.local/bin`. Worth a deliberate yes on that boundary, since a merge
      into a hand-maintained editor config is the one step here whose blast
      radius reaches every other project on the machine

## Tests

320 added lines, all of them string and ordering assertions over the rendered
briefing plus shape assertions over the two new command bodies.
`npm run lint:sh` is green and the shell corpus is up to date.

- [x] ./src/Install.test.ts#340 — `REVIEW_COMMAND` shape tests: shebang,
      `set -eu`, no `jq`, `GTD_BUILD` first, `exec "$GTD_BUILD"` last, cd before
      any gtd call, command substitution and explicitly NOT a pipe into sh,
      usage on stderr with exit 2
- [x] ./src/Install.test.ts#378 — `FIX_COMMAND`: the same set minus the argument
      guard
- [x] ./src/Install.test.ts#105 — **the two new bodies are never executed and
      never shellchecked.** `tests/shell/corpus/` holds 37 generated files and
      none of them is an installer command body, so `shellcheck -s sh` never
      sees these two. `MINIMAL_DRIVER` earns its confidence by being run for
      real in `driver-doc.feature`; these get regex assertions only. A quoting
      or `set -e` mistake inside them ships green
- [x] ./src/Install.test.ts#164 —
      `contains no hardcoded table of concrete model identifiers` greps the
      briefing for `opus|sonnet|haiku|gpt-\d|...`. This is the test most likely
      to fail for an innocent reason later: any future prose that mentions a
      model by name anywhere in the briefing trips it, and the failure will read
      as unrelated to whatever was edited
- [x] ./src/Install.test.ts#232 — the `gtd-loop` test collapses whitespace
      before splitting into sentences, with a comment explaining why a
      line-by-line filter would miss the very sentence it checks. Good
      reasoning, and the comment earns its place
- [x] ./src/Install.test.ts#157 —
      `probes for at least two known coding-agent CLIs` asserts only `>= 2` of
      seven names appear. Since `claude` appears throughout the briefing for
      unrelated reasons, this passes on one real probe entry plus incidental
      prose — weaker than it reads
- [x] ./src/Install.test.ts#170 — the ordering tests (`REINSTALL` after all four
      subsections and before Prerequisites; `EDITOR_INTEGRATION` likewise) pin
      composition order, which is otherwise invisible. Note that `REINSTALL` is
      interpolated at the END of `commandSuite()` rather than composed in
      `renderBriefing()` alongside the others — the output is right, the seam is
      inconsistent with how every other section is assembled
