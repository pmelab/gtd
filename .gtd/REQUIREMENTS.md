The human reconsidered the whole shape of the web UI after reading the review.
The shipped branch built a multi-worktree fleet server (`gtd serve`) that
discovers repos, lists them, and spawns a loop child per worktree. That is not
the product. The UI is scoped to ONE worktree, and handing back is the server
exiting.

The note, verbatim, from `.gtd/REVIEW.md`:

> i reconsidered how the ui should work. it should be scoped to a single
> worktree only. no discovery, no fleet listing.

> `gtd ui` should spin up the server on a defined port for that worktree,
> showing the web user interface for that given step. the "handoff" event in the
> ui should effectively just terminate the server process to let the outer loop
> react to that.

This is a rescope, not a bug list. The review's own security and wiring findings
are NOT carried forward here — most of them live in code this rescope deletes.
Re-review whatever survives.

## `gtd ui` replaces `gtd serve` as a single-worktree command

PRODUCT. The command is named `ui`, not `serve`, and it operates on the worktree
it is invoked in — the invoking directory, not a configured list of roots. It
binds a defined port and shows the web interface for that worktree's current
step, nothing else.

`gtd serve` runs from anywhere because the roots it scans are elsewhere.
`gtd ui` is the opposite: the worktree IS the invoking directory, so it needs
whatever repo guard the state commands already use rather than `visualize`'s
`needs: "config"` carve-out.

"A defined port" is the human's phrase. Decide whether that means a fixed
default, a required flag, or a config key — the note settles that the port is
known and stated, not auto-picked.

## Handing back terminates the server process

PRODUCT. The UI's handoff action exits the `gtd ui` process. It does not spawn a
loop command, register a child, watch it, or signal it. The outer loop — the
thing that started `gtd ui` — reacts to the exit and drives the next turn
itself.

That inverts the shipped control flow. Today the phone's "Done" starts a
configured `serve.loop` child inside a long-lived server, and the server
outlives every turn. Under the note the server lives for exactly one step: it
starts, shows that step, takes the human's input, and dies.

The whole `serve.loop` contract goes with it — worktree cwd, the shim `$PATH`,
SIGINT-then-SIGKILL-after-5s, unlimited cross-worktree concurrency, the inline
failure display on a fleet row. None of it has an owner once handoff is just an
exit.

## Discovery, the fleet, and the loop-spawn machinery come out

TECHNICAL. "No discovery, no fleet listing" deletes a large fraction of the
branch, not a screen. What the rescope makes unreachable:

- root scanning and worktree ids, and the `serve.roots` config key that feeds it
- the fleet read, its bucket ordering policy, and the "possibly driven
  elsewhere" mtime heuristic
- the live-child registry and the loop spawner, plus the `serve.loop` config key
- the beat cache — its whole reason to exist was avoiding a per-worktree cost
  across a 30-row fleet screen; a single worktree reads its own beat once
- the 5s fleet poll and pull-to-refresh

Delete rather than keep dormant. A single-worktree server that still carries a
registry and a discovery walk is the same code with an unused door.

Two of the review's confirmed defects disappear with this: the unvalidated
client-supplied `worktreePath` used as a write target and a spawn cwd, and the
import-time version throw in the beat reader. Confirm they are gone rather than
relocated.

## The client entry becomes the current step

TECHNICAL. The app currently opens on the fleet list and navigates into a
worktree. It must open directly on the step's own screen for the one worktree
being served, and the handoff action must be reachable from there.

The escape hatch back to the fleet has nowhere to go. The mode-shaped screens
themselves — plan, review, question, hunk — are the part of the client the
rescope keeps.

The review flagged two wiring gaps in exactly this area that a rescope does not
excuse: question answers are held in React state and never written to the
server, and hunk ticks are local-only. Neither has anything to do with fleet
scope, so both still need settling on the way through.

## CLI surface, config, docs, and tests follow the command

TECHNICAL. Every place that says `serve` is now wrong, and several say it in
generated views under test:

- the CLI help row and flag scopes, which `docs/cli.md`'s `## Commands` block is
  pinned equal to
- the `serve:` config key and its six sub-keys, of which `roots` and `loop` no
  longer have a meaning at all
- `docs/configuration.md`'s `serve:` section and `docs/driver.md`'s "Being
  spawned by `gtd serve`" section, which state the same loop contract twice —
  the contract that is going away
- the two feature files, whose scenarios pin refusals (`--host` plus no tailnet,
  no cert) that a defined-port single-worktree command may not have
- the storybook and turbo task wiring, if the client's file layout moves

The two-bundle build, the inlined HTML client, and the browser test tier are
independent of scope and should survive untouched.

Also unaddressed from the review, and independent of the rescope:
`src/web/drafts.ts` is unreachable — zero importers outside its own test, with
`fallow` reporting clean because that test counts as an entry point. Wire it or
delete it as part of whatever survives.
