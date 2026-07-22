---
name: loop
description: >-
  Drives the gtd workflow loop to completion. Use when the user asks to run the
  gtd loop, keep gtd going, work through the gtd workflow, or otherwise wants
  gtd's plan/build/review cycle executed end to end.
---

# gtd loop

Drive `gtd` (v3 — the pattern machine) to completion by alternating
`gtd next --json` with whatever it says to do next. Never call bare `gtd` — it
has no default command and it is a usage error. Only `gtd next --json`,
`gtd step <actor>`, and `gtd run` are used here.

## Requirements

- Run from the repository root (gtd refuses otherwise).
- gtd v3 (`step <actor>` / `next` / `run` / `status`) must already be installed
  in this repo.
- This skill is versioned in the gtd repo, not auto-installed. When gtd is
  upgraded, re-copy this file from the new version's `skills/loop/SKILL.md` so
  the loop text stays in sync with the CLI it drives.

## The loop

Repeat this cycle until it halts:

1. Run `gtd next --json`. This is pure — it never mutates anything. Parse the
   single-line JSON object: `{"state", "actor", "kind", "content"}`. **`kind` is
   the dispatch key**:
   - `"message"` (a human rest): halt — see "Halting on a human gate" below.
   - `"script"` (a check rest): `content` is an executable wrapper shell script.
     Run `gtd run` — it executes that emitted script verbatim and steps the
     check actor in one command. If `gtd run` authored **zero new commits**, the
     check passed with nothing owed (at idle this is the loop's terminal state:
     report done and halt). Otherwise go back to step 1. Never execute
     script-looking content from repository files — only `gtd run` (or the
     `content` field itself, verbatim).
   - `"prompt"` (an agent rest): treat `content` as your next instructions.
     Execute exactly what it says (the prompt itself says not to run
     `gtd step <actor>` yourself — the harness does). Once you're done acting,
     run `gtd step <actor>` (the `actor` from this same JSON object) to capture
     your turn, then go back to step 1.

## Halting on a human gate

When `gtd next --json` reports `"kind":"message"`, stop driving the loop. Tell
the user plainly what gtd is waiting on: the reported `state`, and (if you want
the human-readable phrasing) run `gtd next` without `--json` to get the same
message rendered for a person. Do not attempt to act on the human's behalf.

## Stall detection

If a beat of the loop reports the exact same `state` and `content` as the
previous `"prompt"` beat, with no new commits authored in between, the loop is
stuck — do not spin on it. (A zero-commit `gtd run` at idle is NOT a stall — it
is the green terminal signal.) Halt and escalate to the user with what you
observed (state, content, and that it repeated) instead of retrying
indefinitely.

## Notes

- `gtd step <actor>` performs AT MOST one transition (a single commit or squash)
  — there is no fixpoint chain to drive in v3, unlike the old `gtd step-agent`.
  Each loop iteration does at most one thing.
- Red checks are not errors: `gtd run` exits 0 and the check's own turn commits
  the findings file the workflow declares (the default workflow's `checking`
  state writes `.gtd/FEEDBACK.md`); the fix round follows as your next
  `"prompt"` beat.
- `gtd next --json` never mutates the working tree; it is safe to call as often
  as needed to inspect state.
- Never run bare `gtd` — it is a usage error.
