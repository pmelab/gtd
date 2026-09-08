# Spec feedback — 05 Handing the turn back, and loop lifecycle

Every acceptance bullet in T1–T6 is implemented and covered by a green test;
`typecheck`, `lint`, `deadcode` and `format:check` all pass. What follows is
what is still wrong, not a re-litigation of the design.

## 1. `serve.loop`'s contract is undocumented — a user-facing fact the code cannot state

`docs/configuration.md`'s `loop` bullet is still the one sentence it was before
this package: "the shell command `gtd serve` runs to drive a session's loop."
`docs/cli.md`'s `serve` row says nothing either. This package established the
entire contract a person writing that command must satisfy, and none of it is
written down anywhere a user reads:

- it runs with the WORKTREE as cwd, never the server's directory
- a shim directory is prepended to `$PATH`, so a bare `gtd` inside the command
  resolves to that worktree's own install (`node_modules/.bin/gtd`) when it has
  one, else the running `gtd serve` build
- its exit code is ignored and its output is never parsed — the beat document is
  the truth; any language works
- a non-zero exit / failed spawn has its captured stdout+stderr and exit code
  shown on the fleet row
- Stop sends `SIGINT`, escalating to `SIGKILL` after 5 s, so the command gets
  one beat's worth of grace
- concurrency across worktrees is unlimited — no cap, no queue
- everything else a driver owes gtd (agent dispatch, sessions, `--cost`/
  `--model`, the self-validation fix loop and its retry cap, the first-beat
  rule, reading `settled`/`idle`) belongs to that command, not to the server

This is exactly what `AGENTS.md` says documentation is FOR — what a config key
accepts and what the driver protocol demands. Add it to the `serve:` key's
`loop` bullet (and/or a short `docs/driver.md` section on being spawned by
`gtd serve`). Nothing about module boundaries or call flow.

## 2. `LoopRunner` is a test-only abstraction with no production consumer

`src/serve/Loop.ts` exports a `Context.Tag("LoopRunner")` plus `.Live` and
`.layer`. Nothing in `src/` uses it: `Server.ts` calls `liveLoopSpawn` directly,
`Loop.ts`'s own doc comment admits this ("`Server.ts` itself calls
`liveLoopSpawn` directly"), and `Router.ts` only mentions it in prose to say it
never imports it. Every reference is in `Loop.test.ts`.

T1 asked for a loop process port; `liveLoopSpawn` + `LoopChild` + the injected
`StartLoopDeps.spawn` already ARE that port, and they are what production and
`Server.test.ts`'s live wiring use. The Effect service exists "for symmetry"
with `CommandRunner` and for tests that could just call `liveLoopSpawn`. Delete
the tag and both layers; point `Loop.test.ts`'s `LoopRunner.Live` blocks at
`liveLoopSpawn` and its `LoopRunner.layer` block at a plain function.

## 3. `Loop.ts` imports its own return type from its consumer

`src/serve/Loop.ts` does `import type { StartLoopResult } from "./Router.js"`,
while `Router.ts` imports `DriveRefusalReason` from `Registry.ts`. The port
depends on the tRPC layer that calls it — backwards, and the opposite of how
`Write.ts`/`ReadSteeringFile.ts`/`Diff.ts` each own their own result union with
the router importing it. `StartLoopResult` is `startLoop`'s result; move it to
`Loop.ts` and have `Router.ts` import it from there.

## 4. The interrupted badge asserts a cause it cannot know, and can contradict the row's other badge

`src/web/screens/Fleet.tsx` renders
`Interrupted — a restart left this rest dirty with nothing driving it` for any
`prompt` rest with pending changes. That is also the normal mid-turn shape of a
worktree a FOREIGN driver is actively working in — in which case the very next
line on the same row reads `possibly driven elsewhere`, and the two directly
contradict each other. The bucketing is right (T6 wants a dirty prompt rest in
Wants you); the copy over-claims a cause the server has no way to establish.
State the observation, not the inferred history — and do not print both
sentences on one row.

## 5. Stop is offered on rows the server cannot stop, and says nothing when it can't

`FleetRow` renders the Stop button for every `working`-bucket row. A worktree in
Working because its own beat is not-idle with an agent actor — i.e. a foreign
driver, no registry entry — gets a Stop button whose mutation returns `ok: true`
after doing nothing, the refetch leaves the row exactly as it was, and the human
gets no explanation. T5's "a no-op, not an error" is about the server's
behaviour, not about offering a control that silently does nothing. Either gate
the button on a server-owned child, or tell the row's reader that gtd cannot
signal a driver it did not spawn.
