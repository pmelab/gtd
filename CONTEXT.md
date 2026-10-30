# gtd

gtd derives an agentic workflow — capture, plan, build, check, review — from a
repository's git state, and prints what should happen next for whatever agent
you point at it. The workflow lives in commits and files, never in chat
scrollback.

## Language

### Engine

**Workflow**: A named [flow](#flow) a `gtd.config.ts` exports through
`workflow(flow, options?)` — or a [workflow factory](#workflow-factory) —
started by `gtd start <name>`. gtd ships none; `feature`, `review` and `fix`
come from gtd-workflows' `default`, and their own words are in its glossary.
_Avoid_: state machine, config, pipeline, entry

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
never writes it. _Avoid_: snapshot, lockfile, bundle (for the file)

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

**Step**: One named position a process can rest at, reached by awaiting
`agent()`, `human()`, `run()` or `judge()`. Its name is the `<to>` of the commit
subject that lands it and, up to its last dot, its
[memory scope](#memory-scope). _Avoid_: state, node, phase

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

**Process**: One pass through a workflow, from its first step to the flow's end
or an abandonment. It does not return to where it started. _Avoid_: cycle, run,
session

**Episode**: The commits one run of the flow answers — first-parent history
since the episode began. It ends when the flow returns or calls `restart()`; the
next begins at the flow's first step on an ordinary start. _Avoid_: session, run

**Replay**: How gtd finds the rest: run the flow again, answering each step from
the episode's next commit, until a step has no commit left. Pure over history,
so flow code must be pure too. _Avoid_: fold, resume, reconstruct

**Divergence**: History that no longer replays — a commit naming a step the
current workflow does not reach there. gtd refuses loudly and points at
`gtd abandon`; there is no migration. _Avoid_: drift, stale state, migration

**History format**: The version of everything replay reads back out of git —
subject, `Gtd-*` trailers, committed steering formats, the retained tip —
written as `Gtd-Format: <n>` on every gtd commit, 1 when absent. A history in a
format gtd does not read is refused as such, never as divergence. Independent of
the package version. _Avoid_: schema version, gtd version

**Flows protocol**: The version of the replay context a workflow's copy of
`@pmelab/gtd/flows` and the running gtd share. A mismatch is refused as such,
naming which side to upgrade. Independent of the package version. _Avoid_: API
version, facade version

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
per beat: [`schema`](#schema), `kind`, `content`, `log`, and — on a `prompt`
beat only — `session` (`{id, resume}`, derived) and the embedded `validate`
script. The driver's whole read surface. _Avoid_: next payload, dispatch
document

**Schema**: The integer every JSON document a driver reads leads with — a beat
document, `gtd land --json`, the judge documents. Bumped only when a field is
removed or renamed, never for an added one. Not the
[history format](#history-format) and not the package version. _Avoid_: wire
version, protocol version

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

**Steering file**: A file a step declares via `file` (+ `mode`) — how a human or
an agent steers the process by editing prose rather than talking to it. _Avoid_:
state file, gate file, doc

**Mode**: A named pair of shell commands over one steering file — `format:` to
normalize it in place, `validate:` to report findings. Zero findings means
valid. Declared in the [config export](#config-export)'s `modes`
(`qa`/`review`/`findings` are seeded automatically); a step naming an undeclared
mode is a load-time error, never a silent fallback.

**Steering format**: What a steering file's CONTENT is — the shape a mode's NAME
identifies (`qa`'s open-questions checkboxes, `review`'s hunk pointers,
`findings`' fix boxes), independent of who validates it. A format is what the
LSP outlines/offers actions over; a mode is that format plus the specific
`format:`/`validate:` commands one repository plugs in for it. Overriding a
built-in mode's `validate:` changes who validates, not what the file is.

**Thread**: A footnote whose definition holds an alternating `H:`/`A:` exchange.
_Avoid_: conversation, comment chain

**Code thread**: A thread written as bare `H:`/`A:` line comments (`//`, `#`,
`--`, `;`) in a file changed in the current process, anchored by its own
position. _Avoid_: inline thread, comment thread

**Open thread**: A thread whose last entry is the agent's — it waits on the
human. _Avoid_: unanswered thread

**Squash**: Not an engine concept — gtd never rewrites history. A process ends
with ordinary commits, keeping every turn; a squash (or an amend, or a PR body)
is something a human or a driver may still do afterward, outside gtd, using
`gtd summary`'s prompt to write the message. The turns survive it: see
[process history](#process-history).

**Memory scope**: The span of a process over which one agent conversation
persists — a step name up to its last dot, i.e. its `scope()` prefixes (`root`
when there are none). One scope, one model, system prompt and skill list.
_Avoid_: session, context window, conversation, history

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

**Chunk**: One coherent group of changes in a `review`-mode steering file: a
title, a sentence on what it changes and why, and its hunk pointers.

**Hunk**: One `- [ ] ./path/to/file.ts#42-70` pointer inside a chunk — a place
to look, and a box a reviewer ticks.

**Open question**: A `###` heading under `## Open Questions` in a Q&A steering
file, carrying candidate answers as checkboxes plus a free-text slot. It becomes
an **answered question** by moving under `## Answered Questions` as prose.
