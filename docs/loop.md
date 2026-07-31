# Driving the loop

gtd (v3, the pattern machine) exposes three commands a loop driver combines:

- **`gtd step <actor>`** — authenticate as `<actor>`, match the resolved rest's
  declared patterns against the pending changes, and commit (or squash) the one
  resulting transition. Performs AT MOST one transition — there is no fixpoint
  chain to drive. Pass `--cost=<n>` (optionally `--model=<name>`) to record the
  just-finished invocation's token cost and model on the turn commit; gtd sums
  them across the process into `it.processCost`/`it.processCostByModel` (see
  [Configuration: Token cost](configuration.md#token-cost)).
- **`gtd next`** — print the resolved rest's rendered script/prompt/message,
  without mutating anything.

gtd never executes a workflow script itself: at a `script`-content rest the
DRIVER runs the emitted `content` and then steps that state's own actor.

A loop is a simple cycle:

1. Run `gtd next --json` — see [`cli.md`](cli.md#gtd-next---json) for the exact
   `{state, actor, kind, content, model?, memory?, label?}` field shape. `kind`
   is the dispatch key: `"message"` → halt (a human rest); `"script"` → execute
   `content` verbatim (ignoring its exit code), then `gtd step <actor>` to
   capture the outcome; `"prompt"` → feed `content` to the agent, then
   `gtd step <actor>` yourself once it's done acting. The optional `model` is an
   opaque string the workflow author chose, which you map onto your own
   harness's model selection if you use one. The optional `label` is a
   human-readable display name for the resolved state, present only when that
   state declares `label:` in the workflow; when it's absent, a driver that
   wants to show something falls back to `state` itself (that fallback lives in
   the driver, not gtd core — see `bin/gtd-loop`'s
   `label="$(jq -r '.label // .state' <<<"$next_json")"`).
2. Repeat until a `"message"` rest halts the loop, or a zero-commit script step
   at idle settles it (the green terminal signal).

A human acts by editing files (e.g. writing/editing `.gtd/TODO.md`, fixing
code); `gtd step human` captures the edit as their turn. A driver can run that
capture for the human as its opening move (see below), so re-launching the loop
is the only thing the human ever does — at a gate they edit and re-run, and the
loop picks their change up.

**A `"message"` rest is a real handoff, not a slow beat.** No driver signs off
for the human: in the bundled workflow the loop runs the whole cycle unattended
up to `await-review` and then rests there with the review checkout window open
(the reviewable diff surfaced as uncommitted changes — see
[STATES.md §11](../STATES.md#11-the-review-checkout-window)). Advancing takes a
human edit to `.gtd/REVIEW.md`: ticking every box with **no** comment signs off
into the squash finale, while any comment (a note, or a code edit of your own)
is feedback that routes into another build + re-review round. That gate is the
contract, not a stall — nothing advances until the edit is captured, whether the
capture happens within the same run or a later one. A review nobody is going to
finish is ended with [`gtd abandon`](cli.md#gtd-abandon---json), which drops the
process's commits and keeps their content as uncommitted changes.

**Editing is on by default.** Reaching a `"message"` rest, `bin/gtd` opens
`${VISUAL:-$EDITOR}` on the rest's declared `.file` (or the repo root `.` when
the state declares none), blocking until the editor exits, then runs
`gtd step human` to capture whatever changed:

- a new commit was captured → the loop keeps driving on its own; re-launching is
  never necessary;
- zero commits were captured (a clean tree once the editor closed) → the loop
  halts, exit 0 — "done for now";
- the step refuses (a malformed steering file, or an edit matching no declared
  pattern) → the refusal is surfaced verbatim and the loop halts non-zero,
  exactly as a manual `gtd step human` refusal would.

Set `GTD_NO_EDIT` (any non-empty value), or pass `--no-edit` — see
[`cli.md`'s `--no-edit`](cli.md#--no-edit) for its exact syntax and positioning
— to disable this and restore the original halt-and-print behavior: the loop
prints the gate via `gtd next` and exits 0 without touching an editor, leaving
the human to edit and re-launch the loop themselves.

```bash
gtd next --json   # ask who's up and what they should do
```

See [`skills/loop/SKILL.md`](../skills/loop/SKILL.md) for the agent-facing
instructions that follow the same pinned contract. `gtd` itself (bare, or with
`loop` as its first argument — see below) is the packaged, ready-to-run
implementation of that same script for anyone who doesn't want to drive the loop
by hand.

## The reference loop driver

A minimal bash implementation of the pinned protocol, driving an agent CLI (e.g.
`claude -p`) against `gtd next --json` output. This is the authoritative
reference for what a loop driver must do; keep any other implementation
(including `skills/loop/SKILL.md`) consistent with it rather than editing both
independently. Both open with the same move — capture the human's pending edit
when the machine rests at a `"message"` gate — so `gtd` is the only command a
human runs. `bin/gtd` is the packaged entry point: invoked bare, or with `loop`
as its first argument, it runs this exact script; any other first argument (e.g.
`next`, `step`, `status`) hands off to `node dist/gtd.bundle.mjs` instead. The
loop body it runs adds five things on top of the reference script above: it
opens an editor at every `"message"` gate instead of just printing it (see
"Editing is on by default" above; `--no-edit`/`GTD_NO_EDIT` fall back to the
reference script's plain print-and-exit); it stops with a diagnostic if the same
`"prompt"` state/content repeat with no progress (see `skills/loop/SKILL.md`'s
"Stall detection"); it lets `GTD_LOOP_AGENT_CMD` swap in any coding agent CLI in
place of the default `claude -p`, receiving the prompt via `$GTD_LOOP_PROMPT`;
it exports the resolved state's optional `model` hint as `$GTD_LOOP_MODEL`,
appending `--model "$GTD_LOOP_MODEL"` to the default `claude -p` invocation
whenever it's non-empty; and it acts on the optional `memory` scope hint (see
"Agent memory scope" below) — continuing one agent session across consecutive
same-scope turns and starting fresh when the scope changes.

`bin/gtd` resolves both its bundle hand-off and the loop's own internal `gtd`
calls against `dist/gtd.bundle.mjs` next to its own location. Set `GTD_BIN` — a
full command, not just a path — to point both at source instead, e.g. for
development or testing:

```bash
GTD_BIN="node $PWD/dev/run.mjs" bin/gtd
```

```bash
#!/usr/bin/env bash
set -euo pipefail

# Opening move: if the machine rests at a human gate, capture the human's
# pending edit first, so re-launching the loop is the ONLY thing a human does
# (they never run `gtd step human` by hand). Peek with the pure `gtd next
# --json` and step only at a `"message"` rest — at an agent/check rest
# `gtd step human` would refuse out-of-turn, and a mid-cycle restart must just
# resume driving. A clean gate is a no-op; a genuine refusal (malformed steering
# file, unrecognized edit) stops the loop instead of being driven past.
if [[ "$(gtd next --json | jq -r .kind)" == "message" ]]; then
  gtd step human >/dev/null
fi

while true; do
  next_json="$(gtd next --json)"
  state="$(jq -r .state <<<"$next_json")"
  actor="$(jq -r .actor <<<"$next_json")"
  kind="$(jq -r .kind <<<"$next_json")"
  content="$(jq -r .content <<<"$next_json")"

  if [[ "$kind" == "message" ]]; then
    echo "--- Your turn ($state) ---"
    gtd next
    exit 0
  fi

  if [[ "$kind" == "script" ]]; then
    head_before="$(git rev-parse HEAD 2>/dev/null || echo none)"
    bash -c "$content" || true   # run the emitted script; exit code ignored
    gtd step "$actor" >/dev/null # capture whatever it left in the tree
    head_after="$(git rev-parse HEAD 2>/dev/null || echo none)"
    if [[ "$head_before" == "$head_after" ]]; then
      echo "--- Settled ($state: check passed, nothing to do) ---"
      exit 0
    fi
    continue
  fi

  # kind == "prompt": feed the prompt to the agent, then close out its turn.
  claude -p "$content" --dangerously-skip-permissions
  gtd step "$actor" >/dev/null
done
```

The driver — not the prompt text — owns ending the agent's turn
(`gtd step "$actor"` right after the agent acts): every default-workflow agent
prompt says explicitly not to run `gtd step agent` itself.

## Agent memory scope

A `"prompt"` beat may carry an optional `memory` key — an opaque scope label the
workflow author chose (e.g. `plan`, `build`, `fix`). gtd never interprets it; it
signals to the driver whether this agent turn should continue from the previous
turn's memory or start fresh. The rule is a comparison, not a command: track the
`memory` of the last `"prompt"` beat (script/message beats have none and never
change it), and when a new `"prompt"` beat's `memory` **equals** the tracked
value, continue the same agent session; when it **differs** — or it is the first
turn, or either side has no `memory` — start fresh.

This is what makes a loop retain memory while a phase boundary clears it: a loop
that keeps re-entering one state emits the same label every lap, so the agent
accumulates context across the loop; the move to the next phase's
differently-labelled state resets it. `bin/gtd` implements this by mapping the
signal onto claude's session flags — `--session-id` to pin a fresh session when
the scope changes, `--resume` to continue it while the scope holds — and
persists the current scope + session id in the git dir (never the working tree,
so `gtd status` and the pending diff never see them) so retention survives even
across the restarts a human gate forces mid-loop. See `skills/loop/SKILL.md`'s
"Agent memory scope" for the same contract stated for a hand-driven loop.

## Using a different agent

`gtd` (bare, or `gtd loop`) defaults to
`claude -p "$GTD_LOOP_PROMPT" --dangerously-skip-permissions`, but the agent
invocation is swappable: set `GTD_LOOP_AGENT_CMD` to any shell command, and it
runs with the prompt available as `$GTD_LOOP_PROMPT` in its environment, along
with the resolved state's opaque `model` hint (if any) as `$GTD_LOOP_MODEL` and
its `memory` scope as `$GTD_LOOP_MEMORY` / `$GTD_LOOP_SESSION_ID` /
`$GTD_LOOP_MEMORY_RESUME` (`1` when this turn should continue the prior
session). An adapter that ignores any of these keeps working unchanged. For
example, to drive a different agent CLI:

```bash
GTD_LOOP_AGENT_CMD='my-agent-cli --prompt "$GTD_LOOP_PROMPT"' gtd
```

## Herdr integration (optional)

`bin/gtd` optionally reports its lifecycle to [Herdr](https://herdr.dev) (a
terminal multiplexer for coding agents) via a `herdr` CLI binary, entirely at
the driver's edge — gtd core never talks to Herdr. Every call is best-effort
(guarded, output discarded, `|| true`), so a missing/failing `herdr` binary
never blocks, slows, or fails the loop. Because that guard also hides a herdr
CLI-signature mismatch, set `GTD_HERDR_DEBUG=1` to surface every `herdr` call
and its exit code on stderr instead.

The reporting is a no-op unless all three guard conditions hold: `HERDR_ENV=1`,
a non-empty `$HERDR_PANE_ID`, and `herdr` on `$PATH`. When they do, `gtd` makes
three kinds of calls (note the positional `<PANE_ID>` comes BEFORE the options —
herdr's `pane` subcommands reject a trailing pane id):

- `herdr pane report-agent "$HERDR_PANE_ID" --source herdr:gtd --agent gtd --state <state> --message <label>`
- `herdr pane release-agent "$HERDR_PANE_ID" --source herdr:gtd --agent gtd`
- `herdr notification show <title> --body <label> --sound request`

mapped onto the loop's states like this:

| Loop moment                                                                          | Call(s)                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Top of every non-`"message"` iteration                                               | `report-agent --state working`                                           |
| Right before halting at a `"message"` (human) gate                                   | `report-agent --state blocked` + `notification show`                     |
| Right before a clean settle (a script rest, zero new commits)                        | `report-agent --state idle` + `release-agent`                            |
| Any non-zero exit (stall guard, validate-cap, `gtd next` failure, unhandled failure) | `report-agent --state blocked` + `notification show`, via an `EXIT` trap |

`working`/`blocked` reports use the resolved rest's `label` (falling back to
`state`, per the field above); the trap falls back to `$GTD_LAST_LABEL`, the
label tracked from the last completed iteration, when it fires outside the
normal per-iteration flow. `report-agent` claims display authority for the
`herdr:gtd` source, so `working` is re-reported every lap rather than once, to
stay fresh against Herdr's own heuristic detection of the inner agent process.
