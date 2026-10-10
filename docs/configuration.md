# Configuration reference

gtd reads two kinds of configuration, both optional:

- **`gtd.config.ts`** — the workflow itself: a TypeScript module that says which
  steps a process goes through. Without one, gtd runs its bundled default
  workflow, so every command works with no configuration at all.
- **`.gtdrc`** — per-repository tuning of whatever workflow is active: process
  settings (`vars`), environment settings (`env`), the judge `gtd judge run`
  uses (`judge`), steering-file modes (`modes`), `gtd ui` settings (`ui`) and
  per-scope skills (`skills`). Nothing else.

> **Trust: `gtd.config.ts` is code, and gtd runs it.** Because the workflow is a
> TypeScript module, every gtd command that resolves workflow state evaluates
> the repository's `gtd.config.ts` — including the read-only ones: `gtd next`,
> `gtd lsp`, `gtd validate`, `gtd judge`, `gtd door` and `gtd doors`, not only
> `gtd land`. Nothing else is evaluated: every workflow lives in this one file
> and what it imports. The lookup walks up from the current directory, so a
> `gtd.config.ts` in a parent directory counts too. Treat a repository's
> `gtd.config.ts` like any other code you run from it — a Makefile, a
> `package.json` script: **do not run gtd in a checkout you do not trust.**
> `.gtdrc` values end up on command lines too (`env:` entries like `testCommand`
> are interpolated into the scripts gtd emits), which is the same trust
> decision.

## `gtd.config.ts`

### Lookup

gtd walks from the current directory **up to your home directory** (or to the
filesystem root when the current directory is outside home) and uses the
**innermost** `gtd.config.ts` it finds. There is no merging: one file is the
whole workflow, and a `gtd.config.ts` found nowhere means the bundled default. A
`.gtdrc` in the same directory still contributes its keys.

`gtd init` never writes a `gtd.config.ts` — write one only to change the
workflow itself.

### Shape

**Every exported function is a workflow**, named by its export, and gtd starts
one with `gtd --workflow <name>` (see [Workflows](#workflows)). The `default`
export is the ordinary start — what a bare change in the tree begins. The names
`default`, `summary`, `base`, `defaults`, `envDefaults`, `steering`, `skills`,
`access` and `doors` are reserved: they are never workflows.

```ts
import { agent, human, run } from "@pmelab/gtd/flows"

export default async function feature() {
  await human("idle", {
    message: "Sketch the change in .gtd/TODO.md.",
    file: ".gtd/TODO.md",
  })
  await agent("plan", "Read the sketch in history and write .gtd/PLAN.md.", {
    file: ".gtd/PLAN.md",
  })
  await run(
    "check",
    "npm test > .gtd/FEEDBACK.md 2>&1 && rm -f .gtd/FEEDBACK.md",
  )
}

export const envDefaults = { testCommand: "npm test" }
```

A **flow** is an `async` function that awaits steps. Its first step on an
ordinary start is where a finished process waits (the bundled workflow calls it
`idle`). A flow takes no arguments; which workflow runs is decided by name. The
reserved exports are optional and per **file**, shared by every workflow the
file exports: `defaults` and `envDefaults` (the file's process and environment
settings, see [Settings](#settings)), `summary` (the prompt `gtd summary`
prints, see [Summary](#summary)), `base` (see [Workflows](#workflows)),
`steering` — steering file paths with their mode, e.g.
`{ ".gtd/docs/adr.md": "adr" }`, which `gtd lsp` serves even before a step
declaring them is reached — `skills` and `doors` (see [Doors](#doors)). gtd
ignores every other non-function export. **A helper you export is a workflow
too**, startable by name — keep helpers un-exported, or export them from another
module you import.

gtd resolves `@pmelab/gtd/flows` itself, so a `gtd.config.ts` needs no
`package.json` or install. Add `@pmelab/gtd` as a dev dependency only if you
want editor type-checking for it.

A direct `@pmelab/gtd/flows` import in `gtd.config.ts` always gets the engine's
own copy, so it cannot mismatch; a dev-dependency pin only feeds editor
type-checking. Only an indirect copy can disagree — a shared workflow package
that bundles its own copy of `@pmelab/gtd`, or ships as CommonJS and requires
its own. Both speak a **flows protocol** version, and a mismatch fails the
replay with
`the workflow speaks flows protocol N, but the engine installed protocol M`.
When the engine's number is higher, upgrade the `@pmelab/gtd` that package
imports; when lower, upgrade gtd. `@pmelab/gtd/flows` exports the workflow's
number as `FLOWS_PROTOCOL`.

### Steps

A step is one position a process can rest at. Each step function takes a
**literal string name** first, and resolves once that step's turn has landed.

| Step                         | Actor   | What the rest asks for                                                                                                                   |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `agent(name, prompt, opts?)` | `agent` | An agent turn. `prompt` is printed as the beat's content; the driver hands it to an agent and lands whatever the agent left in the tree. |
| `human(name, opts?)`         | `human` | A person. The process waits until someone edits and lands. `opts.message` is what gtd shows.                                             |
| `run(name, body, opts?)`     | `check` | A script. `body` is a POSIX `sh` string the driver runs verbatim.                                                                        |
| `judge(name, spec)`          | `judge` | A judgment. A `message` rest carrying typed questions; `gtd judge answer` records the verdict. See [Judges](#judges).                    |
| `restart()`                  | —       | Ends the episode from any depth (see [Episodes](#episodes-replay-and-divergence)). Never rests.                                          |

Flow code decides; a `run` body only carries the decision out. Render it from
the values the flow computed — `check()` and the exported script renderers cover
the common cases (see [Helpers](#helpers)). **The outcome of a run is what it
leaves in the tree**: flow code reads it back through `changes()` and `read()`,
never through a return value.

The step name is the `<to>` in the commit subject the landing writes,
`gtd(<actor>): <from> → <to>`, and every step landing carries a
`Gtd-Step: <name>#<n>` trailer (`<n>` counts how often that name was reached in
the episode). Other trailers a landing may carry: `Gtd-Judge:` (one per answered
judge question), `Gtd-Var:` (a process setting), `Gtd-Cost:` (a
`gtd land --cost`), and `Gtd-Review-Base:` (a workflow's fixed diff base). Every
commit gtd writes also carries `Gtd-Format:` (see
[History format](#history-format)).

### Step options

Every step takes an options object; all keys are optional.

| Option        | Steps                | Meaning                                                                                                                                            |
| ------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`       | all                  | Display name shown by `gtd next` and viewers.                                                                                                      |
| `file`        | all                  | The step's steering file, a repository path under `.gtd/`.                                                                                         |
| `mode`        | all, requires `file` | The steering file's mode: `qa`, `review`, or a name declared under `.gtdrc` `modes:`. An unknown name is a load error.                             |
| `message`     | `human`, `judge`     | The text shown to the person at this rest.                                                                                                         |
| `model`       | `agent`              | An opaque model hint passed through to the driver.                                                                                                 |
| `system`      | `agent`              | A system prompt passed through to the driver — a full replacement for the harness's own, not an addition.                                          |
| `allowEmpty`  | `agent`              | An agent turn that changes nothing completes the step. Without it, such a turn is an **attempt** (see [Landing rules](#landing-rules)).            |
| `acceptClean` | `human`              | A landing that changes nothing completes the gate — "accept as-is". Without it, a clean landing is a no-op and the gate keeps waiting for an edit. |
| `base`        | all                  | The commit this step reviews changes since — what `gtd base` prints while the process rests here. Without it, the process's `start()`.             |

### Branching: helpers read the tree the last step left

Flow code decides what happens next with ordinary `if`/`while`/`for` over pure
helpers. Every helper reads **the commit replay stands on** — the tree the last
landed step left — never the live working tree:

- `read(path)` — a file's content, `undefined` when absent
- `glob(pattern)` — every path matching `pattern` (`*` stays inside one path
  segment, `**` crosses them)
- `changes(glob?)` — what the last step changed, optionally only the paths
  matching a glob: one `{ path, status, before, after }` per path, where
  `status` is `"added"`, `"modified"` or `"deleted"` and `before`/`after` are
  the content on either side (`undefined` on the side where the path is absent).
  The list also has `paths` and `get(path)`. A landing that changed nothing
  yields an empty list
- `changesSince(hash, glob?)` — the same shape as `changes()`, but over every
  commit from `hash` to where replay stands. `hash` must be a commit this run
  read from `head()` or `start()`; any other hash fails the step
- `sections(text)` — the top-level `## ` headings of markdown `text`
- `sectionBodies(text)` — the same sections as `{ title, body }`, `body` being
  the section's own markdown, its heading line included
- `threads(text)` — every `H:`/`A:` thread in a document as
  `{ name, line, waitingOn, faults }` (1-based line; `waitingOn: "human"` means
  open; `faults` its syntax faults).
- `codeThreads()` — every `H:`/`A:` thread in line comments of the files changed
  since the process's diff base (deleted files excluded), as
  `{ path, line, waitingOn, first, faults }` (1-based line, `first` the opening
  `H:` entry's text, `faults` its syntax faults). Reads committed trees
- `openQuestions(text)` — the unanswered questions of a `qa` document, each
  `{ question, line }`
- `vars` — the process settings, pinned at process start (see
  [Settings](#settings))
- `env` — the environment settings, read live (see [Settings](#settings))
- `head()` — the commit the process stands on at this point of the flow;
  `start()` — the process's diff base. Name them in a prompt for an agent to
  inspect a range itself

Flow code is plain code, so it can also keep what it needs across steps in local
variables — a counter, the previous round's report, the commit a review round
started at — since replay re-runs it over the same history every time.

```ts
await agent("build", "Implement .gtd/PLAN.md.")
while (true) {
  await run(
    "check",
    `${env.testCommand} > .gtd/FEEDBACK.md 2>&1 && rm -f .gtd/FEEDBACK.md`,
  )
  if (read(".gtd/FEEDBACK.md") === undefined) break
  await agent("fix", "Fix what .gtd/FEEDBACK.md reports, then delete it.", {
    file: ".gtd/FEEDBACK.md",
  })
  if (changes(".gtd/FEEDBACK.md").get(".gtd/FEEDBACK.md")?.status === "deleted")
    continue
  refuse("fix: delete .gtd/FEEDBACK.md once it is addressed")
}
```

### Composition

- `scope(name, fn)` — prefixes every step name reached inside `fn` with `name.`,
  so `scope("build", () => agent("fix", …))` is the step `build.fix`. Scopes
  nest. The prefix is also the step's **memory scope**: agent steps in one scope
  share one agent conversation (a driver resumes it through `gtd next --json`'s
  `session`), and every agent step in one scope must run with the same `model`
  and `system` — a mismatch fails the process, since one scope is one
  conversation. Steps with no prefix share the `root` scope.
  `scope({ name, model, system }, fn)` also gives every agent step inside `fn`
  that `model`/`system` unless it sets its own; `name` is optional there.
  `scope({ name, skills }, fn)` declares the skill names (`readonly string[]`)
  every agent turn inside `fn` carries — what `gtd next --json`'s `skills` key
  reports. A nested scope inherits its parent's list unless it sets its own,
  which replaces it wholesale. Skills belong to the memory scope, one list per
  scope: agent steps in one scope that resolve to different `model`, `system` or
  `skills` fail the process. `agent()` takes no `skills` option — passing one is
  an error. `scope({ name, access }, fn)` declares the file access every agent
  turn inside `fn` runs with; see [File access](#file-access). `agent()` takes
  no `access` option either: narrower access for one step needs its own
  `scope()`.
- `refuse(message)` — refuse the pending landing: nothing lands, `gtd land`
  exits 1 with `message`, and the process stays where it rests. Call it right
  after a step whose turn left something the flow does not accept.

Plain TypeScript functions that await steps compose like any other code — this
is how the bundled workflow is written.

### Helpers

`@pmelab/gtd/flows` also exports a few helpers:

- `check(name, command, { report, label?, sweep?, sweepOnGreen?, preamble? })` —
  a `run` step gtd renders for the driver: it removes `sweep`, runs `command` in
  a subshell and, on failure, writes its output (stamped with the commit) to
  `report`; on success it removes `report` and `sweepOnGreen`. `preamble` is
  shell lines run first, outside the output capture; an `exit 0` in them skips
  the command and leaves `report` untouched. Resolves `true` unless the run
  wrote `report`
- `answered(answer, expected, minP)` — whether a judge answer is `expected` at a
  probability of at least `minP`
- `numeric(value, fallback)` — a numeric var, or `fallback` when it is blank or
  not a number
- `wrote(path)` and `codeChanges()` — whether the last step wrote `path`, and
  its changes outside `.gtd/`

Three checks refuse a turn from flow code, called right after the step whose
turn they check:

- `requireProgress(file)` — refuses a turn that deleted `file` without changing
  any code, unless the deleted content starts with `NOTHING ACTIONABLE`
- `requireAnswers(file)` — refuses a turn that changed something while a
  question in the `qa` document `file` is still unanswered. A turn that changes
  nothing is accepted
- `requireThreadsClosed(file)` — refuses any landing while a thread in `file`,
  or a code thread in a changed file, waits on the human (its last entry is the
  agent's) or has a syntax fault, listing each as `file:line: [^name]` /
  `path:line: <first H entry>`; the human replies with a conclusion or deletes
  it
- `requireReplies(file)` — refuses an agent turn that leaves a thread in `file`,
  or a code thread in a changed file, whose last entry is `H:` (or that has a
  syntax fault), listing each the same way
- `hasThreadFor(waitingOn, file?)` — whether a thread waits on `waitingOn`: a
  footnote thread in `file` or any code thread
- `requireRevert(edited, base)` — refuses a turn that left any of the `edited`
  changes differing from their content before them

The script renderers (`checkScript`, `revertScript`, `restoreScript`,
`removeScript`, `moveScript`, and `quote`) are exported for a workflow's own
`run` steps.

### Reusing the bundled workflow

`@pmelab/gtd/workflow` is the bundled workflow itself: its default export is the
flow gtd runs without a `gtd.config.ts`, and every part of it is a named export
another workflow can import — its `defaults`, `envDefaults`, `summary`, `base`
and `skills`, the three startable workflows (`feature`, `review`, `fix`), the
phases (`ordinaryStart`, `unwind`, `planAndBuild`, `design`, `architecture`,
`packages`, `buildTail`, `qualityLap`, `healthy`, `gate`, …) and every single
step (`triage`, `build`, `fixCheck`, `reviewing`, `collecting`, …). A step's
name is relative to the `scope()` it runs in — the bundled workflow's
`scope("build", …)` around `healthy` is what makes `build.health.check` — and
the full names are part of gtd's versioned API: they never change outside a
major release, because a rename strands every process resting on the old name.

Re-export `envDefaults` alongside `defaults`: a workflow that re-exports only
`defaults` loses `testCommand`, `fastTestCommand`, `plannerModel` and
`coderModel`. Re-export `skills` alongside `steering`: it is what makes the
bundled workflow's scope names addressable by a `.gtdrc` `skills:` entry in THIS
config (see [The `skills:` key](#the-skills-key)) — dropping it from the
re-export list, the way dropping any other named export does, silently empties
it instead of keeping the bundled defaults, because the loader reads a missing
export as `{}`, not as "inherit the bundled module's".

**Import the phases; never `export *` them.** Every exported function of your
file is a startable workflow, so `export * from "@pmelab/gtd/workflow"` would
turn each phase and step into one — `gtd --workflow buildTail` would start a
half-flow and strand the process. The bundled module's own helpers stay helpers
for that reason; only `feature`, `review` and `fix` are startable from it.
Re-export the reserved names by name, and write each workflow you want as your
own function:

```ts
import { start } from "@pmelab/gtd/flows"
import { afterTail, buildTail, feature } from "@pmelab/gtd/workflow"

export {
  defaults,
  envDefaults,
  summary,
  base,
  steering,
  skills,
} from "@pmelab/gtd/workflow"

export default feature

export async function hotfix() {
  return afterTail(await buildTail(true, start()))
}

export const doors = { hotfix: { workflow: "hotfix" } }
```

The bundled `doors` (`fix`, `review`) are always available; a `doors` export of
yours merges over them (see [Doors](#doors)).

### Judges

`judge(name, { questions, evidence, message?, label? })` asks one or more
questions and resolves to `{ answers, truncated }`. A question is
`{ id, primitive, instructions, criteria }`, where `primitive` is `noul`
(yes/no, read back as `"yes"`/`"no"`), `choice`, or `score` (read back as its
decimal string). `evidence` is what the judge sees as its `state`: an object of
strings, built from `read`/`sections`/`changes`, never from anything the working
tree holds uncommitted. The `judgeBudgetBytes` var is split evenly across its
keys; a value over its share keeps its end, cut on a line boundary.

`answers` holds one `{ answer, p }` per question id, or `undefined` for a
question the verdict left out. `truncated` lists the evidence keys the budget
cut. The flow decides what an answer means with plain comparisons:

```ts
const { answers, truncated } = await judge("same", {
  questions: [{ id: "verdict", primitive: "choice", instructions, criteria }],
  evidence: { current, previous },
})
const verdict = answers.verdict
const stuck =
  truncated.length === 0 && verdict?.answer === "identical" && verdict.p >= 0.9
```

gtd never calls a model. The rest is a `message` whose `gtd next --json` `judge`
field carries the questions; `gtd judge answer` records a verdict as
`Gtd-Judge:` trailers (see [the CLI reference](./cli.md#commands)). Landing with
no verdict leaves every answer `undefined`, so write the flow so that
`undefined` takes the conservative branch.

### Landing rules

What a `gtd land` does depends on the step and on whether the tree changed:

- **Agent, tree changed** — the step completes; the commit carries the
  `Gtd-Step:` trailer.
- **Agent, nothing changed** — an **attempt**: gtd records an empty commit
  `gtd(agent): <step>` and the process stays at the step. Dispatching again
  after an attempt is a **stall** (`kind: "stalled"`), which clears only when
  something changes. Set `allowEmpty: true` on a step where "nothing to change"
  is a legitimate outcome.
- **Human, nothing changed** — a no-op (nothing lands), unless the step sets
  `acceptClean: true`, in which case the clean landing completes the gate.
- **Run, nothing changed** — the step completes. If replaying that landing
  brings the flow straight back to the same step, the landing is a **settled**
  no-op (`gtd land --json`'s `settled: true`): there is nothing more a driver
  can do by running it again.
- **The flow calls `refuse(message)`** while replaying the pending turn — the
  landing is refused, `gtd land` exits 1, and nothing lands.

### Workflows

`gtd --workflow <name>` starts a process on the named workflow: a function the
config file exports, or one of the three bundled ones. An unknown name is a
usage error (exit 2) listing the startable names. The name is recorded on the
process's opening commit (`Gtd-Workflow:`), so every later command replays that
workflow, and a process stays on it even if the config's `default` changes.

A `base(workflow, vars)` export may return a commitish that fixes the new
process's diff base (`start()`), or `undefined` for none. It runs when the
process is started, with the workflow's name and the `--var` values:

```ts
export async function reviewOnly() {
  /* … */
}

export const base = (workflow, vars) =>
  workflow === "reviewOnly" ? (vars.reviewBase ?? "") : undefined
```

```bash
gtd --workflow reviewOnly --var reviewBase=main
```

A blank `base` result means the repository's default branch. Any base is pinned
as its merge-base with `HEAD`, not as the named tip. It is refused when the
commitish does not resolve, shares no common ancestor with `HEAD`, or its
merge-base is `HEAD` itself (nothing to review). `--var <name>=<value>` is
repeatable and only valid with `--workflow`; the name must already be declared
by the workflow's `defaults` or a `.gtdrc` `vars:` — `--var` pins process
settings only, and naming an environment setting is a usage error (exit 2).
Every process setting is recorded as a `Gtd-Var:` trailer on the process's first
commit and stays in force for the whole process (see [Settings](#settings)).

The bundled module offers three workflows: `feature` (the ordinary start, and
the `default`), `fix` (repair a red baseline through the build tail) and
`review` (a pure review of everything since `--var reviewBase=<commitish>`).

**Upgrading:** the old state-named entry flag is gone, replaced by `--workflow`.
Finish or abandon any process started with it before upgrading — its opening
commit names no workflow, so it no longer replays.

### Doors

A door is a named shortcut for starting a workflow, so a person (or a driver)
types `gtd door review main` instead of
`gtd --workflow review --var reviewBase=…`. A file's `doors` export maps each
door name (`[a-z][a-z0-9-]*`) to:

```ts
export const doors = {
  hotfix: { workflow: "hotfix" },
  audit: {
    workflow: "review",
    args: [{ name: "since", optional: true }],
    vars: ({ since }) => (since === undefined ? {} : { reviewBase: since }),
  },
}
```

`workflow` must be startable. `args` is a static list of positional arguments
(required ones first); `vars` is a pure function of the args returning a record
of process settings — no git runs while it is evaluated.

The bundled doors are `fix` and `review [base]`. A repository door of the same
name replaces the bundled one. `gtd door <name> [args...]` starts the process
(printing the same script `gtd --workflow` does); an unknown door or the wrong
number of args is a usage error (exit 2). `gtd doors` lists every door, one
`name [args] → workflow` line each; `gtd doors --json` prints them as data for a
driver to offer.

### Episodes, replay and divergence

gtd keeps **no state outside git**. To find where a process rests, it
**replays** the flow over the current **episode**: the first-parent commits
since the episode began, each answering the step it names, until a step has no
commit left — that step is the rest. Replaying the same history always reaches
the same rest, which is why flow code has to be pure (below).

An episode begins with an opening commit whose `Gtd-Workflow:` trailer names the
workflow it replays. An episode ends when its flow returns or calls `restart()`.
The next episode starts over at the `default` workflow's first step — for the
bundled workflow, `idle`. Because entering that step is what marks an episode
finished, **no started workflow may land on a step of that name** — gtd refuses
the landing. Opening there is fine.

A process opened by the removed `gtd --entry` (an opening commit with no
`Gtd-Workflow:` trailer) is refused by every command but `gtd abandon`.

**There is no migration.** A process's commits are only meaningful to the
workflow that made them. If you change `gtd.config.ts` (or upgrade gtd, and the
bundled workflow changed) while a process is underway and its history no longer
replays to the steps its commits name, gtd refuses loudly with a **divergence**
error and tells you to run `gtd abandon`. Finish or abandon an in-flight process
before changing the workflow under it.

**Breaking change.** BREAKING CHANGE: a workflow whose first step reads a
process or environment setting (any vars/env access, enumeration included) fails
to load; a setting name outside [A-Za-z_][A-Za-z0-9_]* — in workflow
defaults/envDefaults, .gtdrc vars:/env:, or --var — fails to load or is refused.

#### History format

Everything replay reads back out of git — the commit subject, the `Gtd-*`
trailers, the steering files committed into a process, and the tip `gtd abandon`
retains for `gtd restore` — is one versioned **history format**, recorded as a
`Gtd-Format: <n>` trailer on every commit gtd writes. A commit without the
trailer predates it and is format 1, the current format. The retained tip is
versioned by that same trailer on the commit it points at.

The format changes only when one of those encodings does, independently of gtd's
own version. A gtd reads its current format and, after a change, at least the
one before it. A history containing a gtd commit in a format this gtd does not
read is refused by every command that reads it — `gtd abandon`, `gtd restore`
and `gtd summary` included — before anything acts on it: exit `1`, naming the
commit, the format it found and the format it reads, never reported as a
divergence. Run a gtd release that reads that format to continue the process. A
commit gtd did not write (its subject does not start with `gtd`) is never read
for a format.

### Rules for flow code

Flow code is re-run on every gtd command, replaying the process's history, so it
must reach the same steps every time it sees the same history. A `run()` body
and code at the module's top level are exempt — they may do anything.

- **No IO or nondeterminism**: no clock, randomness, environment, network or
  filesystem access in flow code. Read the tree through the helpers; do IO
  inside a `run()` body. gtd cannot see this mistake up front: a flow that
  branches on something other than history shows up later as a divergence.
- **Await only steps**: a flow may `await` a step, `scope()`, or a function that
  itself awaits steps. Awaiting anything else fails the replay:
  `the flow awaited something that is not a step`.
- **Unique names**: one step name per call site; call a shared helper from two
  places inside two different `scope()`s. Two call sites sharing a name read as
  the same step to replay.
- **No try/catch around a step**: `restart()` and a refused step travel as
  exceptions, and a catch would swallow them.
- **Known options only**: a step option gtd does not accept — a typo, or the
  retired `memory` — fails the replay naming the step and the key, since
  `gtd.config.ts` is evaluated without a type check.
- **Shape**: the default export must be the flow, and it must reach a step on an
  ordinary start — that step is where a finished process waits. A flow that
  reaches none fails the load, and so does one whose first step changes with the
  repository's files, and so does one whose first step reads a setting — any
  `vars` or `env` access before it rests, `GTD_<NAME>` overrides included, an
  enumeration too, and a setting named only in its message, label or model. The
  step may read files for its content.
- **Environment settings stay out of branches**: `env` is read live on every
  call, so branching on it can send a running process to a different step than
  its history recorded — a divergence. Read `env` only where it cannot change
  the next step: step options such as `model`, prompt text, and `run()` bodies.
  gtd enforces this for the first step only; branch on `vars` elsewhere.

### Summary

A `summary` export sets the prompt `gtd summary` prints: a function receiving
`{ entryCommit, processBase, processTip, humanCommits, processCost, processCostByModel, vars, env }`
and returning a string. `humanCommits` lists every human-authored commit of the
process as `{ hash, state }`. Without `summary`, `gtd summary` refuses.

Authoring a workflow with a coding agent? `skills/authoring/SKILL.md` is the
agent-facing guide.

## `.gtdrc`

gtd reads an optional `.gtdrc`, discovered on the same walk as `gtd.config.ts` —
from the current directory up to your home directory — but **merged**: every
level found is deep-merged, the innermost winning on overlap. A shared `.gtdrc`
in a worktree-parent directory cascades to every checkout beneath it, and any
checkout can still override it with its own.

Supported filenames (searched in this order):

- `.gtdrc`
- `.gtdrc.json`
- `.gtdrc.yaml`
- `.gtdrc.yml`
- `gtd.config.json`
- `gtd.config.yaml`

### Schema

`.gtdrc` has exactly these top-level keys:

- **`vars`** (object, optional) — a flat `name -> scalar` map of **process
  settings**, one layer of the merged settings (see [Settings](#settings)).
- **`env`** (object, optional) — a flat `name -> scalar` map of **environment
  settings**, the machine-local counterpart of `vars` (see
  [Settings](#settings)). Not the shell's environment: `GTD_<NAME>` environment
  variables override `env:` entries.
- **`judge`** (object, optional) — `{ provider, model }`, which judge
  `gtd judge run` uses. See [The `judge:` key](#the-judge-key).
- **`modes`** (object, optional) — steering-file modes (`format:`/`validate:`
  shell commands) a step's `mode` may name, layered over gtd's built-in `qa` and
  `review` modes.
- **`ui`** (object, optional) — `gtd ui`'s own settings. See
  [The `ui:` key](#the-ui-key).
- **`skills`** (object, optional) — a flat scope full-name -> skill-name array
  map, one entry per scope whose skill list you want to change. See
  [The `skills:` key](#the-skills-key).
- **`access`** (object, optional) — a flat scope full-name ->
  `{ read?, write? }` glob-array map. See [File access](#file-access).
- **`$schema`** (string, optional) — ignored by gtd. Point it at the published
  schema for editor autocompletion (this is what `gtd init` writes):

  ```
  https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json
  ```

  That URL serves `schema.json` straight out of the published npm tarball, so it
  always matches the latest release. Pin it to a major with
  `@pmelab/gtd@8/schema.json`, or point at your own install
  (`./node_modules/@pmelab/gtd/schema.json`) to work offline.

Any other top-level key is **rejected** — the workflow itself lives in
`gtd.config.ts`, never in a `.gtdrc`.

`gtd init` writes a minimal `.gtdrc.json`: the `$schema` line, the one variable
most projects change (`env.testCommand`, defaulting to `npm test`), an empty
`env.fastTestCommand` to fill in (see below), and a `modes:` block suggesting
Prettier as the steering-file formatter (`npx prettier --write "$GTD_FILE"` for
`qa` and `review` — format only, so gtd still validates them). Edit or drop any
of it, then review and commit the file before your first `gtd land`. `gtd init`
takes no argument and refuses to overwrite an existing config; it may also run
in a plain parent directory (not a git repository) to seed a shared config a
nested repository picks up.

### Environment interpolation

Every string leaf of a `.gtdrc` layer — `vars`, `env`, `judge`, `modes`, `ui`,
nested inside an array or not — expands `$NAME` and `${NAME}` from the process
environment before gtd reads it further:

```yaml
# .gtdrc
env:
  plannerModel: $BUILD_MODEL
```

`$$` is the escape for a literal `$` (`$$5` becomes `$5`); any other `$` not
followed by a valid name — a trailing `$`, `$1`, `$-` — is left exactly as
written, so `plannerModel: smart` and a price in a label both survive untouched.
A name that resolves is substituted once; the substituted text is never
re-scanned for more `$NAME` syntax, so a value coming from the environment can
never smuggle in config syntax of its own. A name with no matching environment
variable fails the load with exit 1, naming the config path and the file:

```
gtd config:
  - /path/to/repo/.gtdrc.json: env.plannerModel: "$BUILD_MODEL" references environment variable "BUILD_MODEL", which is not set
```

Two values are exempt, because gtd hands them to `bash`, where `$` is already
the shell's own: `modes:`' `format`/`validate` commands and `ui.format` (see
[the `format:`/`validate:` exemption](#modes) and [the `ui:` key](#the-ui-key)).
A `$GTD_FILE` inside either keeps working unchanged. `--var` values and a
workflow's own `defaults` export are outside this pass entirely — a `--var` is
typed into a shell that already expands `$` itself, and `defaults` is code, not
`.gtdrc`.

### Modes

A mode is a pair of shell commands over one steering file, both optional:

```yaml
modes:
  adr:
    format: npx prettier --write "$GTD_FILE"
    validate: adr-lint "$GTD_FILE"
```

Each command runs in `bash` with `$GTD_FILE` set to the steering file's path.
Quote it (`"$GTD_FILE"`) so a path with spaces stays one argument. The
`<%= it.file %>` templates of earlier versions are refused with a hint to use
`$GTD_FILE` instead. `format:` normalizes the file in place; `validate:` reports
findings, and exits zero only when there are none. A step names a mode with
`{ file, mode }`.

Both `format:` and `validate:` are exempt from
[environment interpolation](#environment-interpolation): `$GTD_FILE` (and any
other `$NAME` written here) reaches `bash` untouched, since the shell already
expands it.

#### Built-in steering formats are ordinary modes

`qa` and `review` are gtd's two built-in steering-file formats (parsed and
validated in-process, because `gtd lsp` needs the same parsers for live
diagnostics), but their `validate:` is not hidden: every workflow's modes are
seeded with `qa`/`review` entries whose `validate:` is the command
`gtd check <mode> '<file>'`. That seeded command is overridable the same way —
declare `modes: { qa: { validate: "your-own-command" } }` and your command
displaces the seed; declaring only a `format:` for `qa`/`review` composes with
the seeded `validate:` rather than replacing it.

The `qa` format also checks section order: `## Open Questions` must come before
every other `##` section in the file, and `## Answered Questions` must come
after every other `##` section — a file that gets this backwards fails
`gtd check qa` / `gtd validate`. A `###` question heading or a `- [ ]` option
indented 4 or more spaces stops counting as one (it is Markdown indented code,
or a lazy continuation of the line above it) and fails `gtd check qa` /
`gtd validate` naming the exact line; 2 or 3 spaces of indent are still fine.

Content nested under a `qa` option — a bullet list or a second paragraph
indented under its `- [ ]`/`- [x]` line — is that option's own detail, shown
alongside it, never part of the answer, and never touched when you write into
the free-text slot.

Both formats also understand **footnotes** — your own comment attached to an
exact spot in the file, for the next agent turn to read as a mandatory note
rather than as an instruction. Mark the spot with `[^name]` (any name, no
whitespace or `]` — the same name may mark more than one spot), then define it
anywhere below — on its own line, at the start of the line — as
`[^name]: explain what you mean here`; a definition's own name must be unique in
the file. Indent a longer comment's continuation lines so they stay part of the
same definition. The next agent turn folds the comment into its own work and
deletes both the marker and the definition — a footnote is never carried forward
or left for a later turn to re-read. `gtd check`/`gtd validate` flag five things
about a footnote: a marker with no matching definition, a definition with no
matching marker, the same name defined twice, a definition whose body is still
empty (a newly seeded definition starts that way), and a definition followed by
text indented 1-3 spaces — too little to join the body as a continuation line —
which names the indent and the 4-space fix rather than calling the body empty —
each fails the file until fixed.

A footnote can also be a **thread**: a conversation. Its definition is a list of
alternating `- H:` and `- A:` entries, the first yours, with continuation lines
indented 4 spaces (oxfmt's 6-space wrap is fine):

```markdown
We cache the result per request.[^cache]

[^cache]:
    - H: why do we do that this way?
    - A: because ...
    - H: then do it this way
```

Only a definition whose body opens with a `H:`/`A:` item is a thread; anything
else stays a one-shot footnote. The agent reads the wording of your last entry:
a question gets one `- A:` reply in the same thread and nothing else changes; a
conclusion or advice gets folded into the document and the marker and definition
are deleted together. If it misreads you, correct it with your next entry. The
agent never starts a thread. A thread is **open** when its last entry is the
agent's. `gtd check`/`gtd validate` flag an item without a `H:`/`A:` prefix, a
first entry by the agent, two consecutive entries by one author, an empty entry,
and anything in the body besides the one list; an open thread is not a finding,
but it refuses every landing at the bundled requirements, architecture and
review gates until you reply with a conclusion or delete it. Those gates stop on
every process; a round that only replies returns to the same gate (at review: no
revert, no development lap). `gtd check <mode> <file> --open-threads` prints
`file:line: [^name]: <first H entry>` for each open thread and exits non-zero
when any exist (modes `qa`, `review`). A `review` line note on a hunk pointer
stays a one-shot note — to discuss a hunk, put a footnote on it.

#### Threads in code comments

The same conversation works in **line comments** of any file changed in the
current process (diff base to working tree, untracked non-ignored files
included; an untouched file is never scanned). Write bare entries — no bullet,
no `[^name]` marker; the comment's position is the anchor:

```ts
// H: why do we retry here?
// A: the upstream drops the first request after idle
```

- Only line comments count: `//` (`.ts`, `.js`, `.go`, `.rs`, `.c`, `.java` and
  kin), `#` (`.feature`, `.py`, `.sh`, `.rb`, `.yaml`, `.toml`), `--` (`.sql`,
  `.lua`, `.hs`), `;` (`.lisp`, `.clj`, `.ini`, `.asm`). A file with no mapped
  extension (`Makefile`, `Dockerfile`) is scanned for all four; `.md` and
  `.gtd/**` never. Block comments (`/* */`, `<!-- -->`) and trailing comments
  after code never form a thread
- A thread is one run of consecutive same-token comment lines whose first line
  starts with `H:`; an unprefixed line in the run continues the `H:` entry
  above; the first non-comment line ends it, and so does an unprefixed line
  below an `A:` line — the agent's entries are one line, so a comment you write
  there stays an ordinary comment
- Same rules as a footnote thread: entries alternate, the agent never starts
  one, an open thread (agent spoke last) refuses landing at the requirements,
  architecture and review gates, and the agent answers a question with exactly
  one `A:` line directly below, or folds a conclusion in and deletes the thread.
  A syntax fault (agent opens, same author twice, empty entry) refuses too
- A thread-only code change is not a review code edit: a question at the review
  gate gets its reply and rests there, no lap
- A code thread is transient — it must not survive the lap that settles it
- Code threads are not shown in the phone UI. `gtd check --open-threads` with no
  `<mode> <file>` lists them as `path:line: <first H entry>` (and one line per
  fault), exiting non-zero when any are printed; it reads the process's diff
  base, and prints nothing (exit 0) when no process is underway

#### The normalization-only contract on `format:`

`gtd land`'s own emitted script never runs a mode's `format:`/`validate:` pair —
it is only the HEAD assertion and the commit. Formatting and validating a
steering file is a driver contract instead: run it explicitly, ahead of
`gtd land`, off `gtd next --json`'s own `validate` field (or `gtd validate`,
which prints the same script). A driver that skips this can land a malformed or
unformatted steering file — `gtd land` itself does not stop it.

A mode's `format:` command may reformat a steering file — whitespace, wrapping,
reordering — but must NEVER change what a landing guard would decide. gtd's
checks (`requireProgress`, `requireAnswers`, `requireRevert`, and the
review-file checks) decide once, against whichever bytes are on disk at the
moment `gtd land` runs — which may be before OR after a driver's own separate
`format:` run. That is only safe because every built-in guard judges only the
content it explicitly cares about, not incidental formatting around it. If you
plug in your own `format:` command, the same rule binds it: a formatter that
also changes meaning — stripping a paragraph a guard reads — makes the guard's
decision and the file's actual content disagree, and gtd will not catch that for
you.

#### A missing binary in `format:`/`validate:` fails loudly, before it runs

The emitted script checks a mode's `format:`/`validate:` command against `$PATH`
before running it, whenever that command is a single unambiguous leading word
(e.g. `adr-lint "$GTD_FILE"`): a typo'd or uninstalled binary exits 127 with a
`gtd:`-prefixed message naming the mode, the `format`/`validate` key, the
binary, and the resolved `$PATH` it was looked up in, instead of a raw shell
error. A command gtd cannot reduce to one binary — a `VAR=x`-prefixed command, a
pipeline, anything with a shell metacharacter — gets no such check and fails
exactly as it always has.

### The `ui:` key

`gtd ui`'s five settings, all optional — a flat struct, so an unknown sub-key is
rejected the same way any other unknown config key is. `gtd ui` serves exactly
the ONE worktree it is invoked in — there is no roots/discovery setting, because
there is no fleet to discover:

- **`port`** (integer, optional) — with neither this key nor `host` given, the
  port `gtd ui` publishes through `tailscale serve`, walking 8443, then 10000,
  then 443 until one publishes. When `host` (or `--host`) opts out of serve,
  this is the bind port instead — with neither this key nor `--port` given, the
  OS picks a free one. `0` (like `--port 0`) means the same auto-pick as leaving
  it unset entirely.
- **`host`** (string, optional) — opts out of the default `tailscale serve`
  front door and binds this address directly instead, showing it in the printed
  URL — the same effect as `--host`. With neither this key nor `--host` given,
  `gtd ui` publishes through `tailscale serve` and falls back to binding a
  Tailscale interface (a CGNAT `100.64.0.0/10` address, auto-detected) directly
  whenever serve isn't available — it never refuses.
- **`cert`** / **`key`** (strings, optional) — paths to an existing certificate
  and private key, used as-is. `--self-signed` always overrides these with a
  freshly generated throwaway pair, even when both are configured.
- **`format`** (string, optional) — a shell command run after every write
  `gtd ui` makes to the steering file, before the phone's request resolves, with
  `$GTD_FILE` set to the written file's absolute path. Absent means no command
  runs at all. gtd ships no formatter — bring your own (`oxfmt`, `prettier`, a
  script). A non-zero exit or a missing binary never reverts the write or
  refuses it — the phone is told which command ran and what it exited with, and
  the bytes it already wrote stay on disk either way. `format` is exempt from
  [environment interpolation](#environment-interpolation), the same as a mode's
  own `format:`/`validate:` — `$GTD_FILE` reaches `bash` untouched.

Flags (`--host`, `--port`, `--self-signed`) always override the matching `ui:`
value; see `docs/cli.md`'s `ui` row for the full flag list.

### The `judge:` key

Which judge `gtd judge run` uses, both fields optional: **`provider`** (`fixed`,
`jev` or `llm`) and **`model`** (the `claude` model, for provider `llm` only). A
flat struct — an unknown sub-key or a provider outside the three is rejected.
Layered like `ui:`: an inner `.gtdrc` wins per field. It is read from `.gtdrc`
files alone, never from a workflow, and `gtd judge run` needs no repository to
read it.

Per field, the first one set wins: the `--provider` / `--model` flag, then the
`GTD_JUDGE_PROVIDER` / `GTD_JUDGE_MODEL` environment variables (an empty value
counts as unset), then `judge:`, then the automatic pick (`jev` when
`TYPESAFE_API_KEY` is set and no model is given, otherwise `llm`). A model
resolved for a provider other than `llm` is an error, whichever layer supplied
each half. A repository can pin `jev` here while a laptop flips to `llm` with
`GTD_JUDGE_PROVIDER=llm`, without touching the driver. `GTD_<NAME>` does not
reach `judge:`.

```yaml
# .gtdrc
judge:
  provider: jev
```

### The `skills:` key

A flat map, scope full name -> array of skill names. Skills are declared per
SCOPE (`scope({ name, skills }, …)`), not per step: every agent turn in a scope
carries that scope's list. An entry REPLACES the scope's bundled (or
custom-workflow-declared) list wholesale — it never merges into it — and also
feeds the `skills` key `gtd next --json` reports at each turn in that scope (see
[Writing your own driver](./driver.md#writing-your-own-driver)); `[]` means no
skills at all for that scope, and no skills preamble either.

```yaml
# .gtdrc
skills:
  packages.item.fix.suite: [debugging-and-error-recovery]
  build: [debugging-and-error-recovery, my-org-runbook]
```

The bundled workflow's addressable scope full names:

`design`, `architecture`, `architecture.decompose`, `packages.item`,
`packages.item.fix.suite`, `packages.item.health`, `build`, `build.health`,
`build.fix.quality`, `build.review`, `build.review.fix.nits`,
`build.review.fix.risks`, and one `build.quality.<lens>` per `qualityReviews`
entry.

A nested scope with no entry of its own inherits its parent's list, so a key on
a parent reaches every scope beneath it that sets none. The group scopes
`packages.item.fix`, `build.fix`, `build.review.fix` and `build.quality` run no
turn and carry no key. A custom workflow's own scopes are addressable through
its own `skills` export (see
[Reusing the bundled workflow](#reusing-the-bundled-workflow)); the export may
be a function of the resolved vars, and must list every scope holding an agent
step. The schema can validate an entry's VALUE (an array of strings) but never
its KEY, since scope names come from the workflow actually in play — there is no
editor autocompletion of scope names here.

A key that is not a scope running a turn is a load error, exit 1 — a group scope
such as `build.fix`, or a step name rather than its scope. The message lists the
known scope keys. Keying config on a scope's full name widens what renaming a
scope breaks: it also orphans every `.gtdrc` `skills:` entry naming it, which
becomes an unknown key and exits 1.

`qualityReviews` (a `vars:` entry, not a `skills:` one — see
[Settings](#settings)) and the `build.quality.<lens>` keys are a pair:
`qualityReviews` decides how many quality-lap turns run, one per lens, and each
lens is its own scope, keyed `build.quality.<lens>`. By default that scope's
skills ARE the lens; a `build.quality.<lens>` entry REPLACES them with the
configured list, leaving the prompt body's own mention of the lens untouched.
Such a key is valid only while the lens is listed in `qualityReviews`, judged
against the running process's recorded settings, or against live `.gtdrc`/env
plus `--var` when no process is underway. A key added for a lens mid-process
errors until that process finishes.

### File access

A scope can say which files its agent turns may read and write:

```ts
scope({ name: "review", access: { read: ["src/**", "docs/**"], write: [".gtd/REVIEW.md"] } }, …)
```

- `read` and `write` are lists of globs in the same dialect as `glob()` and
  `changes()` (`*` stays inside one path segment, `**` crosses them).
- A missing side is unrestricted; `[]` allows nothing on that side.
- `read` and `write` are independent: a `write` glob grants no read.
- A nested scope inherits its parent's access unless it sets its own, which
  replaces the parent's wholesale (never merged). `{}` reopens everything a
  parent restricted.
- The step's own steering file is always included, on both sides, so a
  restricted turn can still answer its prompt.
- `agent()` takes no `access` option; narrower access for one step needs its own
  `scope()`.

`gtd next --json` reports the result as `access` on every prompt (see
[Writing your own driver](./driver.md#writing-your-own-driver)).

**`write` is enforced by gtd**: `gtd land` refuses a turn that changed a path
outside it, exit 1, nothing lands. **`read` is not a security boundary unless
the driver enforces it at the OS level**: gtd cannot see what an agent reads,
and a prompt-level hint or a tool-level deny is bypassable by a shell command. A
`write` restriction has one more gap: a write to a gitignored path never shows
up in the tree gtd checks, so it escapes the landing check.

#### The `access:` key

`.gtdrc` takes a flat scope full-name -> `{ read?, write? }` map, one entry per
scope whose access you want to change. An entry REPLACES the scope's declared
access wholesale and reaches every nested scope that sets none of its own, like
a `skills:` entry.

```yaml
# .gtdrc
access:
  build.review: { write: [".gtd/REVIEW.md", "docs/**"] }
  design: {} # lift the bundled restriction
```

An entry key other than `read`/`write`, or a scope name that is not a scope
running a turn, is a load error, exit 1; the message lists the known scopes. A
custom workflow's own scopes are addressable through its `access` export (a
record, or a function of the resolved vars, of scope -> `{ read?, write? }`).
Precedence: `.gtdrc` entry, then a `scope()` option, then the workflow's
`access` export.

#### Bundled defaults

Only planning and review scopes are restricted, and only on writes; no bundled
scope restricts reads. Build and fix scopes carry no entry.

| Scope                                             | `write`                                    |
| ------------------------------------------------- | ------------------------------------------ |
| `design`                                          | `[]`                                       |
| `architecture`                                    | `.gtd/REQUIREMENTS.md`                     |
| `architecture.decompose`                          | `.gtd/packages/**`, `.gtd/ARCHITECTURE.md` |
| `build.review`                                    | `.gtd/REVIEW.md`                           |
| `build.review.fix.nits`, `build.review.fix.risks` | `{}` (reopened: fixes edit code)           |
| `build.quality.<lens>`                            | `[]`                                       |

### Validation and errors

Config problems — an unknown `.gtdrc` key, a wrong type, a `gtd.config.ts` that
fails to evaluate or whose default entry reaches no step — are collected
together. A bad config fails **once**, listing every finding, at load time —
before anything touches the repository — never partially. Each line names the
file it came from and, for `.gtdrc`, the config path:

```
gtd config:
  - /path/to/repo/.gtdrc.json: env.testCommand: "env.testCommand" must be a string, number, or boolean, got array
```

A step naming a mode no layer declares fails the same way, as soon as the
process rests at it:

```
gtd config: step "idle": mode "adrs" is not a mode this workflow knows (qa, review)
```

A `skills:` key that is not a scope running a turn fails the same way, listing
the known scope keys. It is reported when gtd resolves the current state, not by
every config read (see [The `skills:` key](#the-skills-key)):

```
gtd config:
  - /path/to/repo/.gtdrc.json: skills.build.fix: "skills.build.fix" is not a scope that runs a turn — known scopes: architecture, architecture.decompose, build, …
```

A setting under the wrong key is a load error naming the right one, with no
deprecation window and no silent routing:

```
gtd config:
  - /path/to/repo/.gtdrc.json: vars.testCommand: "vars.testCommand" is an environment setting — move it under "env:"
```

The mirror error covers a process setting under `env:`, and a name under both
`vars:` and `env:` is an error even when no workflow declares it. A workflow
declaring one name in both `defaults` and `envDefaults` fails to load.

The same problem carried by several `.gtdrc` layers prints one line per file: a
nearer layer overriding the value does not silence the outer layer's line,
because each is a separate edit in a file you own. All load failures exit **1**
and write to **stderr**, never stdout.

gtd requires a repository with **at least one commit** before any state command
(`land`, `--workflow`, `door`, `doors`, `next`, `abandon`, `restore`,
`validate`, `summary`) will run — there is no workflow state to derive from an
empty history. `gtd init`, `gtd install`, `gtd lsp`, and `gtd check` are
unaffected, since none of them needs a process history (`gtd lsp` still loads
`gtd.config.ts`).

## Settings

A workflow's settings come in two kinds, told apart by what they may change.

- A **process setting** changes which step comes next — flow code branches on
  it, so every replay must see the same value. Flow code reads `vars`.
- An **environment setting** only changes how a step runs on this machine — the
  test command, a model hint — so it follows the machine, even mid-process. Flow
  code reads `env`.

A workflow declares process settings in `defaults` and environment settings in
`envDefaults`; a name in both is a load error.

A setting name is a letter or `_`, then letters, digits or `_`
(`[A-Za-z_][A-Za-z0-9_]*`), in `defaults`, `envDefaults`, `.gtdrc` `vars:` and
`env:`, and `--var`: any other name fails the load, or is refused as a usage
error for `--var`. The flow's first step — where a finished process waits — may
not read a setting at all, process or environment (any `vars`/`env` access,
enumeration included); such a workflow fails the load, naming the setting.

**A process setting's value is committed to Git history in its `Gtd-Var:`
trailer and stays there. A secret belongs in an environment setting
(`envDefaults`, `env:`, or `GTD_<NAME>` for an `env` name), which is never
recorded.** A `GTD_<NAME>` export of a process setting is recorded too.

**Process settings** are resolved once, at process start, from four layers,
**later wins**, and recorded as sorted `Gtd-Var:` trailers on the process's
first commit:

1. **The workflow's `defaults` export.**
2. **A `.gtdrc` `vars:` key** — per-repository tuning without touching the
   workflow.
3. **`--var <name>=<value>`** on `gtd --workflow <name>`. Each name must already
   be declared by layer 1 or 2; an undeclared name is refused (exit 1), and
   naming an environment setting is a usage error (exit 2).
4. **`GTD_<UPPERCASE-name>` environment variables** — matched case-insensitively
   against the names layers 1–2 declare: `GTD_QUALITYREVIEWS` overrides
   `qualityReviews`. A `GTD_*` variable matching no declared name is ignored.

Every later `gtd` call reads the recorded values and never the live layers, so
**editing `.gtdrc` or exporting `GTD_<NAME>` for a process setting mid-process
is ignored, silently, for the running process**; the new value applies from the
next process on. A process recorded before settings were pinned resolves live. A
value spanning several lines cannot be recorded and refuses the process start,
naming the setting.

**Environment settings** are resolved on every call, never recorded, from three
layers, later wins: the workflow's `envDefaults`, a `.gtdrc` `env:` key, and
`GTD_<UPPERCASE-name>` environment variables for any name those declare. A
process started on a laptop and continued in CI uses CI's test command.
`GTD_<NAME>` environment variables override `env:` entries.

Values in `vars:` and `env:` must be scalars (string/number/boolean), coerced to
strings; an object or array value is a load error. A `--var` value is always a
single-line string as given on the command line. gtd itself blesses no setting
names — `testCommand` is the bundled workflow's data like any other.

```yaml
# .gtdrc — overriding the bundled workflow's testCommand
env:
  testCommand: npm run test:ci
```

```bash
# highest precedence — beats both the workflow default and the .gtdrc value above
GTD_TESTCOMMAND="npm run test -- --bail" gtd next
```

The bundled workflow puts a preamble naming the skills an agent step loads (its
scope's `.gtdrc` `skills:` entry — see [The `skills:` key](#the-skills-key))
ahead of that step's prompt; an empty entry switches it off for that scope. A
preamble in a workflow of your own must carry three clauses, or it is unsafe:
load only what your harness has and skip the rest silently; THE STEP'S OWN FILE
FORMAT AND COMPLETION CONDITION OUTRANK ANYTHING A SKILL SAYS; never turn the
turn interactive, because no one is at a keyboard. The precedence clause is
load-bearing — the preamble sits above the step's own format prose, so a skill
that reflows the steering file changes which branch the flow takes next.

### The bundled workflow's settings

Overridable through `.gtdrc` (`vars:` or `env:`, by kind) or `GTD_<NAME>`.
**Environment settings:**

- **`testCommand`** (`npm test`) — the suite every health check and baseline
  gate runs. It is interpolated into a POSIX `sh` script, so keep it
  sh-compatible.
- **`fastTestCommand`** (no default, required) — the fast suite: everything but
  e2e. The package loop's health check runs it. While unset the workflow rests
  at its entry check (see [`fastTestCommand`](#fasttestcommand)).
- **`plannerModel`** (`smart`) / **`coderModel`** (`base`) — the `model` hints
  of the planning/reviewing steps and of the building/fixing steps.

**Process settings:**

- **`judgeIdenticalMinP`** (`0.7`) — the confidence an "identical failure"
  verdict at `health.judge` needs before a red streak escalates early. Blank,
  non-numeric or non-finite means it can never be cleared, so the early
  escalation is off.
- **`reviewNoteActionable`** (`0.7`) — `build.review.triage`'s floor a
  non-`edit` verdict (`question`, `nit`, `praise`) on a review note must clear.
  Below it, the note counts as `edit` and goes to `build.review.collecting` and
  a replan. A note whose evidence was cut, or that got no verdict, also counts
  as `edit`. Blank makes every note `edit`. Triage answers are keyed `note-<n>`.
- **`judgeBudgetBytes`** (`32768`) — the total byte budget split across one
  judge step's evidence keys. Must be a positive integer; blank, zero, negative
  or fractional values fail the step rather than disabling the bound.
- **`qualityReviews`**
  (`correctness, owasp-security, ponytail-review, test-audit, conventions, spec-challenge`)
  — sets the quality lap `build.quality` runs ahead of the human review: one
  turn per comma-separated lens, in order. It is the one skill control still
  living under `vars:` rather than `skills:` — it decides the turn COUNT. Each
  lens is its own scope, keyed `build.quality.<lens>`; by default that scope's
  skills ARE the lens, and a `build.quality.<lens>` entry (see
  [The `skills:` key](#the-skills-key)) replaces them, valid only while the lens
  is listed here. Every round pays for it, so extend the list only as far as
  that is worth paying for — each lens adds about 1–1.5 min and about $0.5 per
  run; blanking it disables the lap. `correctness` (loads
  `code-review-and-quality`), `conventions` and `spec-challenge` are built-in
  lenses whose brief rides in the prompt; every finding any lens writes,
  blocking or not, is fixed by the one fix turn. See
  [Setup](./setup.md#extending-the-quality-review-lap).
- **`reviewBase`** (empty) — the commitish `--workflow review` reviews from
  (`gtd door review` sets it).

The prompts' wording — the voice below, the personas, the shared rules — is not
a variable: a workflow that wants different words writes its own prompts,
reusing the bundled workflow's steps and phases where it can (see
[Reusing the bundled workflow](#reusing-the-bundled-workflow)).

#### The voice

gtd ships its own writing voice for the files it generates — the default, not an
opt-in. It is a specialisation of the "Spartan" output style from
[alexgreensh/attention-span](https://github.com/alexgreensh/attention-span)
(AGPL-3.0), written from a reading of that project's version `0.6`: gtd's own
prose stating the same density discipline, rewritten for deliverables (files
that run as long as the work needs) rather than chat replies. No upstream text
ships in gtd's bundle. This is a point-in-time derivation with no refresh
mechanism — it will silently go stale as upstream moves on.

- **The voice itself** is injected into every agent step that writes a
  deliverable: the package files, `.gtd/REQUIREMENTS.md`, `.gtd/ARCHITECTURE.md`
  and `.gtd/REVIEW.md`.
- **A format contract** follows it for machine-read files: the format contract
  (headings, checkbox rows, marker lines) outranks the voice, and a violation
  refuses the turn. It is injected at the steps whose output a parser reads
  (`design.triage`, `architecture.author`, `build.review.reviewing`,
  `build.review.collecting`).

Files a script writes carry no injected voice: `.gtd/FEEDBACK.md` holds verbatim
test output plus a HEAD stamp.

### Escalation

A red suite that stays red past three fix turns — or that `health.judge` calls
"identical" to the previous round — escalates instead of retrying forever,
counting escalation rounds since the last green check:

- **Under 2 rounds** — an agent turn at `health.describe` reads
  `.gtd/FEEDBACK.md`, `.gtd/PRIOR_FEEDBACK.md` when present, and the code the
  earlier attempts touched, then writes `.gtd/ESCALATION.md`: what is failing,
  why the attempts did not resolve it, and concrete approaches to try next. The
  process then waits at the human gate `health.stop`: edit the file or land it
  untouched — either way it becomes the next fix turn's primary instruction.
- **At 2 or more rounds** — no third document is written. The last
  `.gtd/ESCALATION.md` stays in place and the process waits at
  `health.exhausted`, naming both that file and `.gtd/FEEDBACK.md`. Editing the
  document there is what gives the next attempt anything new to try; landing it
  untouched tries the same analysis again.

A round is one `health.describe` turn since the last green check; editing the
file at the human gate never spends one. Both gates release straight into the
caller's fix step (`build.fix` or `packages.item.fix.suite.fixing`), so the turn
that consumes the document is the very next one. `.gtd/ESCALATION.md` is
free-form prose with no mode of its own.

## `fastTestCommand`

Required environment setting for the bundled workflow: the fast suite (every
test but e2e). Set it under `env:` in `.gtdrc` or as `GTD_FASTTESTCOMMAND`.
There is no fallback to `testCommand`; a blank value counts as unset. While
unset the workflow writes `.gtd/SETUP.md`, names the setting, and rests at its
entry check, re-checking on every beat until it is filled. The package loop's
health check runs the fast suite.
