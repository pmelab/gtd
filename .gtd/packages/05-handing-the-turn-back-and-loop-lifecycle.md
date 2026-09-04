# 05 — Handing the turn back, and loop lifecycle

Two requirements land together because both center on the same new process port
and the same in-memory registry; the second is that module's lifecycle half, not
a consumer of an interface the first exposes.

The load-bearing constraint: **`CommandRunner` cannot run the loop.** It is
pinned to the repository root, it **merges standard output into standard error**
into one combined string, and it has no signal handling. Separate streams and
signals are both required here, so a second process port is added — and
`CommandRunner`'s doc comment claiming to be "the only place gtd itself spawns a
subprocess" becomes false and must be amended in the same commit.

## Requirement — concern 6

### 6. Handing the turn back, and running the loop — TECHNICAL

The done action writes the steering file, then spawns the **configured loop
command** with the worktree as cwd and waits for it to return. The server drives
no beats itself: a human's pending edit reaches the loop as an ordinary
`kind: capture` beat, which any driver lands like any other. The phone returns
to the fleet list, where the worktree sits in **Working** until the child exits.

Completion is "the child exited, now re-read `gtd next --json`" — the exit code
is ignored and the output is not parsed, because the beat document is the truth.
Any loop command in any language satisfies that contract. Failures show the
captured output and the exit code inline, since gtd exits 1 for every refusal
and the text is the only thing that distinguishes them.

**Acceptance**: the spawned command runs with a shim directory prepended to
`PATH` so `gtd` resolves to that worktree's own binary — a mode's seeded
validate command is literally `gtd check <mode> '<file>'`, invoked by name from
inside an emitted script. Everything else a driver owes gtd — agent dispatch,
sessions, `--cost`/`--model`, the self-validation fix loop and its retry cap,
the first-beat rule, reading `settled`/`idle` before piping — belongs to the
loop command, not here. See [#217](https://github.com/pmelab/gtd/issues/217) and
[#226](https://github.com/pmelab/gtd/issues/226).

## Requirement — concern 7

### 7. Loop lifecycle — TECHNICAL

An in-memory registry of the server's own child processes; log-mtime freshness
as the only available signal for a foreign driver, and a worktree already being
driven is never double-driven. Stop sends `SIGINT` to the loop command,
escalating to `SIGKILL` after a timeout — the same signal Ctrl-C sends, which
gtd's exit-code table already covers at 130, giving the loop a chance to finish
its beat. A server restart kills the child and persists nothing: each worktree
reports its real rest, a dirty `prompt` rest reads as interrupted, and nothing
auto-resumes. Concurrency is unlimited by explicit decision.

**Acceptance**: session ids are derived, never stored, so a restart loses
nothing resumable — and they are the loop command's concern in any case.
Foreign-driver detection is imprecise by nature and must say so where it is
surfaced. See [#225](https://github.com/pmelab/gtd/issues/225).

## Tasks

### T1 — the loop process port

Spawn the configured loop command with the worktree as its working directory,
**separate** standard output and standard error pipes, and a shim directory
prepended to the path so a bare `gtd` resolves to that worktree's own binary — a
mode's seeded validate command is literally `gtd check <mode> '<file>'`, invoked
by name from inside an emitted script.

Paths: `src/serve/Loop.ts`, `src/serve/Loop.test.ts`, `src/serve/Shim.ts`,
`src/serve/Shim.test.ts`, `src/CommandRunner.ts`.

- [ ] standard output and standard error arrive as two separate strings
- [ ] the child's working directory is the worktree, not the server's
- [ ] a bare `gtd` inside the child resolves to that worktree's own binary
- [ ] the shim directory is **prepended** to the path, so it wins over any
      earlier entry
- [ ] an emitted script invoking `gtd check` by name succeeds inside the child
- [ ] two worktrees driven at once each get their own shim, with no crosstalk
- [ ] `CommandRunner` is unchanged in behaviour and its doc comment no longer
      claims to be the only spawn site

### T2 — the done action

Write the steering file, then spawn the configured loop command and wait for it
to return. **The server drives no beats itself**: a human's pending edit reaches
the loop as an ordinary capture beat, which any driver lands like any other. The
phone returns to the fleet list, where the worktree sits in Working until the
child exits.

Completion is "the child exited, now re-read the beat" — **the exit code is
ignored and the output is not parsed**, because the beat document is the truth.
Any loop command in any language satisfies that contract.

Everything else a driver owes gtd — agent dispatch, sessions, cost and model
recording, the self-validation fix loop and its retry cap, the first-beat rule,
reading the settled and idle fields before piping — **belongs to the loop
command, not here.**

Paths: `src/serve/Loop.ts`, `src/serve/Router.ts`, `src/serve/Loop.test.ts`.

- [ ] the steering file is written before the child is spawned
- [ ] a write failure aborts before spawning anything
- [ ] the beat is re-read after the child exits, on any exit code
- [ ] the child's output is never parsed for state
- [ ] a loop command written in a language other than JavaScript works unchanged
- [ ] the phone returns to the fleet list immediately, without waiting for the
      child
- [ ] the worktree reads as Working from spawn until exit
- [ ] the server emits no beat, lands no turn, and creates no session itself

### T3 — the registry and the double-drive refusal

An in-memory map from worktree id to child handle. **A worktree already being
driven is never double-driven** — the done action refuses rather than queueing.

Paths: `src/serve/Registry.ts`, `src/serve/Registry.test.ts`,
`src/serve/Router.ts`.

- [ ] a second done action on a worktree with a live child is refused
- [ ] the refusal is a named value the phone can render, not a silent no-op
- [ ] the entry is removed when the child exits, so a later done action succeeds
- [ ] the entry is removed when the child dies by signal, not only on a clean
      exit
- [ ] two different worktrees can be driven concurrently
- [ ] concurrency is unlimited by explicit decision — no cap, no queue

### T4 — foreign-driver freshness

For a driver the server did not spawn, the **only available signal** is the
mtime of the log path the beat already reports. That signal is imprecise by
nature: the log path honours an environment override first, then the git
directory, gtd never creates or truncates the file, and a driver may not write
to it at all.

**Foreign-driver detection is imprecise by nature and must say so where it is
surfaced** — in those words, not hedged into a tooltip.

Paths: `src/serve/Registry.ts`, `src/serve/Fleet.ts`,
`src/web/screens/Fleet.tsx`.

- [ ] a recently touched log with no registry entry reads as possibly driven
      elsewhere
- [ ] a stale log with no registry entry does not read as driven
- [ ] a worktree with no log file at all does not read as driven
- [ ] the UI states the imprecision on the row itself, not behind a hover
- [ ] a registry entry always wins over the log signal
- [ ] the freshness threshold is a single named constant, not repeated

### T5 — stop

Stop sends an interrupt signal first, escalating to a kill signal after a
timeout. The interrupt is the same signal Ctrl-C sends, and the process
re-raises it as a real signal death after its fiber unwinds — so the loop gets a
chance to finish its beat, and a parent's wait sees a genuine signal death at
130, a code the exit-code table already carries. **No new exit code is needed.**

Paths: `src/serve/Loop.ts`, `src/serve/Loop.test.ts`, `src/serve/Router.ts`.

- [ ] stop sends the interrupt signal first, never the kill signal first
- [ ] a child that exits on its own before the timeout is never sent the kill
      signal
- [ ] a child still alive after the timeout is sent the kill signal
- [ ] the escalation timeout is a single named constant
- [ ] the registry entry is removed either way
- [ ] the exit-code table is unchanged, still exactly `0`, `1`, `2`, `130` and
      `143`
- [ ] stop on a worktree with no live child is a no-op, not an error

### T6 — restart

The child is killed and **nothing is persisted**. Each worktree reports its real
rest on the next read, a dirty prompt rest reads as interrupted, and **nothing
auto-resumes**.

Session ids are derived, not stored — they are a version-5 UUID over a fixed
namespace — so a restart loses nothing resumable, and they are the loop
command's concern regardless.

Paths: `src/serve/Registry.ts`, `src/serve/Server.ts`,
`src/serve/Registry.test.ts`.

- [ ] shutdown kills every live child
- [ ] no file, no lock and no reference records what was running
- [ ] after restart every worktree reports its real rest with no Working rows
      carried over
- [ ] a worktree left dirty at a prompt rest reads as interrupted
- [ ] no worktree is auto-resumed on start
- [ ] no session id is written anywhere by the server
