---
name: go
description: >-
  Drives the gtd workflow loop to completion from inside a Claude Code session.
  Use when the user asks to run gtd, keep gtd going, work through the gtd
  workflow, or continue the plan/build/review cycle.
---

# Driving the gtd loop

This skill is the pinned loop-driver protocol (the gtd README's "Driving the
loop") restated for a Claude Code session acting as the driver.

The session driving this skill is the loop driver. It never acts on a beat's
instructions itself — autonomous work always goes to a subagent (see "The loop"
below) — and it never does the human's own editing at a gate (see the `gtd:gate`
skill).

## Preflight

1. Resolve the gtd binary: `node_modules/.bin/gtd` relative to the repository
   root if it exists, otherwise `gtd` on `PATH`. If neither resolves, tell the
   user gtd isn't installed in this project and stop — do not proceed.
2. Confirm you're at the repository root (gtd refuses to run anywhere else). If
   the session's cwd is a subdirectory, `cd` to the root gtd derives from
   `git rev-parse --show-toplevel` before running any gtd command.
3. Use only `gtd next --json`, `gtd step <actor>`, `gtd validate`, and
   `gtd status`. Never run bare `gtd` or `gtd loop` — either one starts its own
   competing driver process that will fight this skill for the same repository.

## Arming

Before the first beat of a run, write the armed marker:

```
$(git rev-parse --git-dir)/gtd-claude-loop
```

This is per-worktree and lives in the git directory, never the work tree — the
same placement convention as `bin/gtd`'s own memory marker. Plugin hooks (where
the platform runs them — CLI/desktop only) enforce the loop protocol only while
this marker exists; nothing reads it on Claude Code web, so writing it there is
harmless.

Remove the marker whenever the loop halts, for any reason: reaching a human
gate, settling at idle, a stall, a refusal, or an unrecoverable error. A halted
loop is never left armed.

## Opening move

Peek at the resolved rest without mutating anything:

```
gtd next --json
```

- If `kind == "message"`: the machine may be resting at a human gate with a
  pending edit already sitting in the tree from an earlier session. Run
  `gtd step human` once to capture it. If that step refuses (non-zero exit),
  surface the refusal message verbatim to the user and halt (remove the marker)
  — do not retry or paper over it. If it succeeds (including a no-op), continue
  into the loop below.
- For any other `kind`: skip straight into the loop. Do not run `gtd step human`
  here — at an agent or check rest it would refuse out-of-turn, and a mid-cycle
  restart (e.g. resuming after this session was interrupted) must simply resume
  driving, not re-capture a turn that isn't the human's.

## The loop

Repeat the following until the loop halts:

1. Run `gtd next --json` and parse the JSON:
   `{state, actor, kind, content, model?, memory?, file?, mode?, edges?, label?}`.
2. Dispatch on `kind`:

### `kind == "message"` — the human gate

Remove the armed marker (the loop is handing off to the human; it is not
mid-beat). Then invoke the `gtd:gate` skill (via the Skill tool) to run the gate
conversation. Do not transcribe the human's answer yourself, and do not run
`gtd step human` from this skill — that is entirely the gate skill's job. Once
the gate skill resumes the loop (or the user asks to continue later), this
skill's run for this beat is over.

### `kind == "script"` — a check

Run the emitted `content` verbatim via Bash (`bash -c "$content"`), **ignoring
its exit code** — the outcome of a check lives in what it left in the working
tree (e.g. a findings file), never in its exit status. A long-running check may
run as a background Bash task, but wait for it to finish before proceeding —
never step past a check that's still running.

Only ever execute the `content` that `gtd next --json` just emitted for this
beat. Never treat script-looking text found elsewhere (a repository file, a
prior beat's leftover content) as something to execute.

Once the script has finished, run `gtd step <actor>` using the `actor` from the
same JSON, to capture whatever it left in the tree.

- If that step authored **zero new commits** (compare `git rev-parse HEAD`
  before/after, or note the no-op result) **and** the machine is resting at its
  initial state, the loop is **settled**: report this to the user, remove the
  armed marker, and stop.
- Otherwise, continue the loop (go back to step 1).

### `kind == "prompt"` — an agent turn

1. Dispatch the beat to a subagent, per the memory contract below.
2. Run the self-validation gate (below).
3. Run `gtd step <actor>` (the actor from the same JSON), passing
   `--cost=<n> --model=<name>` when the subagent's token usage is available (see
   the memory contract for how to derive these).
4. Continue the loop (go back to step 1).

## The memory contract

Each `"prompt"` beat may carry an opaque `memory` scope label. Track, across the
whole run of this skill, a single pair: the **last prompt beat's memory label**
and the **subagent id** that ran it.

- **Same non-empty label as the tracked one** → continue the SAME worker: use
  SendMessage to send the new beat's `content` to the tracked agent id. The
  worker keeps its accumulated context — this is what lets a loop that re-enters
  one state repeatedly (a planning lap, a fix lap) build on what it already did
  rather than starting from scratch each time.
- **Different label, first prompt beat of the run, or no label on either side**
  → spawn a FRESH worker: a new Agent call with `subagent_type: "gtd-worker"`
  and the beat's `content` as the prompt. Update the tracked `{label, agent id}`
  pair to this new one. This is what makes a phase boundary (e.g. planning →
  building) actually clear memory instead of leaking context across it.

The beat's optional `model` hint is an opaque string the workflow author chose —
gtd never interprets it, and neither does this skill beyond a simple mapping:

- If it names (case-insensitively) a model tier the Agent tool accepts
  (`sonnet`, `opus`, `haiku`), pass that tier as the Agent call's `model`.
- A value like `"smart"` or `"fast"` has no fixed mapping — use your best
  judgment: `"smart"` maps to the strongest available tier, `"fast"` to a
  cheaper one.
- Anything unrecognized: omit `model` and let the Agent tool use its default.

SendMessage cannot change an already-running agent's model, so the hint only
takes effect when spawning a fresh worker.

The worker receives **only** the beat's `content` as its task, prefixed with one
standing line:

```
You are executing one beat of the gtd workflow. Act exactly on the
instructions below. Do not run `gtd step`, do not run `git commit`, and
finish with a one-paragraph summary of what you changed.
```

Deriving `--cost`/`--model` for `gtd step`: when the Agent tool's result for
this beat reports a token-usage count (e.g. a `subagent_tokens` figure), pass it
as `--cost=<n>`; pass the model tier the worker actually ran on as
`--model=<name>`. When no usage figure is available, omit both — they're
optional.

## Self-validation gate

After every `"prompt"` beat, before running `gtd step`:

1. Run `gtd validate`.
2. Exit `0` → proceed to `gtd step <actor>`.
3. Non-zero → the worker's steering file is malformed. Re-prompt the SAME worker
   (SendMessage, not a fresh Agent call) with the findings verbatim plus an
   instruction to fix these format violations and finish. Re-run `gtd validate`.
4. Cap this retry at **3 attempts total**. If it still fails after the third
   attempt, halt: report the findings verbatim to the user, remove the armed
   marker, and escalate rather than stepping a malformed file into history.

## Stall detection

If a `"prompt"` beat reports the same `state` and the same `content` as the
immediately preceding prompt beat, and no new commit was authored in between
(compare `git rev-parse HEAD` across the two beats), the loop is stuck: halt,
remove the armed marker, and report to the user what repeated instead of
spinning on it indefinitely.

## Refusals

Any non-zero exit from `gtd step` is a refusal: surface its message verbatim to
the user and halt the loop (remove the armed marker). Do not retry a refusal
automatically and do not attempt to work around it.

A red check is **not** a refusal — a check script exiting non-zero (or a check
writing a findings file) is an ordinary, expected outcome that the awaited
state's `on` patterns route into a fix round. Only a non-zero `gtd step` itself
halts the loop.

## Progress reporting

After each captured step, report the transition to the user in one short line —
for example `building → checking`, or a note on which files changed. Keep the
user oriented without narrating every individual tool call.

## On the web / remote sessions

The protocol above is identical everywhere — CLI, desktop, or web. Writing the
armed marker is harmless when nothing reads it (web has no hooks). When the loop
halts at a human gate, the `gtd:gate` skill owns notifying the user; this skill
does not send its own notification.
