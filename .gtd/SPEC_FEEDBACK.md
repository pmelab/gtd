# Spec feedback — 05 Handing the turn back, and loop lifecycle

One problem. Every acceptance criterion is otherwise met and `npm test` is
green.

## The lifecycle feature file claims coverage that does not exist

`tests/integration/features/serve-loop-lifecycle.feature`'s own prose says:

> The `done`/`stop` tRPC round trip itself — spawning the configured loop
> command, registering it, killing it on shutdown — is exercised at the
> `Server.test.ts` unit tier instead (a real HTTPS listener, a real tRPC client,
> no `gtd` subprocess needed for that part)

`src/serve/Server.test.ts` contains no such test. Its one real-client test
(`describe("the tRPC API surface mounted under /trpc")`, line 512) calls only
`runCommand`, `view`, and `readSteeringFile`. There is no `client.done` or
`client.stop` call anywhere in the repository —
`grep -rn "client.done\| client.stop" src tests` returns nothing. Its shutdown
test (line 421) spies on `Registry.prototype.killAll` behind a fake
`HttpsServer` with an empty registry, so no child is ever spawned or killed
there either.

The consequence is real, not just a stale sentence: the live wiring in
`Server.ts#createContext` —
`startLoop(worktreePath, { registry, spawn: liveLoopSpawn, createShim: (worktreePath) => createShim(fs, worktreePath), command: config?.loop })`
— is never executed by any test at any tier. `Loop.test.ts` exercises
`startLoop` only against injected fakes; `Router.test.ts` exercises
`done`/`stop` only against an injected `ctx.startLoop`/`ctx.stopLoop`. A wrong
argument, a swapped dep, or a `config?.loop` that never reaches the spawn would
pass the whole suite.

Fix one of the two:

- add the test the feature file already promises — a real `client.done` against
  a real `runServeCommand` with a scripted `serve.loop` command, asserting the
  child actually ran in the worktree, that a second `done` refuses
  `already-driving`, and that `client.stop` ends it; or
- correct the feature file's prose to state where the coverage actually is, and
  that the live `createContext` wiring is unproven.
