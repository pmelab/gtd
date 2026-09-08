# Spec feedback — 05 Handing the turn back, and loop lifecycle

## 1. The shim resolves `gtd` to the SERVER's binary, not the worktree's — T1 (blocking)

T1's criterion is "a bare `gtd` inside the child resolves to **that worktree's
own binary**", and requirement 6 repeats the same words. `src/serve/Shim.ts`
does something else: `ownGtdBinary()` captures `process.execPath` +
`process.argv[1]` — the build running `gtd serve` — and `createShim` takes no
worktree path at all. `Server.ts`'s wiring (`createShim: () => createShim(fs)`)
confirms it: every worktree gets a byte-identical shim pointing at one shared
binary, prepended AHEAD of everything on `$PATH`.

This also contradicts the sibling module the beat read already uses:
`Beat.ts#liveRunInWorktree` prepends `join(cwd, "node_modules/.bin")` so
`gtd next --json` runs that worktree's own install, falling through to the
inherited `$PATH` only when there is none. The loop child inverts that
precedence.

Concrete failure: a worktree pinned to an older local `@pmelab/gtd` is read by
`readLocalGtdVersionAt` as that older version and has its beat produced by that
older binary, but its loop child's `gtd check`/`gtd land` run the server's
build. Two different gtd versions drive one worktree in the same turn.

`Shim.ts`'s doc comment states the current behaviour as a deliberate decision
("regardless of what a bare `gtd` on `$PATH` would otherwise resolve to").
Either implement the spec (per-worktree shim: worktree `node_modules/.bin/gtd`
first, server binary as the fallback) or get the spec's wording changed — do not
leave the code and the spec asserting opposite things.

No test covers this axis: `Shim.test.ts` asserts against `process.execPath`, and
`Loop.test.ts` supplies a hand-written fake shim dir. T1's "two worktrees driven
at once each get their own shim, with no crosstalk" currently passes only
trivially, since the two shims are identical.

## 2. Shim temp directories are never removed (secondary)

`createShim` calls `fs.makeTempDirectory` (unscoped) per spawn and nothing ever
deletes it — not on child exit, not on `Registry.killAll`. A long-lived
`gtd serve` leaks one directory per done action. Small per item, unbounded over
a server's lifetime. Not a listed criterion; fix or consciously accept.
