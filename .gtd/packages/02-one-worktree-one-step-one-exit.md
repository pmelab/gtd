# One worktree, one step, one exit

The fleet deletion and the handoff inversion are the same edit to the router's
procedure set and the server's context construction, so they cannot land apart.
Two requirements, carried below independently.

## Requirement A

### Handing back terminates the server process

PRODUCT. The UI's handoff action **exits the `gtd ui` process**. It does not
spawn a loop command, register a child, watch it, or signal it. The outer loop —
the thing that started `gtd ui` — reacts to the exit and drives the next turn
itself.

That inverts the shipped control flow. Today the phone's `done` mutation writes
the note and starts a configured `serve.loop` child inside a long-lived server
that outlives every turn. Under the note the server lives for exactly one step:
it starts, shows that step, takes the human's input, and dies. `done` must still
write the human's note durably **before** the process goes away — an exit that
races the write loses the turn's input.

The whole `serve.loop` contract goes with it: worktree cwd, the shim `$PATH`,
SIGINT-then-SIGKILL-after-5s, unlimited cross-worktree concurrency, and the
inline failure display on a fleet row. None of it has an owner once handoff is
an exit. Delete `src/serve/Loop.ts` and `src/serve/Shim.ts`, the `loop` config
sub-key, and `docs/driver.md`'s "Being spawned by `gtd serve`" section, which
states that same contract a second time.
`tests/integration/features/serve-loop-lifecycle.feature` is rewritten, not
patched — every scenario in it pins spawn behaviour that no longer exists.

**Handoff exits 0, and so does every other clean shutdown.** The UI never
signals "the human quit" apart from "the human handed off" — the outer loop
re-reads gtd state after the exit and decides from there, so it needs no
distinction. That keeps `docs/cli.md`'s pinned exit-code table unchanged: 0
success, 1 runtime error, 2 usage error, 130/143 for SIGINT/SIGTERM. A signal
still exits 130/143 because the runtime does that, not because the UI encodes
intent in it.

Risk, stated plainly: a human who closes the tab without handing off produces
the same exit 0 as a handoff, so a loop that reruns on exit 0 will loop on a
step whose input never arrived. State on disk is the only thing that
distinguishes them, and the loop must read it.

Acceptance: a scenario drives handoff and asserts the process exits 0, the note
is on disk, and no child process was spawned; a scenario closes the UI without
handing off and asserts exit 0 with no note written; a config file with
`ui.loop` fails to decode.

## Requirement B

### Discovery, the fleet, and the loop-spawn machinery come out

TECHNICAL. "No discovery, no fleet listing" deletes a large fraction of the
branch, not a screen. Unreachable under the rescope:

- root scanning and worktree ids (`src/serve/Discover.ts`) and the `roots`
  config sub-key that feeds it
- the fleet read, its bucket ordering policy, and the "possibly driven
  elsewhere" mtime heuristic (`src/serve/Fleet.ts`)
- the live-child registry (`src/serve/Registry.ts`)
- the beat cache — its whole reason to exist was avoiding a per-worktree cost
  across a 30-row fleet screen; a single worktree reads its own beat once, so
  the slot/concurrency machinery in `src/serve/Beat.ts` and its handoff-race
  tests go with it
- the 5s fleet poll and pull-to-refresh

**Delete rather than keep dormant.** A single-worktree server that still carries
a registry and a discovery walk is the same code with an unused door.

The tRPC surface changes shape here, not just size: `runCommand`, `writeNote`,
`done`, `stop`, `view`, `diff` and `readSteeringFile` each take a
client-supplied `worktreePath` today, and `fleet` disappears entirely. The
server knows its one worktree, so **`worktreePath` leaves every procedure
input**. That is also how the review's confirmed path-injection defect dies — an
unvalidated client string used as both a write target and a spawn cwd. The
second confirmed defect, the import-time version throw in the beat reader, must
be gone rather than relocated; check it explicitly.

`src/web/drafts.ts` is unreachable — zero importers outside its own test, with
`fallow` reporting clean only because that test counts as an entry point. Delete
it here unless the client-entry concern genuinely wires it.

Acceptance: `Discover.ts`, `Fleet.ts`, `Registry.ts`, `drafts.ts` and their
tests are gone and `npm test` stays green; a router test asserts no procedure
accepts a path from the client; `fallow` clean with no test-only entry point
propping a dead module up.

## Tasks

### Delete the discovery, fleet, registry and spawn modules

`src/ui/Discover.ts`, `src/ui/Fleet.ts`, `src/ui/Registry.ts`, `src/ui/Loop.ts`,
`src/ui/Shim.ts`, `src/web/drafts.ts`

- [ ] All six modules and every one of their test files are gone
- [ ] No module imports them; `npm run typecheck` passes
- [ ] `npm run deadcode` (`fallow --summary --quiet`) is clean, with no
      test-only entry point propping a dead module up

### Strip the cache out of the beat reader and fix the import-time throw

`src/ui/Beat.ts`

- [ ] `BeatCache` and its slot/concurrency machinery, its mtime memo, and its
      handoff-race tests are gone
- [ ] The `foreignDriverPossible` mtime heuristic is gone
- [ ] The version-support check, the `gtd next --json` spawn in a worktree, and
      the parse into a row all survive
- [ ] `FleetRow`/`BrokenRow` are renamed `Step`/`BrokenStep` under
      `StepRead = Step | BrokenStep`; `FleetKind` is `StepKind` with the same
      five values `capture`/`message`/`script`/`prompt`/`stalled`
- [ ] `const GTD_VERSION = findOwnVersion()` no longer runs at module scope — it
      is a memoized function called on first use
- [ ] A test importing this module from a directory with no `@pmelab/gtd`
      `package.json` above it loads the module instead of throwing

### Reshape the router: no client path, no fleet, no spawn, no shell

`src/ui/Router.ts`

- [ ] A `step` query takes no input and returns the `StepRead` for the served
      worktree
- [ ] `writeNote`, `done`, `view`, `diff`, `readSteeringFile` survive with
      `worktreePath` removed from every input validator
- [ ] `fleet`, `stop` and `runCommand` are deleted
- [ ] A router test asserts no procedure input carries a filesystem path from
      the client
- [ ] `RouterContext` drops `readFleet`, `startLoop`, `stopLoop` and gains
      `readStep` and `handOff`

### Bind the server to its one worktree

`src/ui/Server.ts`

- [ ] `createContext` supplies `cwd.root` as the worktree for every read and
      write; no path reaches it from a request
- [ ] No `Registry` and no `BeatCache` are constructed
- [ ] `src/ui/Server.test.ts` passes

### Refuse to start on a step the UI cannot render

`src/ui/Server.ts`, `src/Commentary.ts`, `src/Cli.ts`

- [ ] The beat is read **before** the bind host and the certificate are
      resolved, so a refusal never invokes `openssl`
- [ ] The server starts only when the step is `kind: "prompt"` carrying a `file`
      and a `mode` that resolves to a registered steering format
- [ ] A `message`, `script`, `capture` or `stalled` step, an `idle` worktree,
      and a `prompt` whose `mode` resolves to no format each **exit 2** with no
      port bound
- [ ] The refusal message names the step's `label` and what the worktree rests
      at
- [ ] `Commentary.ts` gains `GtdUsageError extends GtdError`, so the refusal
      keeps its remedy lines
- [ ] `Cli.ts#report` maps `GtdUsageError` to `EXIT_USAGE_ERROR` alongside
      `SelectorUsageError`; every other error still maps to `EXIT_RUNTIME_ERROR`
- [ ] `src/ExitCodes.ts`'s closure set is still five numbers

### Make handoff exit the process without racing its own response

`src/ui/Router.ts`, `src/ui/Server.ts`

- [ ] `done` awaits the write first; a refused write throws the existing
      `WriteNoteRefusal` and nothing shuts down
- [ ] On a successful write `done` returns `{ ok: true }` and calls
      `ctx.handOff()`
- [ ] `handOff` resolves a deferred the main Effect awaits in place of
      `Effect.never`, scheduled on the HTTP response's `finish` event
- [ ] A **2s fallback timer** resolves the deferred if the response never
      flushes, so a vanished client cannot wedge the process
- [ ] `Effect.ensuring` closes the listener and the process exits 0
- [ ] No child process is spawned by any code path

### Drop `roots` and `loop` from the config struct

`src/ConfigSchema.ts`, `schema.json`

- [ ] `UiSchema` carries only `port`, `host`, `cert`, `key`
- [ ] A config file with `ui.loop` fails to decode at exit 2
- [ ] A config file with `ui.roots` fails to decode at exit 2
- [ ] `schema.json` regenerates without either sub-key

### Delete the driver contract the spawn path documented

`docs/driver.md`, `docs/configuration.md`

- [ ] `docs/driver.md`'s "Being spawned by `gtd serve`" section is deleted whole
- [ ] `docs/configuration.md` no longer documents `roots` or `loop`
- [ ] The "A complete minimal driver" section and its single fenced bash block
      are untouched, and `driver-doc.feature` still passes
- [ ] `docs/**` stays in `test:unit`'s and both e2e tasks' `inputs`

### Rewrite the lifecycle feature around exit codes, not spawns

`tests/integration/features/serve-loop-lifecycle.feature` →
`ui-lifecycle.feature`

- [ ] Every spawn scenario is gone
- [ ] The SIGINT 130 and SIGTERM 143 scenarios stay, binding a real socket
- [ ] A scenario drives handoff and asserts exit 0, the note on disk, and no
      child process spawned
- [ ] A scenario closes the UI without handing off and asserts exit 0 with no
      note written
- [ ] One scenario per non-renderable step kind asserts exit 2 and no bound port
- [ ] A scenario with `ui.loop` in config asserts a decode failure
- [ ] `npm test` is green
