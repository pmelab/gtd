# Spec feedback — 05 handing the turn back, and loop lifecycle

Five concrete problems. T1/T3/T5 have real holes in the failure paths; two
criteria have no test at all.

## 1. `startLoop` leaks the `reserve` placeholder on any failure — T3

`src/serve/Loop.ts#startLoop` reserves the id, then `await`s `createShim()` and
calls `deps.spawn(...)` with no `try`/`catch`. If shim creation rejects (temp
dir unwritable, `chmod` fails) or `spawn` throws, the placeholder installed by
`Registry.reserve` is never released.

Consequence: that worktree is registered as driving forever. Its fleet row is
pinned to Working (`Fleet.ts#bucketOf`'s `driving` override wins over
everything), every later `done` is refused `already-driving`, and nothing
removes the entry short of a server restart — the placeholder's `wait` never
resolves, so `Registry.register`'s own removal hook can never fire.

Violates T3's "the entry is removed when the child exits, so a later done action
succeeds": here there is no child, and the entry is permanent.

## 2. `stopLoop` hangs forever against a `reserve` placeholder — T5

`Registry.reserve` installs `wait: new Promise(() => {})`. `stopLoop` →
`registry.get` returns that placeholder → `stopChild` awaits `child.wait`, which
never resolves. The `stop` tRPC mutation therefore never responds; the
escalation `setTimeout` also stays pending.

`Registry.ts#reserve`'s own doc comment asserts the opposite — "A stop arriving
in that same narrow window is a no-op against the placeholder — the caller can
retry". It is not a no-op; it is an unresolvable request. Either the placeholder
must be distinguishable from a real child (so stop can be a true no-op or a
cancel), or the comment is wrong. Both readings breach T5's "stop on a worktree
with no live child is a no-op, not an error".

## 3. `liveLoopSpawn` attaches no `error` listener — T1

`src/serve/Loop.ts#liveLoopSpawn` listens for `exit` only. Node emits `error`
(not `exit`) when the process cannot be spawned at all — no `bash` on `PATH`, an
unreadable or vanished `cwd`. Two failures follow:

- an unhandled `error` event on a `ChildProcess` emitter throws, taking down the
  whole `gtd serve` process — a worktree removed between the fleet read and the
  done action kills the server
- `wait` never resolves, so the registry entry leaks exactly as in problem 1

`CommandRunner`'s contract explicitly separates "a SPAWN failure fails the
Effect" from "a non-zero EXIT is a value". The new port drops that distinction
instead of mirroring it.

## 4. T4's UI criterion is asserted nowhere

"the UI states the imprecision on the row itself, not behind a hover" — the line
exists in `src/web/screens/Fleet.tsx:54-58`, but `test:web` (the storybook
vitest project) is the web test tier and every fixture in
`src/web/screens/Fleet.stories.tsx` hardcodes `foreignDriverPossible: false`
(lines 31 and 43). No story or test ever renders the "possibly driven elsewhere
— imprecise" text, so nothing fails if it is deleted or moved into a `title`
attribute. Add a story with `foreignDriverPossible: true`.

## 5. T6's shutdown wiring is asserted nowhere

`Registry.killAll` is unit-tested, but `src/serve/Server.test.ts` never
references the `Registry` or the shutdown path at all (grep: zero hits for
`Registry`/`registry`/`killAll`). "shutdown kills every live child" and "after
restart every worktree reports its real rest with no Working rows carried over"
rest entirely on the `Effect.ensuring` block at `Server.ts:365-378`, untested.

## 6. Comments cite package task labels that are about to vanish

`src/serve/Loop.ts`, `Registry.ts`, `Fleet.ts`, `Router.ts`, `Server.ts`,
`Beat.ts` and several `src/web/**` files carry doc comments phrased as "T4's own
imprecise foreign-driver signal", "T6's restart", "(T3)". The package file these
labels point at is deleted when the process closes, leaving dangling references
to a document no reader can find. AGENTS.md wants the constraint and its reason
at the code — state the invariant ("a registry entry always wins over the log
mtime"), not the spec label. Pre-existing in packages 01–04's files too; fix at
least the ones this package touched.
