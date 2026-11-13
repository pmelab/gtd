# gtd

gtd reads a repository's git history, replays a workflow over it, and prints
what should happen next for whatever driver you point at it. The workflow lives
in commits and files, never in chat scrollback.

## Language

### Fundamentals

**Workflow**: A named [flow](#flow) that a repository offers to start. Given
what a process has already committed, it decides which [step](#step) comes next.
gtd ships none: every workflow is written in the repository that uses it.
_Avoid_: state machine, pipeline, config

**Step**: One named place a process can rest, where one [actor](#actor) is
expected to act. A commit lands at a step by name, so [history](#history) reads
as a sequence of steps. _Avoid_: state, node, phase

**History**: The first-parent commits of a process's branch. The only state gtd
has: everything it knows about a process, it reads back from here. _Avoid_:
state file, log

**Replay**: How gtd finds the [rest](#rest): run the flow again from its start,
answering each step from the next commit in [history](#history), until a step
has no commit left. Every command replays, so flow code must be pure. _Avoid_:
fold, resume, reconstruct

**Driver**: Whatever runs what gtd prints and lands the result — a loop, a CI
job, an editor, or a person at a terminal. gtd is indifferent to which. _Avoid_:
harness, runner, client

**Content kind**: What a step hands over when a process rests there: a
[message](#message), a [script](#script) or a [prompt](#prompt).

**Message**: Text for a person. The driver shows it and stops, because only a
human can move the process on.

**Script**: A shell script the driver runs as the turn itself — a check step's
command. The script `gtd land` prints is a **landing script** and the one
`validate` carries is a **validation script**; never say bare "script" for
either.

**Prompt**: Text for an agent, with the model, [memory scope](#memory-scope) and
validation that go with it. The driver hands it to the agent and lands what the
agent left in the tree. _Avoid_: task, instruction

**Beat kind**: What a driver is told to do at a rest — the content kind, unless
the tree or history overrides it: `capture`, `message`, `script`, `prompt` or
`stalled`. Every rest resolves to exactly one, and the set is closed.

**Capture**: The beat kind of a [message](#message) rest on a dirty tree: the
person already acted, so the driver lands at once. Making the commit is
[landing](#land), never capturing.

**Stall**: The beat kind of an agent step whose last turn changed nothing, on a
clean tree. Dispatching again would only repeat it, so the driver stops. Derived
from history, never stored, and sticky until something changes.

**Judgment**: The questions a judge step asks about a turn. A **verdict**
answers them, from a model or a person. A judge step rests as a message, never
as a prompt. _Avoid_: prompt, review

### Engine

**Default workflow**: The workflow an ordinary start (no `gtd start`) runs — the
config's required `default` export, which may be a plain flow. It goes by the
named export it also is, else `default`, and is not startable as
`gtd start default`.

**gtd.config.ts**: The TypeScript module a workflow lives in — the innermost one
walking up from the current directory, never merged. Code gtd evaluates on every
command that resolves workflow state, so it carries the same trust as any other
script in the repository. The only repository config. _Avoid_: workflow file,
workflow config, rc file

**Pin**: gtd's engine and one workflow — its config, every module it imports and
every npm package they use — as one gzipped ES module, after a plain-text header
line naming the pin format and the gtd version. `gtd bundle` prints it; gtd
never writes it. A process's pin is the one committed at `.gtd/process.gtdpin`,
by its [pin beat](#pin-beat). _Avoid_: snapshot, freeze, frozen engine,
lockfile, bundle (for the file)

**Hand-over**: The `gtd` on `PATH` running a command on the process's pin
instead of itself, in the same Node process — unless the command is one the pin
does not run or `--live` asks for this gtd. _Avoid_: delegation, proxy, shim

**Pin beat**: A process's first beat after it starts — a `script` beat at actor
`check` resting at `gtd:pin`, marked `pin: "add"`, whose script writes
`gtd bundle`'s output to `.gtd/process.gtdpin`; its landing commits that file
alone, with a `Gtd-Pin` trailer. Never a turn. `gtd repin` runs it again
mid-process, from the live engine and config, with an [anchor](#anchor) when the
live workflow diverges. _Avoid_: snapshot, freeze, frozen engine

**Unpin beat**: A process's last beat, once its flow has ended — a `script` beat
resting at `gtd:unpin`, marked `pin: "remove"` that deletes
`.gtd/process.gtdpin`; its landing is the commit that closes the process. Never
a turn. _Avoid_: thaw, unfreeze

**Config export**: `gtd.config.ts`'s reserved `config` export, built with
`defineConfig` — the repository settings a workflow does not own: modes, `ui`,
per-scope skills and access. _Avoid_: `.gtdrc` (removed), rc config

**Feature flag**: An env-only boolean, `GTD_FLAG_<NAME>`, a flag gtd knows; an
unknown `GTD_FLAG_*` is ignored; no-promise tier. Distinct from a process or
environment setting — except a workflow's own release flag, a `flag_<name>`
process setting that `GTD_FLAG_<NAME>` pins at process start.

**Flow**: An async function that awaits [steps](#step) — plain code, branching
over what the last step left in the tree. The workflow's one kind of logic.
_Avoid_: machine, state table, graph

**Workflow module**: A TypeScript module in which every export passed through
`workflow()` and every [workflow factory](#workflow-factory) (bar `default` and
`config`) is a workflow named by its export; any other exported function is a
helper. A workflow's settings, doors, base, steering files, skills, access and
summary are its **workflow options** — `workflow(flow, options)` or a factory
build — never file-level exports; `config` configures the repository. _Avoid_:
machine, sub-workflow, fragment, reserved export (for an option)

**Workflow factory**: A function, made with `defineWorkflow`, that returns a
workflow configured by its options; gtd validates the options when it loads the
config. _Avoid_: preset, template, builder

**Actor**: Who is expected to act at a step — `agent`, `human`, `check` (a `run`
step, executed by the driver) or `judge`. gtd itself executes nothing. _Avoid_:
role, party, runner

**Outcome line**: The human-facing line an emitted script prints for what it
just landed — a transition, a landing at the same step, an abandon, a restore.
It reads the same whether a driver runs the script or a person pastes it into a
terminal. _Avoid_: report, log line

**Rest**: Where a process currently waits, fully resolved — the step plus its
content, its model, and its memory key. What `gtd next` prints. _Avoid_: current
state, position

**Process**: One pass through a workflow, from its first step to the flow's end
or an abandonment. It does not return to where it started. _Avoid_: cycle, run,
session

**Episode**: The commits one run of the flow answers — first-parent history
since the episode began. It ends when the flow returns or calls `restart()`; the
next begins at the flow's first step on an ordinary start. _Avoid_: session, run

**Divergence**: History that no longer replays — a commit naming a step the
current workflow does not reach there. gtd refuses loudly and points at
`gtd abandon`, and at `gtd repin` for a pinned process, which continues from it
through an [anchor](#anchor). _Avoid_: drift, stale state, migration

**Anchor**: A repin's `Gtd-Anchor` trailer, naming the last commit the new
workflow replays. The commits after it stay as files only, never step answers,
and the process rests at the step the new workflow reached there, on HEAD's tree
— or ends, when the flow ended there. _Avoid_: migration, rebase, checkpoint

**History format**: The version of everything replay reads back out of git —
subject, `Gtd-*` trailers, committed steering formats, the retained tip —
written as `Gtd-Format: <n>` on every gtd commit, 1 when absent. A history in a
format gtd does not read is refused as such, never as divergence. Independent of
the package version. _Avoid_: schema version, gtd version

**Flows protocol**: The version of the replay context a workflow's copy of
`@pmelab/gtd/flows` and the running gtd share. A mismatch is refused as such,
naming which side to upgrade. Independent of the package version. _Avoid_: API
version, facade version

**Turn**: What an actor actually did — the work sitting in the tree, landed as
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
per beat: [`schema`](#schema), `kind`, `content`, `log`, and — on a `prompt`
beat only — `session` (`{id, resume}`, derived) and the embedded `validate`
script. The driver's whole read surface. _Avoid_: next payload, dispatch
document

**Schema**: The integer every JSON document a driver reads leads with — a beat
document, `gtd land --json`, the judge documents. Bumped only when a field is
removed or renamed, never for an added one. Not the
[history format](#history-format) and not the package version. _Avoid_: wire
version, protocol version

**Refusal**: A landing rejected before anything is recorded — a guard saying no,
or the flow calling `refuse()` because nothing it branches on explains the turn.

**No-op**: A landing that authors nothing: a clean tree at a human step without
`acceptClean`. An agent step's equivalent is an [attempt](#attempt), not a
no-op.

**Settled**: A landing with nothing left to do — a clean run whose replay leads
straight back to the same step, so re-running it cannot change anything.
Reported as `settled: true` by `gtd land --json` so a loop exits rather than
spins. _Avoid_: done, finished, idle

**Gate**: A human step — the process rests there until a person acts. The
workflow kit's `gate()` is a loop around one: it holds a scope until a condition
passes, resting at the step it is given between tries. _Avoid_: checkpoint,
approval, the bare "the gate"

**Check**: Three things, never the bare word: a **check step** — a `run()` step,
whose actor is `check` (the driver runs its script); `check()`, the flow helper
that is one such step running a command and keeping a failure's output in a
report file; and `gtd check`, which validates one steering file against its
format and reads no workflow. Flow code turning a turn away is a
[guard](#guard), not a check. _Avoid_: "check" alone

**Guard**: A test in flow code that refuses a turn right after the step that
took it (`requireProgress`, `requireAnswers`, `requireRevert`, or any
`refuse()`). The opposite of a gate: a gate waits for someone, a guard turns
them away.

**Steering file**: A file a step declares via `file`: an ordered list of
[widgets](#widget), and the only channel between agent and human: the agent
writes widgets; the human answers them, edits the file directly, or adds
[annotations](#annotation). Every steering file has the same one format; gtd
validates it, never a repository. _Avoid_: state file, gate file, doc, mode,
steering format, declared format, document type

**Widget**: One typed unit of a steering file that the agent places and the
human reads or answers: review checklist, single select, multi select, boolean,
or static content. A heading of any level marked with its kind's emoji starts an
input widget; the prose between that heading and its input is the widget's
**description**. Everything else is static content. The answer lives in the
widget's own markdown, never beside it. A single select and a review checklist
must be answered in full unless the human annotated the file. _Avoid_: block,
control, component, field, id

**Steering step**: An agent step that declares a steering file. Its turn writes
that file and nothing else — it never implements — and the file is the only
thing it says to the human. _Avoid_: planning step, doc step

**Annotation**: A footnote the human attaches to any paragraph or widget of a
steering file. The next steering step integrates it into the document and
removes it; it is never answered in place. _Avoid_: thread, comment, note

**Ship**: A `ship()` step: one commit on the user's branch `<b>` carrying the
process's tree minus `.gtd/`, made while the process keeps every turn on
`gtd/<b>`. gtd never rewrites history — the ship is a new commit, and the turns
stay reachable through the `Gtd-History` ref it names. _Avoid_: squash (no
commit is rewritten), merge, release

**Memory scope**: The span of a process over which one agent conversation
persists — a step name up to its last dot, i.e. its `scope()` prefixes (`root`
when there are none). One scope, one model, system prompt and skill list.
_Avoid_: session, context window, conversation

**Session id**: The agent CLI's own conversation handle — DERIVED from a memory
scope's key (a `uuidv5` hash), never stored anywhere, so the same scope-run
always re-derives the same id (`gtd next --json`'s
`session.id`/`session.resume`) and a driver can resume the same agent
conversation across turns in one scope. The one place "session" is the right
word — the _Avoid_ on **Memory scope** stands.

**Review base**: The commit a review is measured against — the `base` the
resting step names, falling back to the [process base](#process-base). What
`gtd base` prints.

**Process base**: The commit a process's diff is measured from — `start()` in
flow code: the commit before the process began, or the one a workflow's `base`
export (or its factory's) fixed when `gtd start` started it.

**Base**: Never alone — say [review base](#review-base) or
[process base](#process-base). The `base` step option sets the first, the `base`
export the second.

**Retained history**: A rewound process's turn-by-turn commits, kept behind a
ref so `gtd restore` can bring them back — written only when `gtd abandon`
rewinds an in-flight process. _Avoid_ for a finished process: see
[process history](#process-history).

**Process history**: A finished process's turns, kept at
`refs/gtd/history/<entry>` by the landing that ends it. Read with `gtd history`;
distinct from [retained history](#retained-history), which `gtd restore`
consumes.

**Kept tip**: A `keep: true` agent step's turn, set aside off the branch at
`refs/gtd/kept/<entry>/<step>/<hash>`; the branch gets an empty marker commit
carrying `Gtd-Kept: <hash>` instead. Never listed by `gtd history`, never
deleted by a landing. _Avoid_: beat tip, discarded tip.

**Process setting**: A flat string value flow code reads as `settings` and may
branch on — the workflow's `defaults` (or a factory option), then the `--var` on
`gtd start`, then `GTD_<NAME>`. Resolved once at process start and recorded in
the process's first commit; a later edit does not reach the running process. gtd
blesses no names. Avoid: "Vars", `vars` (removed name).

**Environment setting**: A flat string value flow code reads as `envSettings`,
only where it cannot change the next step — the workflow's `envDefaults`, then
`GTD_<NAME>`. Read live on every call, never recorded; a test command is a
workflow's data, not a key gtd interprets. Avoid: "Vars", `env` (removed name),
"env var" (that is a shell variable).

**Chunk**: One review checklist widget: a coherent group of changes, with a
title, a sentence on what it changes and why, and its hunk pointers.

**Hunk**: One `- [ ] ./path/to/file.ts#42-70` pointer inside a chunk — a place
to look, and a box a reviewer ticks.
