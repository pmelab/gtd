# 02 — Re-install detects and upgrades what is already there

Builds on package 01: it consumes the four resolved suite paths and the
comment-delimited model-export block that package creates, and changes no
command body.

**Files.** `src/Install.ts`, `src/Install.test.ts`.

## Requirement

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

## Settled technical decisions

**One new constant, `REINSTALL`**, a plain template string like `RECOVERY` and
`PREREQUISITES`, appended by `commandSuite()` AFTER the four command subsections
— it must come after the bodies it tells the agent to compare against.

**No code reads a file.** `gtd install` prints instructions and stays pure
string data with one `package.json` version read. No filesystem read, no diffing
code, no editor detection enters the engine.

**Drift comparison strips the export block mechanically.** For `gtd-build`,
remove the region between `# gtd-install: model exports` and
`# gtd-install: end` before comparing. Asking an agent to eyeball "is this
difference only the exports?" is not reliable; a delimited region is.

**The default on any ambiguity is to leave the file alone.** A wrongly-preserved
file costs one manual edit; a wrongly-clobbered one loses the user's own work.

## Tasks

### Task 1 — Add the `REINSTALL` briefing section

Paths: `src/Install.ts`

- [ ] `REINSTALL` is a new constant in the same flat top-level string style as
      `RECOVERY` and `PREREQUISITES`.
- [ ] `commandSuite()` emits it after all four command subsections, and
      `PREREQUISITES` still comes last in `renderBriefing()`.
- [ ] No new function, no filesystem read, and no diffing code is added to
      `src/Install.ts`.

### Task 2 — State the three-way per-path branch

Paths: `src/Install.ts`, `src/Install.test.ts`

- [ ] The section instructs reading each of the four suite paths BEFORE writing
      anything.
- [ ] Absent — install it.
- [ ] Present and content-equal to what this gtd version emits — say so, change
      nothing, and skip that command's interview questions entirely.
- [ ] Present and different — show the difference, name the likely cause (a gtd
      upgrade, or the user's own edit), and ask before overwriting.
- [ ] The section states drift is detected by comparing CONTENT, never by
      parsing a version out of the installed file, because an installed command
      carries no version marker.
- [ ] An unreadable path, or a path that exists as a directory, is reported and
      asked about — never overwritten.

### Task 3 — Exempt the model-export block from drift

Paths: `src/Install.ts`, `src/Install.test.ts`

- [ ] The section names `# gtd-install: model exports` and `# gtd-install: end`
      as the region to strip before comparing `gtd-build`.
- [ ] The section states a `gtd-build` differing ONLY inside those markers is
      unchanged, and re-asks nothing.
- [ ] The section states why: the resolved model names are per machine, so
      without this exemption every single re-install reports drift on the one
      command everybody has.

### Task 4 — Pin the scope to exactly four paths

Paths: `src/Install.ts`, `src/Install.test.ts`

- [ ] The section scopes the check to exactly the four suite paths.
- [ ] The briefing never names `gtd-loop` as something to read, diff, delete, or
      remove. A test asserts the briefing contains no instruction to remove
      `gtd-loop`.
- [ ] The section states an existing `gtd-loop` survives untouched beside the
      new `gtd-build`, and cleaning it up is the human's own call.
