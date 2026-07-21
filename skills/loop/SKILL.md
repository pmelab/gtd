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
error. Only `gtd step-agent`, `gtd step`, and `gtd next --json` are used here.

## Requirements

- Run from the repository root (gtd refuses otherwise).
- gtd v2 (`step` / `step-agent` / `next`) must already be installed in this
  repo.
- This skill is versioned in the gtd repo, not auto-installed. When gtd is
  upgraded, re-copy this file from the new version's `skills/loop/SKILL.md` so
  the loop text stays in sync with the CLI it drives.

## The loop

Repeat this two-beat cycle until it halts:

1. Run `gtd step-agent`. This finishes or advances your own turn as the agent
   actor, driving to a fixpoint and authoring whatever commits are needed.
   - If it exits non-zero with a message like "... awaits a human turn", that is
     an out-of-turn refusal, not an error: halt and hand off to the user (see
     "Halting on a human gate" below).
   - Any other non-zero exit is a real operational failure (e.g. a missing or
     misconfigured `testCommand` binary, an illegal steering-file combination,
     or otherwise corrupted repo state) — not a red test run, which exits 0 and
     commits its findings (`gtd: test-failed` / `gtd: health-check`), and not a
     dirty tree, which `step-agent` captures as a turn rather than rejecting.
     Read the error, fix the underlying problem if you can, then re-run
     `gtd step-agent` — it is idempotent, so re-running after a crash or
     interruption is always safe.
2. Run `gtd next --json`. This is pure — it never mutates anything — and reports
   what happens next:
   - If it exits non-zero, halt and surface the error to the user verbatim (e.g.
     a dirty working tree — this should not normally happen right after
     `gtd step-agent`, so treat it as a real problem to investigate).
   - Parse the single-line JSON object:
     `{"state", "actor", "pending", "prompt"}`. `actor` is the single "proceed"
     signal, mirroring what a plain-mode prompt's tail would say: `"agent"`
     means the agent side keeps driving (another round ending in
     `gtd step-agent`), `"human"` means the human owns the next move.
   - If `actor` is `"human"`: halt — see "Halting on a human gate" below (a
     human gate, or a human-driven pending checkpoint the human resumes with
     `gtd step`).
   - If `actor` is `"agent"` and `pending` is `true`: an agent-driven mid-chain
     checkpoint — there is no prompt to act on. Go straight back to step 1
     (`gtd step-agent` resumes the chain).
   - Otherwise (`actor` is `"agent"`, `pending` is `false`): treat `prompt` as
     your next instructions. Execute exactly what it says. When your turn is
     done, go back to step 1 (`gtd step-agent`) to close it out — the harness,
     not the prompt text, owns ending your turn, which is why `--json` prompts
     carry no "finish your turn" tail embedded in `prompt` (the equivalent
     instruction is the `actor` field instead). This cycle repeats — multiple
     agent turns and commits (e.g. successive test/fix rounds) chain until
     `actor` comes back `"human"`.

## Halting on a human gate

When `gtd next --json` reports `"actor":"human"`, stop driving the loop. Tell
the user plainly what gtd is waiting on: the reported `state`, and (if you want
the human-readable phrasing) run `gtd next` without `--json` to get the same
prompt rendered for a person. Do not attempt to act on the human's behalf.

## Stall detection

If a beat of the loop produces the exact same `state` and `prompt` as the
previous beat, with no new commits authored in between, the loop is stuck — do
not spin on it. Halt and escalate to the user with what you observed (state,
prompt, and that it repeated) instead of retrying indefinitely.

## Notes

- `gtd step` and `gtd step-agent` both drive to a fixpoint and are idempotent:
  safe to re-run after any crash, interruption, or ambiguous exit.
- `gtd next --json` never mutates the working tree; it is safe to call as often
  as needed to inspect state.
- Never run bare `gtd` — it is a usage error in v2.
