The human reconsidered the whole shape of the web UI after reading the review.
The shipped branch built a multi-worktree fleet server (`gtd serve`) that
discovers repos, lists them, and spawns a loop child per worktree. That is not
the product. **The UI is scoped to ONE worktree, and handing back is the server
exiting.**

The note, verbatim, from `.gtd/REVIEW.md`:

> i reconsidered how the ui should work. it should be scoped to a single
> worktree only. no discovery, no fleet listing.

> `gtd ui` should spin up the server on a defined port for that worktree,
> showing the web user interface for that given step. the "handoff" event in the
> ui should effectively just terminate the server process to let the outer loop
> react to that.

This is a rescope, not a bug list. The review's own security and wiring findings
are NOT carried forward wholesale — most live in code this rescope deletes. The
two that survive are named in the concerns that own them.

`npm test` is green on the current tree (all 10 turbo tasks, 9 cached). The
shipped branch's code is still present — `unwind` reverted the review note, not
the 17,800-line feature. So every concern below is a change to existing code,
never a build from nothing.

The collector's fifth concern ("CLI surface, config, docs, and tests follow the
command") is **dissolved into the concerns that force it**. It cannot be a later
package: `docs/cli.md`'s `## Commands` block and its exit-code table are pinned
equal to rendered help output, so they red the instant the command is renamed. A
concern that leaves them stale is not green on its own.

## Open Questions

### Is `gtd ui` still reachable from a phone over the network, or localhost-only?

The branch is `feat/phone-web-ui` and the shipped server binds a configurable
host over HTTPS with a QR code, a `--self-signed` escape hatch, and scenarios
that refuse `--host` without a tailnet name or a cert. A server that lives for
one step could instead bind loopback only and let the human port-forward. This
decides whether `--host`, `--self-signed`, `serve.cert`/`serve.key`, `Tls.ts`,
`Qr.ts` and both refusal scenarios survive or join the deletions.

- [x] Keep network reach — bind a configurable host over HTTPS, keep the QR code
      and the cert/tailnet refusals; a phone on the tailnet is the whole point
- [ ] Loopback only — bind `127.0.0.1` over plain HTTP, delete TLS, QR, `--host`
      and `--self-signed`; the human reaches it by port-forward or local browser
- [ ] _your answer_

### What does the outer loop see when the human closes the UI without handing off?

Handoff exits the process, so the exit status is now the entire contract between
the UI and the loop that started it. `docs/cli.md`'s exit-code table is a pinned
generated view, so this lands in documented CLI surface either way.

- [x] One status — handoff exits 0, and so does any other clean shutdown; the
      loop re-reads state after every exit and needs no distinction
- [ ] Distinct statuses — handoff exits 0, a human quitting or a signal exits
      non-zero (130/143 for signals), so the loop can stop instead of relooping
- [ ] _your answer_

## `gtd ui` replaces `gtd serve` as a single-worktree command

PRODUCT. The command is named `ui`, and it operates on the worktree it is
invoked in — **the invoking directory, never a configured list of roots**. It
binds a defined port and shows the web interface for that worktree's current
step, nothing else.

`gtd serve` carries `needs: "config"` so it runs outside a repository, like
`visualize`. `gtd ui` is the opposite: the worktree IS the invoking directory,
so it takes whatever repo guard the state commands already use. Invoked outside
a repo it must refuse, not start.

The port is settled below: default 8443, `--port <n>` override, `ui.port` config
key.

Forced into this concern, because they red the moment the name changes: the CLI
help row and every flag `scope`/`scopeError` in `src/Cli.ts`, the `## Commands`
pin in `docs/cli.md`, the top-level config key rename `serve:` → `ui:`, and
`docs/configuration.md`'s section for it. `--port`'s error text lost its command
name when it was widened from `visualize`-only; fix that here.

Acceptance: help output lists `gtd ui` and no `gtd serve`, with the
`docs/cli.md` `## Commands` pin green; a scenario runs `gtd ui` in a non-repo
directory and gets exit 2; a config file with `serve:` fails to decode where
`ui:` succeeds.

## Handing back terminates the server process

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

Acceptance: a scenario drives handoff and asserts the process exits with the
settled status, the note is on disk, and no child process was spawned; a config
file with `ui.loop` fails to decode.

## Discovery, the fleet, and the loop-spawn machinery come out

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

## The client entry becomes the current step

TECHNICAL. The app opens on the fleet list and navigates into a worktree. It
must **open directly on the step's own screen** for the one worktree being
served, with the handoff action reachable from there. The escape hatch back to
the fleet has nowhere to go; `src/web/screens/Fleet.tsx` and its stories go with
it. The mode-shaped screens — Plan, Review, Question, Hunk — are the part of the
client the rescope keeps.

Two review-confirmed wiring gaps live in exactly this area and a rescope does
not excuse them: **question answers are held in React state and never written to
the server**, and **hunk ticks are local-only**. Neither has anything to do with
fleet scope. Both must round-trip to disk through the surviving write path, or
the human's answers vanish when the server exits — which, after the handoff
concern, is every single step.

Storybook and the turbo task wiring follow the client's file layout if it moves.
The two-bundle build, the inlined HTML client, and the browser test tier are
independent of scope and survive untouched.

Acceptance: a browser test mounts the app at `/` and lands on the step screen
with no fleet route reachable; a scenario answers a question in the UI and
asserts the answer is in the steering file on disk; a hunk tick survives a
reload.

## Answered Questions

### What does "a defined port" mean — fixed default, required flag, or config key?

All three, as shipped: default 8443, `--port <n>` override, `ui.port` config
key. "Defined" only rules out auto-picking a free port the way `visualize` does,
and the shipped command already never auto-picks — so history settles it and the
rescope leaves it alone.

### Does the `serve:` config key keep its name?

No — it becomes `ui:`, and the rename is part of the command concern. A blessed
top-level key named after a command that no longer exists is a documented
surface that lies.

### Is the fleet code kept dormant behind a flag for a later multi-worktree mode?

No. It is deleted. The note rules out fleet listing as product, and dormant code
with no caller is where the two confirmed security defects were living.

### Is `src/web/drafts.ts` wired or deleted?

Deleted, unless the client-entry work genuinely needs it. It has no importer
outside its own test, and the rescope shrinks the client rather than growing it.
