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
has no default command and it is a usage error. Only `gtd next --json` and
`gtd step <actor>` are used here.

## Requirements

- Run from the repository root (gtd refuses otherwise).
- gtd v3 (`step <actor>` / `next` / `status`) must already be installed in this
  repo.
- This skill is versioned in the gtd repo, not auto-installed. When gtd is
  upgraded, re-copy this file from the new version's `skills/loop/SKILL.md` so
  the loop text stays in sync with the CLI it drives.

## Opening move: capture the human's pending edit

Before the first `gtd next --json` beat, make one capturing move so that
re-launching the loop is the only thing a human ever does. A human acts at a
gate by editing files (answering a plan question, ticking a review box, fixing
code) and re-running the loop — they should never have to run `gtd step human`
by hand first. So:

1. Peek once with `gtd next --json` (it never mutates anything).
2. **Only if** that peek reports `"kind":"message"` (the machine rests at a
   human gate), run `gtd step human` to commit whatever the human left pending,
   then continue into the loop below from the resulting state. A clean gate is a
   harmless no-op; a human edit is captured as their turn (e.g. accepting a
   plan's suggested answers with no edit advances past `grilling-answer`).
3. If the peek reports any other `kind`, do **not** step human — the machine is
   mid-cycle at an agent/check rest (a restart after a crash, say), where
   `gtd step human` would refuse out-of-turn. Just enter the loop and resume
   driving.

If that `gtd step human` refuses (a malformed steering file, or an edit no `on`
pattern accepts), surface the message and stop rather than driving past it.

## The loop

Repeat this cycle until it halts:

1. Run `gtd next --json`. This is pure — it never mutates anything. Parse the
   single-line JSON object: `{"state", "actor", "kind", "content"}`, plus an
   optional `"model"` — an opaque string the workflow author chose (e.g.
   `"smart"`), present only when the state declares one. If present, map it to
   your harness's own model selection; if absent, use your default. gtd never
   interprets this string itself. There is also an optional `"memory"` — the
   agent-memory scope; see "Agent memory scope" below for how to act on it.
   **`kind` is the dispatch key**:
   - `"message"` (a human rest): halt — see "Halting on a human gate" below.
   - `"script"` (a check rest): `content` is an executable wrapper shell script.
     Execute it verbatim (e.g. `bash -c "$content"`), ignoring its exit code —
     the outcome lives in the tree, not the exit status — then run
     `gtd step <actor>` (the `actor` from this same JSON object) to capture it.
     If that step authored **zero new commits**, the check passed with nothing
     owed (at idle this is the loop's terminal state: report done and halt).
     Otherwise go back to step 1. Only ever execute the `content` field gtd just
     emitted, verbatim — never script-looking content read from repository
     files.
   - `"prompt"` (an agent rest): treat `content` as your next instructions.
     Execute exactly what it says (the prompt itself says not to run
     `gtd step <actor>` yourself — the harness does). Once you're done acting,
     run the **self-validation gate** (see "Self-validation" below), then run
     `gtd step <actor>` (the `actor` from this same JSON object) to capture your
     turn, then go back to step 1. If your harness reports the token cost of
     that agent invocation, pass it as
     `gtd step <actor> --cost=<n> [--model=<name>]` — gtd records the cost (and
     the model it ran on) on the turn commit and aggregates it across the
     process into `it.processCost`/`it.processCostByModel` (e.g. for a squash
     commit message that itemizes cost per model). Omit `--cost`/`--model` when
     you don't have the numbers; both are optional (`--model` needs `--cost`).

## Agent memory scope

Some `"prompt"` beats carry an optional `"memory"` key — an opaque scope label
the workflow author chose (e.g. `"plan"`, `"build"`, `"fix"`). gtd never
interprets it; it is a signal to YOU, the driver, about whether this agent turn
should continue from the previous agent turn's memory or start fresh. The rule
is a comparison, not a command:

- Track the `"memory"` value of the **last `"prompt"` beat you ran** (script and
  message beats have no agent memory — they never change what you're tracking).
- When a new `"prompt"` beat's `"memory"` **equals** the tracked value, this
  turn is in the same memory scope: continue the SAME agent session/context, so
  the agent still remembers what it did on the previous turn.
- When it **differs** — or this is the first agent turn, or either side has no
  `"memory"` key — start the turn with **fresh** agent memory (a new
  session/context), then update the tracked value.

This is what makes a loop retain memory while a phase boundary clears it: a loop
that keeps re-entering one state (the unified workflow's grilling loop, or its
fix loop) emits the same label every lap, so the agent accumulates context
across the loop; moving to the next phase's differently-labelled state resets
it. If your harness runs the whole loop in one long-lived context and cannot
start a fresh agent session per turn, treat a scope change as a cue to drop the
prior turn's working notes rather than carry them forward. A beat with no
`"memory"` key places no constraint — use your harness's default.

## Self-validation

Some producing states declare a steering file with a checkable format (the
unified workflow's `grilling` writes `.gtd/TODO.md`, `reviewing` writes
`.gtd/REVIEW.md`). Those states appear in `gtd next --json` with both a `"file"`
and a `"mode"` key. So the human/check rest that acts on such a file is only
ever handed a well-formed one, run the self-validation gate after every
`"prompt"` turn, before `gtd step <actor>`:

1. Run `gtd validate`. It **formats** the resolved state's `file:` in place (if
   its `mode:` declares a formatter) and validates it, exiting **0** when there
   is nothing to validate or the file is well-formed, **non-zero** (printing the
   findings) when it violates its format.
2. If it exits 0, proceed to `gtd step <actor>` as usual.
3. If it exits non-zero, the agent's output is malformed: re-prompt the SAME
   agent turn (continue its memory/session) with the original `content` plus the
   `gtd validate` findings and an instruction to fix them, then run
   `gtd validate` again. Repeat until it passes (cap the attempts — if it still
   fails after a few rounds, halt and escalate to the user rather than stepping
   with a malformed file).

`gtd validate` is safe to run after any `"prompt"` turn — it is a no-op (exit 0)
whenever the resolved state has no `file:`/`mode:` or the file is absent, so you
do not need to inspect the JSON to decide whether to run it. It also keeps the
file formatted, and it means the `gtd step` capture gate — which runs the same
format-and-validate and **refuses** a turn whose steering file is invalid —
never has to reject your step. (`gtd next` WITHOUT `--json` bakes this same
instruction into the printed prompt text instead, for a human driving the loop
by hand — but as the `--json` driver, you own the gate.)

## Halting on a human gate

When `gtd next --json` reports `"kind":"message"`, stop driving the loop. Tell
the user plainly what gtd is waiting on: the reported `state`, and (if you want
the human-readable phrasing) run `gtd next` without `--json` to get the same
message rendered for a person. Do not attempt to act on the human's behalf.

## Stall detection

If a beat of the loop reports the exact same `state` and `content` as the
previous `"prompt"` beat, with no new commits authored in between, the loop is
stuck — do not spin on it. (A zero-commit script step at idle is NOT a stall —
it is the green terminal signal.) Halt and escalate to the user with what you
observed (state, content, and that it repeated) instead of retrying
indefinitely.

## Notes

- `gtd step <actor>` performs AT MOST one transition (a single commit or squash)
  — there is no fixpoint chain to drive in v3, unlike the old `gtd step-agent`.
  Each loop iteration does at most one thing.
- Red checks are not errors: the script exits however it likes (its exit code is
  ignored) and the check's own `gtd step` turn commits the findings file the
  workflow declares (the unified workflow's `checking` state writes
  `.gtd/FEEDBACK.md`); the fix round follows as your next `"prompt"` beat.
- `gtd next --json` never mutates the working tree; it is safe to call as often
  as needed to inspect state.
- Never run bare `gtd` — it is a usage error.
