# Driving the loop

gtd splits what used to be one mutating command into three:

- **`gtd step human`** — advance the workflow as the **human** actor, to
  fixpoint.
- **`gtd step agent`** — advance the workflow as the **agent** actor, to
  fixpoint.
- **`gtd next`** — print the prompt for whichever actor is currently awaited,
  without mutating anything.

An agent loop is a two-beat protocol repeated forever:

1. Run `gtd step agent` to advance any agent-owned bookkeeping to a fixpoint.
2. Run `gtd next --json` and read the `actor` field. If it is `"human"`,
   **halt** — the human owns the next move, and the agent's job is done for this
   turn. If it is `"agent"`, feed `prompt` (when non-null) to the agent, let it
   act, then go back to step 1; at a pending checkpoint (`prompt` is null) go
   straight back to step 1.

A human acts by editing files (answering questions in `.gtd/TODO.md` or
`.gtd/ARCHITECTURE.md`, annotating `.gtd/REVIEW.md`, fixing code) and then
running `gtd step human` to capture the edit as their turn and hand control back
to the agent side of the loop.

```bash
gtd step agent            # advance the machine's own bookkeeping
gtd next --json            # ask who's up and what they should do
```

See [`skills/loop/SKILL.md`](../skills/loop/SKILL.md) for the agent-facing
instructions that follow the same pinned contract. `gtd-loop`, installed
alongside `gtd` (see below), is the packaged, ready-to-run implementation of
that same script for anyone who doesn't want to drive the loop by hand.

## The reference loop driver

A minimal bash implementation of the pinned two-beat protocol, driving an agent
CLI (e.g. `claude -p`) against `gtd --json` output. This is the authoritative
reference for what a loop driver must do; keep any other implementation
(including `skills/loop/SKILL.md`) consistent with it rather than editing both
independently.

```bash
#!/usr/bin/env bash
set -euo pipefail

while true; do
  # 1. Advance the machine's own agent-owned bookkeeping to a fixpoint.
  gtd step agent --json >/dev/null || true

  # 2. Ask who's up next. `actor` is the single "proceed" signal.
  next="$(gtd next --json)"
  actor="$(jq -r .actor <<<"$next")"
  prompt="$(jq -r .prompt <<<"$next")"

  if [[ "$actor" != "agent" ]]; then
    echo "Halting — the human owns the next move."
    break
  fi

  if [[ "$prompt" == "null" ]]; then
    # Agent-driven pending checkpoint: nothing to act on — loop back to
    # step 1, whose `gtd step agent` resumes the mid-chain bookkeeping.
    continue
  fi

  # Agent's turn: feed the prompt to the agent, then let it finish with
  # `gtd step agent` itself (the prompt's tail instructs it to).
  claude -p "$prompt" --dangerously-skip-permissions
done
```

The agent is expected to run `gtd step agent` itself once it finishes acting on
the prompt (the plain-mode tail says exactly this) — the driver's own
`gtd step agent` calls exist to advance any bookkeeping the agent doesn't own
(routing commits, test runs) between agent turns.

The loop halts on `actor: "human"` alone: a human rest (`pending: false`, the
prompt body addresses the human) or a human-driven pending checkpoint
(`pending: true`, resumed by the human's own `gtd step human`). Everything the
agent side can drive — agent rests and agent-driven checkpoints — reports
`actor: "agent"`, so multiple agent turns and commits (e.g. successive test/fix
cycles, a force-approved package close) chain without human involvement until an
actual human gate is hit.

`bin/gtd-loop`, installed as the `gtd-loop` binary, is the packaged
implementation of this exact script — kept in sync with it the same way
`skills/loop/SKILL.md` is. It additionally attempts `gtd step human` (not just
`gtd step agent`) every iteration, so a plain rerun after you've edited a file
at a human gate (no commit needed) picks up your edit and keeps going, and it
halts with a diagnostic if the same state and prompt repeat with no progress
(see `skills/loop/SKILL.md`'s "Stall detection").

## Using a different agent

`gtd-loop` defaults to
`claude -p "$GTD_LOOP_PROMPT" --dangerously-skip-permissions`, but the agent
invocation is swappable: set `GTD_LOOP_AGENT_CMD` to any shell command, and it
runs with the prompt available as `$GTD_LOOP_PROMPT` in its environment. For
example, to drive a different agent CLI:

```bash
GTD_LOOP_AGENT_CMD='my-agent-cli --prompt "$GTD_LOOP_PROMPT"' gtd-loop
```
