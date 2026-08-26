# Package 2 — delete `--sh`, rewrite the reference driver, drop `jq`

**Depends on package 1.** The driver rewrite has no `--json=kind` to read until
the selector ships.

## Requirement — delete `--sh`, rewrite the reference driver, drop `jq` from the docs (TECHNICAL)

One concern, not three: deleting `--sh` without rewriting `docs/driver.md` reds
`driver-doc.feature`, which extracts and **executes** that doc's fenced block.

- Remove the `--sh` flag row, `renderBeatSh`, `renderLandSh`, `BEAT_SH_SHAPE`,
  `LAND_SH_SHAPE`, `src/Sh.ts` and `src/Sh.test.ts`. `src/Sh.ts`'s only non-test
  consumer is `src/Beat.ts`.
- Rewrite the minimal driver: no `eval`, no `unset` preamble, no `gtd_` names —
  just `kind="$(gtd next --json=kind)"` and friends. The prompt still goes to
  the agent **on stdin** (`gtd next | claude -p`) for the same `ARG_MAX` reason
  the doc already documents: roughly 1 MB on macOS, 4 KB POSIX floor, both
  reachable by an ordinary diff. Keep the `session.resume` hint-then-fallback
  dance — `resume` is a HINT, not a contract.
- Update `src/Install.ts`'s driver briefing and its `EDIT_COMMAND` (already
  jq-free, pinned by `Install.test.ts`). Its three `jq` mentions become the
  selector, and `docs/cli.md:262`'s "pipes stdout into `jq`" accepted-cost note
  goes with them.
- Update the 8 feature files touching `--sh`: `command-surface.feature` (13),
  `land.feature` (7), `driver-json-status.feature` (6),
  `next-status-content-parity.feature` (5), `ansi-free-stdout.feature` (4),
  `steering-modes.feature` (4), `tmpdir-and-git-dir.feature` (2),
  `validate.feature` (2).

Acceptance: `gtd next --sh` is a usage error, exit 2; `driver-doc.feature`
passes against the rewritten paste; no file under `src/` or `docs/` mentions
`gtd_` assignments or `jq`.

**Risk:** the doc-tested paste is spawned with only `$PATH` and `$HOME`. Any new
env dependency the rewrite grows is a scenario failure until it gets its own
Prerequisites section.

## Settled decisions this package implements

- **Removing `--sh` gets no friendly deprecation message** — a bare
  unknown-option usage error, exit 2. A removed-flag message table is new
  machinery for one flag; `Cli.test.ts`'s property test already covers the exit
  code, and the migration note belongs in `docs/cli.md` and `renderHelp()`'s
  `--json` row, not in a new `if`.
- **A driver learns `settled`/`idle` by reading the selectors before piping the
  script to `sh`.** `gtd land` itself never mutates — it only plans and prints —
  so `gtd land --json=settled` and `gtd land --json=script` planned against the
  same untouched tree agree. The ordering rule: read every value you need first,
  run the script last.
- **At a `script` rest the no-flag output is prose, not pipeable into `sh`.** A
  driver reads the raw script from `--json=content` instead.
- At a `prompt` rest the driver pipes the no-flag `gtd next` for `content`
  rather than reading `--json=content`, so the expensive full-diff render
  happens once for the agent's input instead of twice. The remaining scalar
  reads stay separate invocations, as the one-value-per-call rule requires.

## Task 1 — delete `--sh` inside-out

`src/Sh.ts`'s only non-test consumer is `src/Beat.ts`. **Delete inside-out —
`Beat.ts`'s four exports first, then `Sh.ts`/`Sh.test.ts`, then the `Cli.ts`
row, then `program.ts`'s parameters — so the type checker names every remaining
reference instead of leaving a dangling import.**

`gtd next --sh` becomes a bare unknown-option usage error, exit 2.

Paths: `src/Beat.ts`, `src/Sh.ts` (deleted), `src/Sh.test.ts` (deleted),
`src/Cli.ts`, `src/Cli.test.ts`, `src/program.ts`, `src/Beat.test.ts`.

- [ ] `renderBeatSh`, `renderLandSh`, `BEAT_SH_SHAPE`, `LAND_SH_SHAPE` and the
      `./Sh.js` import are gone from `src/Beat.ts`
- [ ] `src/Sh.ts` and `src/Sh.test.ts` no longer exist
- [ ] The `--sh` flag row is gone from `src/Cli.ts`, and the `--json` row's
      `conflicts: ["--sh"]` with it
- [ ] The `sh` parameter and both `else if (sh)` branches are gone from
      `src/program.ts`
- [ ] `CliPlan`'s command variant no longer carries an `sh` field
- [ ] `gtd next --sh` exits 2 with the standard unknown-option message
- [ ] `gtd land --sh` exits 2 with the standard unknown-option message
- [ ] No removed-flag message table was added

## Task 2 — rewrite the minimal driver in `docs/driver.md`

No `eval`, no `unset` preamble, no `gtd_` names. Each value is one command
substitution:

```
kind="$(gtd next --json=kind)"
idle="$(gtd next --json=idle)"
```

**Four things the rewrite must keep, each a live failure if dropped:**

- **The prompt goes to the agent on stdin.** `gtd next | claude -p` — argv is
  capped at roughly 1 MB on macOS and a POSIX floor of 4 KB (`ARG_MAX`), both
  reachable by an ordinary diff. At a `prompt` rest the no-flag output is the
  bare content, so the pipe needs no selector and costs no extra render.
- **The `session.resume` hint-then-fallback dance.** `resume` is a HINT derived
  from history, never a contract; try the hinted flag, fall back to the other.
- **Read every value before piping the landing script to `sh`.**
- **Absent optionals stay `${var:-}` / `${var:+...}`-guarded.** An absent field
  now prints an empty string rather than leaving the variable unset, so `set -u`
  no longer aborts — but the empty-vs-absent distinction still decides whether
  `--model` is passed at all, and an unguarded `--model ""` would silently
  override the harness default.

**Rewrite the line-by-line walkthrough below the fence too.** Every `eval`,
`unset`-preamble and `gtd_`-name sentence in it is now false prose sitting next
to correct code.

**Risk: the doc-tested paste is spawned with only `$PATH` and `$HOME`.** Any new
env dependency the rewrite grows is a scenario failure until it gets its own
Prerequisites section in `docs/driver.md`.

**Risk: the heading text and the single fence are load-bearing.**
`tests/integration/helpers/driver-doc.ts` extracts the block verbatim by the
`A complete minimal driver` heading and one fence — renaming the heading or
splitting the paste across two fences fails extraction, and reads as a driver
bug rather than a doc edit.

Paths: `docs/driver.md`, `tests/integration/features/driver-doc.feature`.

- [ ] The paste contains no `eval`, no `unset` preamble and no `gtd_` variable
      name
- [ ] The paste pipes the prompt to the agent on stdin, never as an argv
      positional
- [ ] The paste tries the `session.resume`-hinted flag first and falls back to
      the other on failure
- [ ] The paste reads `settled` and `idle` before piping `--json=script` to `sh`
- [ ] Every optional value the paste reads is guarded with `${var:-}` or
      `${var:+...}`
- [ ] The `A complete minimal driver` heading is unchanged and the paste is
      still exactly one fenced block
- [ ] The paste runs with only `$PATH` and `$HOME` in its environment, or every
      new env dependency has its own Prerequisites section
- [ ] The line-by-line walkthrough below the fence describes the rewritten
      paste, with no `eval`/`unset`/`gtd_` sentence left
- [ ] `driver-doc.feature` passes against the rewritten paste, including its
      `--entry fix-precheck` scenario

## Task 3 — drop `jq` from `src/Install.ts` and `docs/cli.md`

`src/Install.ts`'s driver briefing and its `EDIT_COMMAND` (already jq-free,
pinned by `Install.test.ts`) lose their three `jq` mentions in favour of the
selector. `docs/cli.md:262`'s "pipes stdout into `jq`" accepted-cost note goes
with them.

The `jq .file` warning is not merely deleted — **`--json=<sel>` prints nothing
for an absent field where `jq .file` printed the string `null`**, which is the
whole reason the warning existed. Say so where the warning was.

Paths: `src/Install.ts`, `src/Install.test.ts`, `docs/cli.md`.

- [ ] `src/Install.ts`'s driver briefing describes the selector, not `--sh` and
      not `jq`
- [ ] `EDIT_COMMAND` still passes its `Install.test.ts` pin
- [ ] `docs/cli.md`'s "pipes stdout into `jq`" accepted-cost note is gone
- [ ] The absent-field behaviour (nothing, not `null`) is documented where the
      `jq .file` warning was
- [ ] `grep -rn 'gtd_\|jq' src docs` returns no hit outside a deliberate
      historical note

## Task 4 — migrate the remaining feature files

Seven files are mechanical: drop `--sh`-only scenarios, convert
`--sh`-then-assert scenarios to the equivalent selector read.
`command-surface.feature` gains the `gtd next --sh` → exit 2 scenario.

**`next-status-content-parity.feature`'s five `--sh` hits were already
re-expressed against `--json` in package 1** — this package touches it only if
something is left.

Paths: `tests/integration/features/command-surface.feature` (13 hits),
`tests/integration/features/land.feature` (7),
`tests/integration/features/driver-json-status.feature` (6),
`tests/integration/features/steering-modes.feature` (4),
`tests/integration/features/ansi-free-stdout.feature` (4),
`tests/integration/features/tmpdir-and-git-dir.feature` (2),
`tests/integration/features/validate.feature` (2).

- [ ] No feature file references `--sh` except the scenario asserting it exits 2
- [ ] `command-surface.feature` asserts `gtd next --sh` exits 2
- [ ] `land.feature`'s exit-code contract (0/3/settled/1) still holds
- [ ] `driver-json-status.feature`'s status assertions read through selectors
- [ ] `ansi-free-stdout.feature` covers selector output as ANSI-free
- [ ] `steering-modes.feature` and `validate.feature` read `validate` through a
      selector
- [ ] `tmpdir-and-git-dir.feature` still asserts no git-dir write
- [ ] The full suite is green
