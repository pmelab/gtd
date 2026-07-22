# Driving the loop

gtd (v3, the pattern machine) exposes three commands a loop driver combines:

- **`gtd step <actor>`** — authenticate as `<actor>`, match the resolved rest's
  declared patterns against the pending changes, and commit (or squash) the one
  resulting transition. Performs AT MOST one transition — there is no fixpoint
  chain to drive.
- **`gtd next`** — print the resolved rest's rendered script/prompt/message,
  without mutating anything.
- **`gtd run`** — execute the resolved rest's emitted script (only for a
  `script`-content rest), then step that state's own actor to capture the
  outcome. The only place gtd spawns a subprocess.

A loop is a simple cycle:

1. Run `gtd next --json` and parse `{"state", "actor", "kind", "content"}`.
   `kind` is the dispatch key: `"message"` → halt (a human rest); `"script"` →
   run `gtd run`; `"prompt"` → feed `content` to the agent, then
   `gtd step <actor>` yourself once it's done acting.
2. Repeat until a `"message"` rest halts the loop, or a zero-commit `gtd run` at
   idle settles it (the green terminal signal).

A human acts by editing files (e.g. answering questions in `.gtd/TODO.md`,
annotating `.gtd/REVIEW.md`, fixing code) and then running `gtd step human` to
capture the edit as their turn.

```bash
gtd next --json   # ask who's up and what they should do
```

See [`skills/loop/SKILL.md`](../skills/loop/SKILL.md) for the agent-facing
instructions that follow the same pinned contract. `gtd-loop`, installed
alongside `gtd` (see below), is the packaged, ready-to-run implementation of
that same script for anyone who doesn't want to drive the loop by hand.

## The reference loop driver

A minimal bash implementation of the pinned protocol, driving an agent CLI (e.g.
`claude -p`) against `gtd next --json` output. This is the authoritative
reference for what a loop driver must do; keep any other implementation
(including `skills/loop/SKILL.md`) consistent with it rather than editing both
independently. `bin/gtd-loop` is this exact script, packaged as the `gtd-loop`
binary, with one addition: it stops with a diagnostic if the same `"prompt"`
state/content repeat with no progress (see `skills/loop/SKILL.md`'s "Stall
detection").

```bash
#!/usr/bin/env bash
set -euo pipefail

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
    gtd run
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

## Using a different agent

`gtd-loop` defaults to
`claude -p "$GTD_LOOP_PROMPT" --dangerously-skip-permissions`, but the agent
invocation is swappable: set `GTD_LOOP_AGENT_CMD` to any shell command, and it
runs with the prompt available as `$GTD_LOOP_PROMPT` in its environment. For
example, to drive a different agent CLI:

```bash
GTD_LOOP_AGENT_CMD='my-agent-cli --prompt "$GTD_LOOP_PROMPT"' gtd-loop
```
