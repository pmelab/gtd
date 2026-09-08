The rescope is a deletion with three edits around it. `gtd serve` becomes
`gtd ui`, the fleet machinery comes out, and handing back stops meaning "spawn a
child" and starts meaning "exit". Nothing here is a build from nothing — 17,800
lines of shipped feature are on the branch and every package below is a change
to them.

Three packages, in order. Each is green on its own, and each depends only on the
one before it.

## Package 1 — `gtd ui`, its config key, and its docs pins

The rename, landed atomically with everything that reds on it. No behaviour
changes except the repo guard.

`src/Cli.ts`: token and kind `serve` → `ui`, the help row, and every
`scope`/`scopeError` predicate on `--port`, `--host`, `--self-signed`, `--dev`.
`--port`'s `scopeError` reads "only valid for `gtd visualize`/`gtd serve`" and
its help text names both defaults — both get the new name, which is the fix the
concern asks for.

`src/program.ts`: `needsOf("ui")` moves out of `"config"` and `ui` leaves
`standaloneKinds()`, so the shared repo-root-and-commit guard runs and nothing
else changes. **Outside a repository `gtd ui` exits 1**, the runtime-error code,
identically to `gtd land` or `gtd next` — `assertRunningFromRepoRoot` fails with
a plain `Error` and `Cli.ts#report` maps that to `EXIT_RUNTIME_ERROR`. The
pinned exit-code table gains no new meaning. The `standaloneKinds` doc comment
says "seven kinds" and the list drops to six — its own pin test catches that if
it is missed.

`--dev` stays, flag, scope entry, help row and all. `Server.ts` keeps
`findPackageRoot`, `readDevTemplate` and `rebuildDevClientScript` unchanged: the
walk starts at the module's own file, never the invoking directory, so moving
`gtd ui` inside a repository does not change what it finds or how it fails.

`src/ConfigSchema.ts`: `serveJsonSchema` → `uiJsonSchema`, `ServeSchema` →
`UiSchema`, `ServeConfig` → `UiConfig`, top-level key `serve:` → `ui:`.
`schema.json` regenerates in `postbuild`. The struct already rejects unknown
sub-keys, so a config file carrying `serve:` fails to decode at exit 2 with no
new code.

`src/serve/` → `src/ui/`, one `git mv`, and every `gtd serve:` message prefix in
`Server.ts` becomes `gtd ui:`. `runServeCommand` → `runUiCommand`,
`ServeCommandOptions` → `UiCommandOptions`, `ServeRequirements` →
`UiRequirements`. Turbo `inputs` are `src/**` throughout, so no task wiring
moves.

Docs: `docs/cli.md`'s `## Commands` block and its flags block are pinned equal
to rendered help, so they land in this commit or the suite reds.
`docs/configuration.md`'s `### The `serve:` key` becomes `### The `ui:` key`;
its `roots` and `loop` bullets stay for now and package 2 deletes them.

Tests: `tests/integration/features/serve.feature` → `ui.feature`, all four
refusal scenarios re-pointed at the new name, plus a non-repo scenario asserting
exit 1. `Cli.test.ts`, `ConfigSchema.test.ts` and `Server.test.ts` follow the
renames.

**Risk**: the `serve.feature` scenario named "serve needs no repository" asserts
the OPPOSITE of the new guard. It is inverted, not deleted — the same setup, the
opposite assertion.

## Package 2 — one worktree, one step, one exit

The merged package: the fleet deletion and the handoff inversion are the same
edit to `Router.ts`'s procedure set and `Server.ts`'s context construction, so
they cannot land apart. See `## Merged Concerns`.

**Deleted outright**: `Discover.ts`, `Fleet.ts`, `Registry.ts`, `Loop.ts`,
`Shim.ts` and every one of their tests; `src/web/drafts.ts` and its test.
`fallow` must come back clean with no test-only entry point holding a dead
module up.

`Beat.ts` keeps its read and loses its cache. What survives: the version-support
check, the `gtd next --json` spawn in a worktree, and the parse into a row. What
goes: `BeatCache`'s slot and concurrency machinery, its mtime memo, its
handoff-race tests, and the `foreignDriverPossible` heuristic — a single
worktree reads its own beat once per request. `FleetRow`/`BrokenRow` become
`StepRead = Step | BrokenStep`; `FleetKind` becomes `StepKind` with the same
five values.

The **import-time version throw** dies here rather than moving:
`const GTD_VERSION: string = findOwnVersion()` runs at module scope and throws
if no `@pmelab/gtd` `package.json` sits above the module. It becomes a memoized
function called on first use. A test that imports the module from a directory
with no such package must load it, not throw.

`Router.ts`'s new surface — **`worktreePath` leaves every input**, because the
server knows its one worktree:

- `step` — a query, no input, returning the `StepRead`. This is what the client
  opens on.
- `writeNote`, `done` — the same compare-and-swap request minus `worktreePath`.
- `view`, `diff`, `readSteeringFile` — unchanged minus `worktreePath`.
- `fleet`, `stop` and `runCommand` are gone. `stop` signalled a registry child;
  there is no registry. **`runCommand` is deleted** — unauthenticated arbitrary
  shell execution with zero client callers, and the startup guard below means no
  screen will ever grow one.

That is also how the confirmed path-injection defect dies: the client can no
longer name a write target or a spawn cwd. A router test asserts every
procedure's input validator rejects — or simply has no field for — a
client-supplied path.

`RouterContext` loses `readFleet`, `startLoop` and `stopLoop`, and gains
`readStep: () => Promise<StepRead>` and `handOff: () => void`. `Server.ts` binds
every path argument to `cwd.root` when it builds the context, constructs no
`Registry` and no `BeatCache`.

**`gtd ui` refuses to start on a step it cannot render.** It reads its own beat
BEFORE resolving the host or the certificate — cheaper, likelier refusal first,
and no `openssl` invocation for a run that was never going to serve. It starts
only when the step is `kind: "prompt"` carrying a `file` and a `mode` that
resolves to a registered steering format. Everything else — `message`, `script`,
`capture`, `stalled`, an `idle` worktree, and a `prompt` whose mode resolves to
no format — **fails with a usage error, exit 2**, naming the step's `label` and
what it rests at. There is no fallback screen and no read-only mode.

Exit 2 needs plumbing that does not exist: `Cli.ts#report` maps
`SelectorUsageError` to `EXIT_USAGE_ERROR` and everything else to
`EXIT_RUNTIME_ERROR`. `Commentary.ts` gains `GtdUsageError extends GtdError` —
so the refusal keeps its remedy lines — and `report` maps that class too. Every
existing mapping is unchanged and `ExitCodes.ts`'s closure set stays at five.

**Risk, blunt**: `gtd ui` now exits 1 outside a repo and 2 on a step it cannot
render, two different codes for two refusals of the same command. That is the
settled answer to both questions, and the outer loop must handle both.

**Risk, blunter**: an outer loop that reruns `gtd ui` on exit 0 gets exit 2 the
moment the process rests at an agent step. Exit 2 is the loop's signal to drive
a turn itself, not to retry the UI.

**The exit, in order.** `done` awaits `writeNote` first; a refused write throws
the same `WriteNoteRefusal` it already does and nothing shuts down. On success
it returns `{ ok: true }` and calls `ctx.handOff()`. `handOff` resolves a
deferred that the main Effect awaits in place of today's `Effect.never`, but it
schedules that resolution on the HTTP response's own `finish` event — so the
phone gets its 200 before the socket dies — with a **2s fallback timer** in case
the response never flushes, so a vanished client cannot wedge the process.
`Effect.ensuring` then closes the listener and `runCli` supplies exit 0.

Durability needs nothing extra: `writeNote` is awaited before the response is
written, and a completed `write(2)` survives process death. The ordering is the
whole guarantee.

`ConfigSchema.ts` drops `roots` and `loop` from `UiSchema`, leaving
`port`/`host`/`cert`/`key`. Unknown-sub-key rejection then makes `ui.loop` a
decode failure for free — no new validation.

Docs: `docs/driver.md`'s "Being spawned by `gtd serve`" section is deleted
whole; it restates a contract that no longer has an owner.
`docs/configuration.md` loses its `roots` and `loop` bullets. `docs/**` is in
`test:unit`'s and both e2e tasks' `inputs`, so a stale doc cannot cache green.

Tests: `serve-loop-lifecycle.feature` is rewritten as `ui-lifecycle.feature`. A
scenario per non-renderable kind asserting exit 2 and no bound port. Every spawn
scenario goes. The **SIGINT 130 and SIGTERM 143 scenarios stay** — they bind for
real and they are what keeps `docs/cli.md`'s exit-code table honest. New
scenarios: handoff exits 0 with the note on disk and no child process spawned;
the UI closed without handing off exits 0 with no note written; a config file
with `ui.loop` fails to decode.

**Risk, restated because it is the design's one sharp edge**: a closed tab and a
handoff are the same exit 0. Only state on disk tells them apart, and the outer
loop must read it. Nothing in this package can distinguish them, and nothing
should try.

## Package 3 — the client opens on the step and writes every input through

`App.tsx` holds no navigation state. It calls `trpc.step.useQuery()` and renders
the screen the step's `mode` picks: `review` → `Review`, any other steering mode
→ `Plan`. **There is no third branch** — package 2's startup guard means the
server never binds on a step that has no screen, so the client can assume a
steering file and an unrenderable step is unreachable, not handled.
`screens/Fleet.tsx`, its stories, and the "← Fleet" escape hatch are deleted;
there is nowhere to go back to.

**The two wiring gaps need a write path that does not exist yet.** `writeNote`
is the only mutation the format contract exposes, and it attaches a footnote.
Ticking a checkbox is not a footnote. `SteeringFormat` grows one mandatory
member alongside `annotate`:

    apply(content, anchor, { checked?, text? }): SteeringAnnotateResult

Same result shape as `annotate` — edits, or a typed refusal. Both built-ins
already own the primitive: `OpenQuestions.ts#toggleCheckbox` and
`ReviewDoc.ts#toggleFilePointer` are line-based today and get anchor-based
wrappers. Each format owns its own semantics, and the server keeps never
importing a format module or switching on a mode name:

- `QA_FORMAT` on an `option` anchor enforces **radio**: tick the target, untick
  every sibling. `{ checked: true, text: "…" }` on the free-text slot ticks it
  and replaces its label in one edit set, so a dictated answer is one atomic
  round trip, not two.
- `REVIEW_FORMAT` on a `hunk` anchor toggles that hunk. On a `chunk` anchor it
  ticks every hunk beneath it — the check-all meaning already settled, since
  `##` headings carry no checkbox.
- A format with nothing to apply at that anchor returns `anchor-not-found`,
  exactly as `annotate` does.

`Write.ts` gains `writeValue`, a line-for-line mirror of `writeNote`: fresh
`headSha`, fresh actor rest gate, content-hash compare-and-swap, splice through
`applySteeringEdits`. Same `WriteRefusalReason` union, no new refusal values.
`Router.ts` gains a `setValue` mutation over it, and `api.ts` reads its refusals
through the existing `writeRefusalFrom`.

Client side, every tick and every answer calls `setValue.mutateAsync` and
invalidates `readSteeringFile`. Local `useState` stays for tap responsiveness,
but **disk is the source of truth** — which is what makes a reload survive, and
what makes the answer still there after the process exits. The controlled
`QuestionAnswer` state in `Plan.tsx` and the `ticked` map in
`Review.tsx#useReviewState` both keep their shape and gain a write-through; the
"not wired to writeNote, a later package" comments in both come out.

After `done` resolves, the client renders a terminal "handed back" panel. The
socket dies a moment later and the tab shows a dead page either way — the panel
is what the human sees in that moment.

Storybook: `Fleet.stories.tsx` goes; the surviving stories' `TrpcTestProvider`
mocks gain `step` and `setValue`. `test:web`'s `inputs` are `src/**` and
`.storybook/**`, so the layout change needs no turbo edit.

Acceptance: a browser test mounts at `/` and lands on the step screen with no
fleet route reachable; a scenario answers a question in the UI and finds the
answer in the steering file on disk; a hunk tick survives a reload.

## Merged Concerns

The requirements' second and third concerns are one package. Both rewrite
`Router.ts`'s procedure set and `Server.ts`'s `createContext`, and both edit the
same config struct — `done` cannot lose its `worktreePath` in one commit and its
`startLoop` call in another when they are the same eight lines. Spec review
still covers each independently; both are carried verbatim below.

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
it here unless the client-entry concern below genuinely wires it.

Acceptance: `Discover.ts`, `Fleet.ts`, `Registry.ts`, `drafts.ts` and their
tests are gone and `npm test` stays green; a router test asserts no procedure
accepts a path from the client; `fallow` clean with no test-only entry point
propping a dead module up.

## Answered Questions

### Does the `src/serve/` directory get renamed too?

Yes, to `src/ui/`, in package 1. It is one `git mv` and every later package
would otherwise write `src/serve/` for a command called `ui`. No user-facing doc
names it, so nothing outside the source tree moves.

### How does a checkbox tick reach disk when `annotate` only attaches footnotes?

`SteeringFormat` grows one mandatory
`apply(content, anchor, { checked?, text? })` member returning `annotate`'s own
result shape, with `Write.ts#writeValue` and a `setValue` procedure over it. A
server-side switch on the mode name was the only alternative and it violates the
settled rule that the server never imports a format module.

### How does the process exit without racing the `done` response?

`done` awaits the write, returns 200, and resolves the shutdown deferred on the
response's `finish` event with a 2s fallback timer. Closing the listener inside
the mutation would drop the response the phone is still reading.

### Do the SIGINT/SIGTERM scenarios survive the loop-lifecycle rewrite?

Yes. They bind a real socket and assert 130/143, which is what keeps the pinned
exit-code table honest — nothing in them touches spawn behaviour.

### Does the client keep optimistic local state now that ticks write through?

Yes, for tap responsiveness, but disk becomes the source of truth and every
mutation invalidates `readSteeringFile`. That is what makes a reload survive.

### Does the beat reader survive the cache deletion?

Yes. The version check, the `gtd next --json` spawn and the parse all stay; only
`BeatCache`'s slot, concurrency and mtime-memo machinery goes, since one
worktree reads itself once per request.

### What exit code does `gtd ui` give outside a repository?

Exit 1. It drops into `needs: "state"` and refuses through the shared
repo-root-and-commit guard, identically to every other state command; the pinned
exit-code table gains no new meaning.

### Does `gtd ui` keep `--dev`?

Yes — the flag, its scope entry, its help row, the package-root walk and the
per-request subprocess build all stay. It is the only way to see a client edit
without a full `npm run build`, and the rescope has no opinion on developer
tooling.

### What does `gtd ui` show when the step is not a steering file?

Nothing — it refuses to start, with a usage error at exit 2, naming the step's
label and what it rests at. No fallback screen, no read-only mode, and
`runCommand` is deleted as the dead remote-shell surface it was.
