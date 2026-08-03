---
name: gate
description: >-
  Runs the conversation at a gtd human gate: presents the gate's question,
  review, or plan as native choices, transcribes the user's answer into the
  steering file, and captures it with gtd step human. Use when the gtd workflow
  rests at a human gate (gtd next reports kind "message"), or when the user
  wants to answer plan questions, review a gtd change, or approve or give
  feedback on gtd's work.
---

# Running a gtd human gate

This skill owns the whole conversation at a gtd human gate: reading the gate,
showing the user what they're deciding on, turning their chat answer into an
edit of the steering file, validating it, and capturing it with
`gtd step human`. The driver skill (`gtd:go`) hands off here whenever the
machine rests at a `"message"` kind and does not transcribe the answer or run
`gtd step human` itself — that is entirely this skill's job.

## Reading the gate

Run `gtd next --json` (pure — it never mutates anything, so it's always safe to
re-run). Parse:

```
{state, actor, kind, content, model?, memory?, file?, mode?, edges?}
```

If `kind` is not `"message"`, the machine isn't resting at a human gate right
now — say so and defer to the `gtd:go` skill instead (it owns every other kind).

Otherwise pull out:

- `state` — which gate this is (informs which of the shapes below applies).
- `content` — the rendered gate message; show it to the user, or summarize it
  faithfully if it's long. Never paraphrase away the substance of what's being
  asked.
- `file` / `mode` — the steering file this gate is about, and its format (`qa`,
  `review`, `prose`, or a workflow-declared mode), when the gate has one. Some
  gates (a plain plan-review "accept or edit?" prompt) have no file at all.
- `edges` — each `{pattern, target, describe?}`: the workflow author's own words
  for what happens next along each route out of this gate. Use the `describe`
  text as the natural label for a choice whenever one is present; it is written
  specifically to be shown to the human at this gate.

## Showing the work first (review gates)

When the resolved rest declares a review checkout window (the bundled template's
`await-review`), the diff under review is already sitting in the working tree as
ordinary uncommitted changes — the window rewinds HEAD to the review base so an
editor's git integration shows the whole cycle as a normal dirty tree. Before
asking the user anything, give them a compact view of what's there:

```
git status --short
git diff --stat
```

Follow up with the actual hunks (`git diff`) if the user asks to see more, or if
a specific chunk needs a closer look before they can decide. A person answering
"approve this or not?" needs to see what they're approving without having to
leave the conversation to go look.

## Rendering the gate as native questions

Use the **AskUserQuestion** tool to turn the gate into 1–4 questions, each with
2–4 predefined options plus an automatic free-form "Other" the user can always
type into instead of picking a listed option. How to map the gate onto questions
depends on `mode`:

### `mode: qa` — open questions (e.g. `.gtd/REQUIREMENTS.md`, `.gtd/ARCHITECTURE.md`)

The file holds a `## Open Questions` section, each question a `### <question>`
heading followed by a checkbox list of candidate answers plus a trailing
`- [ ] _your answer_` free-text slot, e.g.:

```markdown
### Which storage backend?

- [ ] SQLite — zero-config, file-based
- [ ] Postgres — for concurrent writers
- [ ] _your answer_
```

Present each OPEN question (one still lacking a tick) as its own AskUserQuestion
question, batching up to 4 per call — more than 4 open questions needs more than
one call. Use the question's own candidate answers as the options (trim the
file's inline rationale into a short option label if needed); always leave room
for free-form, since the tool provides "Other" automatically and the file's own
`_your answer_` slot exists for exactly this. If a question offers no useful
candidates of its own, offer sensible options anyway and expect the user to type
their own answer.

### `mode: review` — the review doc (e.g. `.gtd/REVIEW.md`)

The file groups the diff into chunks, each hunk pointer a
`- [ ] ./path#line — description` line under a `## Chunk Title` heading (the
format gtd's `src/ReviewDoc.ts` defines). Lead with the top-level decision,
using the gate's own `edges[].describe` texts as the option labels when present:

- **Approve everything** — sign off with no comment.
- **Give feedback** — something needs to change.

**Approve everything** means: tick every currently-unchecked `- [ ]` box to
`- [x]`, across every chunk, and add no comments anywhere. Nothing else in the
file changes.

**Give feedback** means: ask the user what the feedback is (free-form; offer to
go chunk-by-chunk if they want to be specific about which hunk each comment
belongs to), then write each comment onto the relevant hunk pointer line as
trailing text after an em dash, e.g.:

```
- [ ] ./src/calc.ts#1 — new add function — reviewer: please rename to sum
```

A note counts as feedback regardless of whether its box ends up ticked or not —
ticking only ever means "I looked at this", never "this is fine now" — so don't
feel obliged to untick a box just because you're adding a comment to it, and
don't tick one just because a comment was resolved.

The user may also simply edit the code directly instead of (or in addition to)
commenting in `.gtd/REVIEW.md` — that's itself feedback the workflow's patterns
recognize on the next step. If the user has already made such an edit, don't
undo or "clean up" it; leave it as part of what gets captured.

### Plan/TODO gates and gates with no `file:`

For a plain prose gate (the simple flow's `plan-review`, or any gate the
workflow author left un-filed), there's no structured document to tick — the
routing itself IS the decision. Use the `edges[].describe` strings as the
options and the gate's `content` as the question text. For the simple flow's
plan review specifically: accepting the plan is a **clean** step (change
nothing), while any edit — a rewritten step, an added constraint, an inline
comment — loops back to the agent to fold in. If the user wants changes, ask
what they want changed and write it into the plan file (e.g. `.gtd/TODO.md`) in
whatever prose shape the existing document already uses.

## Transcription rules

The user's chat answer is the decision; the steering file is the durable record
gtd actually reads. Treat the file's existing structure as the template — mirror
its checkbox syntax, its answer placement, its comment placement — rather than
inventing new markup of your own.

- Never answer a question on the user's behalf.
- Never tick a box, or fill in free text, that the user didn't actually approve.
- Never invent feedback the user didn't give.
- If the user's reply is ambiguous or could map to more than one edit, ask a
  follow-up rather than guessing which one they meant.

## Capture

Once the file reflects the user's answer:

1. Run `gtd validate`. If it reports findings, fix them — these are
   formatting/shape violations only (an unticked-but-required box, a malformed
   pointer line); never use this step to change the _meaning_ of what the user
   answered.
2. Run `gtd step human`.
3. A refusal (non-zero exit) is surfaced to the user verbatim. A common cause is
   an edit that matches none of the gate's declared `on` patterns — when that
   happens, show `gtd status` (which reports, per pending change, whether it
   matched a declared pattern) alongside the gate's `edges` so the user can see
   what's expected and decide how to adjust their answer.
4. On a successful capture, resume the loop by invoking the `gtd:go` skill —
   unless the user has said they want to stop here for now.

## Escape hatch

If the user wants out of the process entirely — not just this one gate — offer
`gtd abandon`. It drops the process's commits but keeps everything they produced
as uncommitted changes in the working tree; nothing is lost, and history is
simply rewound to where the process started. Confirm with the user before
running it — it's the one action in this skill that looks destructive, even
though it isn't.

## Push notifications (web/remote sessions)

When this session is a remote or web session where the user may not be watching,
send exactly one push notification when the loop reaches a gate, summarizing it
in one line — state plus a short description of the ask, e.g. "gtd: review round
2 is ready — approve or give feedback".

The PushNotification tool is a deferred tool: load it first with
`ToolSearch("select:PushNotification")`. If ToolSearch finds no such tool, this
session has no way to push a notification — skip silently, no error, no message
to the user about it.

**Never notify twice for the same unchanged gate.** Before sending, read
`$(git rev-parse --git-dir)/gtd-claude-notified` (a small file in the git
directory — never the work tree, same placement convention as the loop's armed
marker) and compare it against the current `{state, HEAD hash}` pair. Skip the
notification if they match. After sending (or after deciding a notification
isn't warranted because it's unchanged), write the current `{state, HEAD hash}`
pair back into that file so the next check on the same unchanged gate is a
no-op.

After notifying (or skipping), end the turn — the gate is now waiting on the
user's reply, and there's nothing more to do until it arrives.
