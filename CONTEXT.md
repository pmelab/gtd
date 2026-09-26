# gtd

gtd derives an agentic workflow — capture, plan, build, check, review — from a
repository's git state, and prints what should happen next for whatever agent
you point at it. The workflow lives in commits and files, never in chat
scrollback.

## Language

### Engine

**Workflow**: The whole definition of what gtd can do — the default export of a
`gtd.config.ts`, mapping [entry](#entry) names to [flows](#flow). One workflow
is bundled as the built-in default; a repository's own `gtd.config.ts` replaces
it wholesale. _Avoid_: state machine, config, pipeline

**gtd.config.ts**: The TypeScript module a workflow lives in — the innermost one
walking up from the current directory, never merged. Code gtd evaluates on every
command that resolves workflow state, so it carries the same trust as any other
script in the repository. _Avoid_: workflow file, workflow config, `.gtdrc`
workflow

**Flow**: An async function that awaits [steps](#step) — plain code, branching
over what the last step left in the tree. The workflow's one kind of logic.
_Avoid_: machine, state table, graph

**Step**: One named position a process can rest at, reached by awaiting
`agent()`, `human()`, `run()` or `judge()`. Its name is the `<to>` of the commit
subject that lands it and, up to its last dot, its
[memory scope](#memory-scope). _Avoid_: state, node, phase

**Fragment**: A reusable function of steps exported alongside the step API — a
health loop, a question gate, a review tail. The step names it declares are
public, versioned API. _Avoid_: machine, sub-workflow, module

**Actor**: Who is expected to act at a step — `agent`, `human`, `check` (a `run`
step, executed by the driver) or `judge`. gtd itself executes nothing. _Avoid_:
role, party, runner

**Driver**: Whatever executes what gtd prints — a driver (the README's minimal
driver, or your own), a loop harness, a CI job, or a person reading it aloud.
gtd is indifferent to which. _Avoid_: harness, runner, client

**Outcome line**: The human-facing line an emitted script prints for what it
just landed — a transition, a bare capture, an abandon, a restore. It reads the
same whether a driver runs the script or a person pastes it into a terminal.
_Avoid_: report, log line

**Content kind**: What a rest hands the driver: `capture`, `message`, `script`,
`prompt` or `stalled`. Every rest resolves to exactly one.

**Rest**: Where a process currently waits, fully resolved — the step plus its
content, its model, and its memory key. What `gtd next` prints. _Avoid_: current
state, position

**Process**: One pass through a workflow, from an entry to the flow's end or an
abandonment. It does not return to where it started. _Avoid_: cycle, run,
session

**Episode**: The commits one run of an entry's flow answers — first-parent
history since the episode began. It ends when the flow returns or calls
`restart()`; the next begins at the default entry's first step. _Avoid_:
session, run

**Replay**: How gtd finds the rest: run the flow again, answering each step from
the episode's next commit, until a step has no commit left. Pure over history,
so flow code must be pure too. _Avoid_: fold, resume, reconstruct

**Divergence**: History that no longer replays — a commit naming a step the
current workflow does not reach there. gtd refuses loudly and points at
`gtd abandon`; there is no migration. _Avoid_: drift, stale state, migration

**Analyzer finding**: A load-time error against `gtd.config.ts`, reported as
`<file>:<line>:<col>: <message>` — IO in flow code, a non-literal or duplicate
step name, a `try`/`catch` around a step, an await on something that is not a
step. _Avoid_: lint warning, compile error

**Turn**: What an actor actually did — the work sitting in the tree, captured as
one commit. _Avoid_: action, move

**Attempt**: An agent turn that changed nothing, committed anyway as an empty
`gtd(agent): <step>` — so the fruitless dispatch is in history rather than
invisible. The process stays at the step, unless it sets `allowEmpty`.

**Land**: Recording what an actor did — `gtd land` decides and emits the script;
the driver running that script is what actually writes to git. The verb for the
third move of a [beat](#beat). Actorless: which actor a landing is attributed to
is derived from the resting step, never passed in. _Avoid_: step actor, commit,
capture the turn

**Beat**: One read of `gtd next --json` and whatever it demands — nothing (a
`message` or `stalled` beat halts the loop), an immediate land (`capture`), or
an execution followed by a land (`script`/`prompt`). _Avoid_: iteration, tick,
cycle

**Beat document**: `gtd next --json`'s output — one self-describing JSON line
per beat: `kind`, `content`, `log`, and — on a `prompt` beat only — `session`
(`{id, resume}`, derived) and the embedded `validate` script. The driver's whole
read surface. _Avoid_: next payload, dispatch document

**Stall**: HEAD is an empty [attempt](#attempt) at the resting agent step, the
tree is clean, and another dispatch would just repeat it — derived from history,
not tracked by any marker, so it survives a restart and reads the same whether
polled, peeked, or dispatched. Sticky until something actually changes.

**Capture**: Turning a dirty tree into one turn commit, subject
`gtd(<actor>): <from> → <to>` with a `Gtd-Step: <name>#<n>` trailer. What the
flow does next is decided by replaying it over that commit, never re-derived
from the subject.

**Refusal**: A landing rejected before anything is captured — a guard saying no,
or the flow calling `refuse()` because nothing it branches on explains the turn.

**No-op**: A landing that authors nothing: a clean tree at a human step without
`acceptClean`. An agent step's equivalent is an [attempt](#attempt), not a
no-op.

**Settled**: A landing with nothing left to do — a clean run whose replay leads
straight back to the same step, so re-running it cannot change anything.
Reported as `settled: true` by `gtd land --json` so a loop exits rather than
spins. _Avoid_: done, finished, idle

**Gate**: A human step — the process rests there until a person acts. _Avoid_:
checkpoint, approval, the bare "the gate"

**Guard**: A step option that refuses a landing before anything is captured
(`requireProgress`, `answerGate`, `requireRevert`). The opposite of a gate: a
gate waits for someone, a guard turns them away.

**Steering file**: A file a step declares via `file` (+ `mode`) — how a human or
an agent steers the process by editing prose rather than talking to it. _Avoid_:
state file, gate file, doc

**Mode**: A named pair of shell commands over one steering file — `format:` to
normalize it in place, `validate:` to report findings. Zero findings means
valid. Declared under `.gtdrc` `modes:` (`qa`/`review` are seeded
automatically); a step naming an undeclared mode is a load-time error, never a
silent fallback.

**Steering format**: What a steering file's CONTENT is — the shape a mode's NAME
identifies (`qa`'s open-questions checkboxes, `review`'s hunk pointers),
independent of who validates it. A format is what the LSP outlines/offers
actions over; a mode is that format plus the specific `format:`/`validate:`
commands one repository plugs in for it. Overriding a built-in mode's
`validate:` changes who validates, not what the file is.

**Squash**: Not an engine concept — gtd never rewrites history. A process ends
with ordinary commits, keeping every turn; a squash (or an amend, or a PR body)
is something a human or a driver may still do afterward, outside gtd, using
`gtd summary`'s prompt to write the message.

**Entry**: A named flow a process may start at — `default`, plus every other key
of the workflow, reachable as `gtd --entry <name>` and optionally fixing the
process's diff base. _Avoid_: initial state, entry state

**Memory scope**: The span of a process over which one agent conversation
persists — a step name up to its last dot, i.e. its `scope()` prefixes (`root`
when there are none). One scope, one model and system prompt. _Avoid_: session,
context window, conversation, history

**Session id**: The agent CLI's own conversation handle — DERIVED from a memory
scope's key (a `uuidv5` hash), never stored anywhere, so the same scope-run
always re-derives the same id (`gtd next --json`'s
`session.id`/`session.resume`) and a driver can resume the same agent
conversation across turns in one scope. The one place "session" is the right
word — the _Avoid_ on **Memory scope** stands.

**Review base**: The commit a review is measured against — the commit entering
the last step that set `reviewBase`, falling back to the process start.

**Retained history**: A rewound process's turn-by-turn commits, kept behind a
ref so `gtd restore` can bring them back — written only when `gtd abandon`
rewinds an in-flight process. `gtd land` never moves HEAD, so it never writes
this ref.

**Vars**: Flat string values flow code reads as `vars` — the workflow's own
defaults, then `.gtdrc` `vars:`, then an entry's `--var`, then `GTD_<NAME>`. gtd
blesses no names: `testCommand` is the bundled workflow's data, not a key gtd
interprets.

### Bundled workflow

These terms belong to the one workflow gtd ships, not to the engine. Replace the
workflow and they go with it.

**Unwind**: The step (`unwind`) that reverts the entry commit's diff — the
change that started the process, whether a hand-edit to real code or a scratch
note — back out of the working tree, leaving it identical to the process's start
commit. The input's intent isn't lost: it survives in history for
`design.triage` to read.

**Concern**: One ordered, independently greenable unit of work `design.triage`
groups the process's start diff into — a unit `architecture.author` may later
coarsen by re-merging it with another concern whose file footprint coincides.

**Product concern** / **Technical concern**: A concern's classification — a
product concern is a user-facing/requirements decision, raised (if it has an
open point) by `design.triage`; a technical concern is an implementation
decision, raised by `architecture.author`.

**Triage**: `design.triage`'s own job — reading the diff that started the
process (never rendered into its prompt) and grouping/classifying it into
concerns.

**Question gate**: The shared check/answer pair (`design.gate`/
`architecture.gate`) that rests the process at a human answer gate only while
its phase's steering file (`.gtd/REQUIREMENTS.md` or `.gtd/ARCHITECTURE.md`) has
an unanswered open question — a question-free phase skips the human stop
entirely. Its presence is signaled by the `.gtd/QUESTIONS.md` marker file,
stamped or removed by the gate's own check script and never read for content.

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

**Package**: One independently buildable and independently greenable slice a
concern turns into — `architecture.decompose`'s output, one file per concern as
it stands after `architecture.author`'s possible re-merging.

**Satisfied package**: A package whose acceptance criteria are already met
before its build turn runs — recorded as evidence in `.gtd/SATISFIED.md` rather
than implemented, and reviewed and closed out like any other.

**Feedback**: What a human or a check writes back to send work around again — a
review's requested changes, or a failing suite's output.
