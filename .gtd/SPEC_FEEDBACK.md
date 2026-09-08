# Spec feedback — 05 Handing the turn back, and loop lifecycle

The server half (T1, T3, T4, T5, T6) is sound and green: 205 unit tests pass,
`CommandRunner`'s doc comment is amended, the shim/registry/stop/restart
criteria are each pinned by a test. Four gaps remain.

## 1. `done` and `stop` have no client caller — the phone half of T2/T3/T5 is unreachable

`src/serve/Router.ts:320` (`done`) and `:346` (`stop`) are dead endpoints. Every
`trpc.*` call site in `src/web` is one of `fleet`, `diff`, `readSteeringFile`,
`writeNote` — nothing calls `done` or `stop`. Concretely unmet:

- `src/web/screens/Plan.tsx:401` and `src/web/screens/Review.tsx:404` wire only
  `trpc.writeNote.useMutation`. A human finishing a steering turn saves notes
  and the turn is never handed back — no screen has a done control at all
  (`grep -n "Done\|onDone" src/web/screens/*.tsx` hits nothing outside
  `Deck.tsx`'s next-button label).
- T2 "the phone returns to the fleet list immediately, without waiting for the
  child" — no navigation exists to verify; `Plan.tsx:395` still says "routing
  between screens is a later package's task", and 05 is the last package.
- T2 "the worktree reads as Working from spawn until exit" — true in
  `Fleet.ts:81`, but never reached, since nothing spawns from the phone.
- T3 "the refusal is a named value the phone can render" — `DriveRefusal` is
  attached by the error formatter, but `src/web/api.ts` has no
  `driveRefusalFrom` counterpart to `writeRefusalFrom:33`, and no component
  reads it.
- T5 stop — no stop control on a Working row in `src/web/screens/Fleet.tsx`.

T2's `Paths:` line lists only `Loop.ts`/`Router.ts`/`Loop.test.ts`, so the fix
turn must decide whether to widen scope or record the deferral explicitly. It
cannot stay silent: as shipped, the feature's central action is not invocable.

## 2. A loop failure is never surfaced — requirement 6's last sentence is unimplemented

Requirement 6: "Failures show the captured output and the exit code inline,
since gtd exits 1 for every refusal and the text is the only thing that
distinguishes them."

`startLoop` (`src/serve/Loop.ts:148`) registers the child and returns; nobody
ever reads `child.wait`. `LoopOutcome.stdout`, `.stderr`, `.status` and
`.spawnError` have no consumer outside `Loop.test.ts` — the registry's
`child.wait.finally` (`Registry.ts:50`) drops the outcome on the floor.

Failure scenario: a misconfigured `serve.loop` (typo'd binary) exits 127 in
under a second with the reason on stderr. The row silently leaves Working and
looks identical to a clean drive. Same for `spawnError` (vanished worktree) —
captured at `Loop.ts:60`, then discarded.

## 3. T2 "the beat is re-read after the child exits, on any exit code" — nothing triggers the re-read

`src/web/screens/Fleet.tsx:207` is a bare `trpc.fleet.useQuery()`: no
`refetchInterval`, and `src/web/api.ts` sets no default. Nothing on the server
invalidates or pushes on child exit either — `Registry.register` only deletes
the map entry.

Failure scenario: the human hands back a turn, the child exits two minutes
later. The fleet keeps showing the stale Working row until the human pulls to
refresh by hand. The beat is re-read on the _next human gesture_, not on exit.

## 4. No integration scenario for the loop lifecycle

`tests/integration/features/serve.feature` has 4 scenarios and none mention
loop, done, stop, Working or driving — `grep -n "loop\|done\|stop\|Working"`
over it is empty. AGENTS.md: "create cucumber.js scenarios for each new
feature." Nothing at the integration tier exercises done → spawn → exit → beat
re-read, or a restart killing live children. `Server.test.ts:421` covers
`killAll` at the unit tier only.
