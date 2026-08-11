# gtd

gtd derives an agentic workflow — capture, plan, build, check, review — from a
repository's git state, and prints what should happen next for whatever agent
you point at it. The workflow lives in commits and files, never in chat
scrollback.

## Language

### Engine

**Workflow**: The whole definition of what gtd can do, authored as data
(`entry:` + `machines:`) rather than code. One workflow is bundled as the
built-in default; a `.gtdrc` `workflow:` key replaces it wholesale. _Avoid_:
state machine, config, pipeline

**Machine**: A named, reusable, parameterizable group of states, instantiable
more than once with different bindings. The unit that owns a model and a
[memory scope](#memory-scope) — not the state. _Avoid_: module, subgraph, group

**State**: One named position in a workflow, declaring who acts there, exactly
one content kind, and an ordered set of edges out. _Avoid_: node, step, phase

**Actor**: Who is expected to act at a state — `agent`, `human`, or `check`.
`check` is the driver executing a `script` state's rendered command; gtd itself
executes nothing. _Avoid_: role, party, runner

**Driver**: Whatever executes what gtd prints — a driver (the README's minimal
driver, or your own), a loop harness, a CI job, or a person reading it aloud.
gtd is indifferent to which. _Avoid_: harness, runner, client

**Outcome line**: The human-facing line an emitted script prints for what it
just landed — a transition, a bare capture, an abandon, a restore. Authored in
TS (`src/OutcomeScript.ts`), printed by the driver's bash, so it reads the same
whether a driver runs the script or a person pastes it into a terminal. _Avoid_:
report, log line

**Content kind**: The one thing a state carries: a `script`, a `prompt`, a
`message`, or a `commit` template. Which kind it is determines what gtd prints
and who reads it.

**Rest**: Where a process currently waits, fully resolved — the state plus its
rendered content, its model, and its memory key. What `gtd next` prints.
_Avoid_: current state, position

**Process**: One pass through a workflow, from an entry to a squash or an
abandonment. It does not return to where it started. _Avoid_: cycle, run,
session

**Turn**: What an actor actually did — the work sitting in the tree, captured as
one commit. _Avoid_: action, move

**Attempt**: A turn that changed nothing, committed anyway — an empty
`gtd(<actor>): <state>` self-loop at a `prompt` rest declaring no `C` row — so
the fruitless dispatch is in history rather than invisible. Entries in the
process trace, so a `retry:` cap on the state counts them like any other entry
and redirects once the cap is reached.

**Step**: One `gtd step <actor>` invocation. Distinct from a turn: a step may
capture a turn, refuse, or do nothing at all.

**Beat**: One dispatch cycle of the driver loop — resolve a rest, hand its
content to its actor, then step. _Avoid_: iteration, tick, cycle

**Stall**: HEAD is an empty [attempt](#attempt) at the resting `prompt` state,
the tree is clean, and another dispatch would just repeat it — derived from
history (`Edge.ts`'s `stalledAt`), not tracked by any marker, so it survives a
restart and reads the same whether polled, peeked, or dispatched. Sticky until
something actually changes: the workflow's own `C` edge (a state that may
legitimately finish with nothing to change should declare one) or a `retry:`
cap's escalation redirect clears it, never a one-shot report.

**Capture**: Turning a dirty tree into one turn commit, subject
`gtd(<actor>): <from> → <to>` (collapsing to `gtd(<actor>): <to>` when there is
no transition). The matched pattern's target is committed verbatim; nothing
re-derives it afterwards.

**Pattern**: The left side of an edge — a `<status> <glob>` change-matcher, or
the bare token `C` matching a clean tree. A branch outcome is encoded by which
pattern the authored diff happens to match; the pattern is the rule. _Avoid_:
rule, matcher, condition

**Edge**: One whole `on` row — a pattern paired with its target state, plus the
optional `describe`/`action` sentences a `message`/`prompt` renders for a human.

**Refusal**: A step rejected because something happened that nothing recognizes
— a dirty tree matching no declared pattern, or a guard saying no.

**No-op**: A step at a `script`/`message` rest that authors nothing, because the
tree is clean and the state declares no `C` pattern. The default for a
`script`/`message` actor invoked before it has acted — a `prompt` rest's
equivalent is an [attempt](#attempt), not a no-op.

**Settled**: A step with nothing left to land — a no-op at a `script` rest (the
check ran, left nothing any pattern claims, and re-running it cannot change
that), or a rewind back to the initial state retaining nothing. Reported as
`settled: true` by `gtd step --json` so a loop exits rather than spins. An
attempt at a `prompt` rest is not settled but stalled. _Avoid_: done, finished,
idle

**Gate**: A state whose actor is `human` — the process rests there until a
person acts. _Avoid_: checkpoint, approval, the bare "the gate"

**Guard**: An edge-side condition that refuses a step before anything is
captured (the steering-file, answer-completeness, and green-baseline guards).
The opposite of a gate: a gate waits for someone, a guard turns them away.

**Steering file**: A file a state declares via `file:` + `mode:` — how a human
or an agent steers the process by editing prose rather than talking to it.
_Avoid_: state file, gate file, doc

**Mode**: A named pair of shell commands over one steering file — `format:` to
normalize it in place, `validate:` to report findings. Zero findings means
valid. Every mode a state's `mode:` names must be declared in the workflow's own
`modes:` map (`qa`/`review` are seeded there automatically); an undeclared name
is a load-time error, never a silent fallback.

**Steering format**: What a steering file's CONTENT is — the shape a mode's NAME
identifies (`qa`'s open-questions checkboxes, `review`'s hunk pointers),
independent of who validates it. A format is what the LSP outlines/offers
actions over; a mode is that format plus the specific `format:`/`validate:`
commands ONE workflow plugs in for it. Overriding a built-in mode's `validate:`
changes who validates, not what the file is — the format (and so the
outline/actions) survives the override.

**Squash**: Entering a `commit` state, collapsing a whole process's turn commits
into one message. Ends the process.

**Entry**: A state a process may start at — the `default` one, plus every state
declaring `entry: true`, reachable as `gtd step <actor> --entry <state>`.

**Memory scope**: The span of a process over which one conversation persists,
keyed off a machine's position in the machine tree rather than any per-state
field. _Avoid_: session, context window, conversation, history

**Session id**: The agent CLI's own conversation handle — minted per memory
scope and remembered per scope in the git dir (`gtd next --json`'s
`sessionId`/`resume`), so a driver can resume the same agent conversation across
turns in one scope. The one place "session" is the right word — the _Avoid_ on
**Memory scope** stands: gtd's own span is still a memory scope, not a session.

**Review window**: The temporary rewind of HEAD and the index to the review base
while a process rests at a `reviewWindow: true` state, so a whole process's diff
surfaces as ordinary uncommitted changes in any editor's git integration.

**Review base**: The commit a review is measured against — the last state that
declared `reviewBase`, falling back to the process start.

**Retained history**: A squashed or abandoned process's turn-by-turn commits,
kept behind the squash so `gtd restore` can bring them back.

**Vars**: A workflow's own declared values, readable from any template as
`it.vars`. The engine blesses no names: `testCommand` is the bundled workflow's
data, not a key gtd interprets.

### Bundled workflow

These terms belong to the one workflow gtd ships, not to the engine. Replace the
workflow and they go with it.

**Flow**: One path through the bundled workflow, chosen by which steering file
you create at `idle`.

**Simple flow**: A sketch in `.gtd/TODO.md` becomes a plan, a build, and a
review.

**Advanced flow**: Product requirements in `.gtd/REQUIREMENTS.md` go through
product then technical Q&A, decompose into packages, and build in parallel with
per-package review.

**Plan**: The concrete implementation plan an agent develops from a sketch, and
the file it lives in.

**Green baseline**: The test run every entry opens with, proving the suite was
already green before gtd changed anything — so a later red run is attributable.

**Review record**: `.gtd/REVIEW.md` — the review of one process, written as
chunks of hunk pointers, and the artifact a reviewer edits to approve or send
back.

**Chunk**: One coherent group of changes in a review record: a title, a sentence
on what it changes and why, and its hunk pointers.

**Hunk**: One `- [ ] ./path/to/file.ts#42` pointer inside a chunk — a place to
look, and a box a reviewer ticks.

**Open question**: A `###` heading under `## Open Questions` in a Q&A steering
file, carrying candidate answers as checkboxes plus a free-text slot. It becomes
an **answered question** by moving under `## Answered Questions` as prose.

**Package**: One independently buildable slice of an advanced-flow
decomposition.

**Feedback**: What a human or a check writes back to send work around again — a
review's requested changes, or a failing suite's output.
