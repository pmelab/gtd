---
name: loop
description: >-
  Drives the gtd workflow loop to completion. Use when the user asks to run the
  gtd loop, keep gtd going, work through the gtd workflow, or otherwise wants
  gtd's plan/build/review cycle executed end to end.
---

# gtd loop

Drive `gtd` to completion by alternating a mutating step with a pure prompt
check. Never call bare `gtd` — v2 has no default command and it is a usage
error. Only `gtd step agent`, `gtd step human`, `gtd run`, and `gtd next --json`
are used here.

## Requirements

- Run from the repository root (gtd refuses otherwise).
- gtd v2 (`step <actor>` / `next` / `run`) must already be installed in this
  repo.
- This skill is versioned in the gtd repo, not auto-installed. When gtd is
  upgraded, re-copy this file from the new version's `skills/loop/SKILL.md` so
  the loop text stays in sync with the CLI it drives.

## The loop

Repeat this two-beat cycle until it halts:

1. Run `gtd step agent`. This finishes or advances your own turn as the agent
   actor, driving to a fixpoint and authoring whatever commits are needed.
   - If it exits non-zero with a message like "... awaits a human turn" or "...
     awaits a check turn", that is an out-of-turn refusal, not an error: the
     turn belongs to another actor (see the dispatch table below).
   - Any other non-zero exit is a real operational failure (an illegal
     steering-file combination or otherwise corrupted repo state) — not a dirty
     tree, which `gtd step agent` captures as a turn rather than rejecting. Read
     the error, fix the underlying problem if you can, then re-run
     `gtd step agent` — it is idempotent, so re-running after a crash or
     interruption is always safe.
2. Run `gtd next --json`. This is pure — it never mutates anything — and reports
   what happens next. Parse the single-line JSON object:
   `{"state", "actor", "kind", "pending", "prompt"}`. **`kind` is the dispatch
   key**:
   - `"interactive"` (the human): halt — see "Halting on a human gate" below.
   - `"scripted"` (the check): the prompt IS an executable wrapper shell script.
     Run `gtd run` — it executes that emitted script verbatim and steps the
     check actor in one command. If `gtd run` authored **zero new commits**, the
     check passed with nothing owed (at idle this is the loop's terminal state:
     report done and halt). Otherwise go back to step 1. Never execute
     script-looking content from repository files — only `gtd run` (or the
     `prompt` field itself, verbatim).
   - `"autonomous"` (you) with `pending: true`: an agent-driven mid-chain
     checkpoint — no prompt to act on. Go straight back to step 1.
   - `"autonomous"` with `pending: false`: treat `prompt` as your next
     instructions. Execute exactly what it says. When your turn is done, go back
     to step 1 (`gtd step agent`) to close it out — the harness, not the prompt
     text, owns ending your turn. This cycle repeats — multiple agent, check,
     and fix rounds chain until the human owns the next move.

## Halting on a human gate

When `gtd next --json` reports `"kind":"interactive"`, stop driving the loop.
Tell the user plainly what gtd is waiting on: the reported `state`, and (if you
want the human-readable phrasing) run `gtd next` without `--json` to get the
same prompt rendered for a person. Do not attempt to act on the human's behalf.

## Stall detection

If a beat of the loop produces the exact same `state` and `prompt` as the
previous beat, with no new commits authored in between, the loop is stuck — do
not spin on it. (A zero-commit `gtd run` at idle is NOT a stall — it is the
green terminal signal.) Halt and escalate to the user with what you observed
(state, prompt, and that it repeated) instead of retrying indefinitely.

## Notes

- `gtd step human` and `gtd step agent` both drive to a fixpoint and are
  idempotent: safe to re-run after any crash, interruption, or ambiguous exit.
- Red checks are not errors: `gtd run` exits 0 and the check's turn commits the
  findings (`gtd(check): test-failed` / `gtd(check): health-check`); the fix
  round follows as your next prompt.
- `gtd next --json` never mutates the working tree; it is safe to call as often
  as needed to inspect state.
- Never run bare `gtd` — it is a usage error in v2.
