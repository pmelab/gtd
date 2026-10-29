# Configuration reference

A repository's configuration is one file, **`gtd.config.ts`**: a TypeScript
module that says which steps a process goes through, with which settings, plus
the repository settings in its [`config` export](#the-config-export) —
steering-file modes, `gtd ui` settings, per-scope skills and access. It is
required: without one, every command that resolves workflow state fails, saying
to run `gtd install`, which says where to get one. gtd ships no workflow: use
one from [gtd-workflows](https://github.com/pmelab/gtd-workflows) or write your
own.

Settings that belong to a machine rather than a repository live outside it: the
judge `gtd judge run` uses (see [Judge settings](#judge-settings)), plus
`GTD_<NAME>` variables (see [Settings](#settings)). The `.gtdrc` files earlier
versions read are gone — a leftover one is an error (see
[Migrating from `.gtdrc`](#migrating-from-gtdrc)).

> **Trust: `gtd.config.ts` is code, and gtd runs it.** Because the workflow is a
> TypeScript module, every gtd command that resolves workflow state evaluates
> the repository's `gtd.config.ts` — including the read-only ones: `gtd next`,
> `gtd lsp`, `gtd validate`, `gtd judge`, `gtd door` and `gtd doors`, not only
> `gtd land`. Nothing else is evaluated: every workflow lives in this one file
> and what it imports. The lookup walks up from the current directory, so a
> `gtd.config.ts` in a parent directory counts too. Treat a repository's
> `gtd.config.ts` like any other code you run from it — a Makefile, a
> `package.json` script: **do not run gtd in a checkout you do not trust.**
> Settings end up on command lines too (a test command a workflow interpolates
> into the scripts gtd emits), which is the same trust decision.

## `gtd.config.ts`

### Lookup

gtd walks from the current directory **up to your home directory** (or to the
filesystem root when the current directory is outside home) and uses the
**innermost** `gtd.config.ts` it finds. There is no merging: one file is the
whole workflow. A `gtd.config.ts` found nowhere is an error naming
`gtd install`.

gtd ships no workflow and `gtd install` writes no config. Get one from
[gtd-workflows](https://github.com/pmelab/gtd-workflows), a pinned checkout
whose `gtd-wf config default` prints a `gtd.config.ts` importing its `default`
workflow by absolute path (see its README), or write your own (see
[Shape](#shape) below and [Testing a workflow](./testing.md)).

**Upgrading from a gtd that shipped workflows:** `@pmelab/gtd/workflows`,
`@pmelab/gtd/workflow` and `@pmelab/gtd/workflows/<name>` no longer resolve, so
a config importing them fails to load. Replace it with the one
`gtd-wf config default` prints: gtd-workflows' `default` keeps the same step
names, so a process already underway keeps replaying.

### Shape

**Every exported function is a workflow**, named by its export, and gtd starts
one with `gtd --workflow <name>` (see [Workflows](#workflows)). So is every
exported [workflow factory](#workflow-factories) and every call of one. The
`default` export is the ordinary start — what a bare change in the tree begins —
and is required; a default that is also a named export goes by that name. The
names `default`, `summary`, `base`, `defaults`, `envDefaults`, `steering`,
`skills`, `access`, `doors` and `config` are reserved: they are never workflows.

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
ordinary start is where a finished process waits (`idle` in the example above).
A flow takes no arguments; which workflow runs is decided by name. The reserved
exports are optional and per **file**, shared by every workflow the file
exports: `defaults` and `envDefaults` (the file's process and environment
settings, see [Settings](#settings)), `summary` (the prompt `gtd summary`
prints, see [Summary](#summary)), `base` (see [Workflows](#workflows)),
`steering` — steering file paths with their mode, e.g.
`{ ".gtd/docs/adr.md": "adr" }` — `skills`, `doors` (see [Doors](#doors)) and
`config` (see [The `config` export](#the-config-export)). gtd ignores every
other non-function export. **A helper you export is a workflow too**, startable
by name — keep helpers un-exported, or export them from another module you
import.

gtd resolves every `@pmelab/gtd/*` subpath but the testkit's (see
[Entrypoints](https://github.com/pmelab/gtd/blob/main/README.md#entrypoints)),
to its own copy, so a repository — JavaScript or not (Python, Rust, notes) —
needs no `package.json`, `node_modules` or install: a root `gtd.config.ts` is
all it takes. Add `@pmelab/gtd` as a dev dependency only if you want editor
type-checking for it.

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
`gtd land --cost`), `Gtd-Review-Base:` (a workflow's fixed diff base),
`Gtd-Branch:` and `Gtd-Version:` (only on the landing that finishes a process),
`Gtd-Mark:` (`<name>=<value>`, one per `mark()` call), `Gtd-Kept:` (only on the
marker a `keep` step lands, see [Step options](#step-options)), `Gtd-Approved:`
(only on the landing that completes an `approve` gate: one JSON object with the
`step`, the git `user.name` and `user.email`), and `Gtd-Config:` (see
[Config purity](#config-purity)). Every commit gtd writes also carries
`Gtd-Format:` (see [History format](#history-format)).

### Step options

Every step takes an options object; all keys are optional.

| Option        | Steps                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`       | all                  | Display name shown by `gtd next` and viewers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `file`        | all                  | The step's steering file, a repository path under `.gtd/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `mode`        | all, requires `file` | The steering file's mode: `qa`, `review`, `findings`, or a name declared in `config.modes`. An unknown name fails the process once it rests at the step.                                                                                                                                                                                                                                                                                                                                                      |
| `message`     | `human`, `judge`     | The text shown to the person at this rest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `model`       | `agent`              | An opaque model hint passed through to the driver.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `system`      | `agent`              | A system prompt passed through to the driver — a full replacement for the harness's own, not an addition.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `allowEmpty`  | `agent`              | An agent turn that changes nothing completes the step. Without it, such a turn is an **attempt** (see [Landing rules](#landing-rules)).                                                                                                                                                                                                                                                                                                                                                                       |
| `keep`        | `agent`              | Cannot be combined with `allowEmpty`. Set the turn aside: it lands off the branch under `refs/gtd/kept/<entry>/<step>/<hash>` and the branch gets an empty marker commit (subject, `Gtd-Step:`, `Gtd-Kept: <hash>`) instead. See [Kept tips](#kept-tips).                                                                                                                                                                                                                                                     |
| `acceptClean` | `human`              | A landing that changes nothing completes the gate — "accept as-is". Without it, a clean landing is a no-op and the gate keeps waiting for an edit.                                                                                                                                                                                                                                                                                                                                                            |
| `approve`     | `human`              | A sign-off gate; implies `acceptClean`. Only a **clean** `gtd land` completes it — any edit is refused, and git must have an author identity. Cannot be combined with `mode` or `file` (refused when replay reaches the step, so earlier steps may already have landed). That commit carries `Gtd-Approved: {"step":"<step>#<n>","name":"<name>","email":"<email>"}`. Git hooks do not run on that commit; `commit.gpgSign` still applies (a failing signer refuses the approval). See [`seamGate`](#judges). |
| `base`        | all                  | The commit this step reviews changes since — what `gtd base` prints while the process rests here. Without it, the process's `start()`.                                                                                                                                                                                                                                                                                                                                                                        |

### Kept tips

An agent step with `keep: true` takes its turn off the branch. Landing it
commits the turn as a commit **outside** the branch, parented on the commit the
turn started from, and points `refs/gtd/kept/<entry>/<step>/<hash>` at it
(`<entry>` is the process's first commit, or the commit it started from when the
keep step is the flow's initial step; `<step>` the step's full name; `<hash>`
the kept commit). The branch itself returns to where it was and gains one empty
marker commit carrying the step's usual subject and `Gtd-Step:` plus
`Gtd-Kept: <hash>`; the turn's files never appear in the branch's history, and a
process that replays past the marker never reaches the keep step again.

- The step's full name must pass `git check-ref-format` as a ref component and
  must not contain `/`. `keep` cannot be combined with `allowEmpty`: a turn that
  changes nothing has nothing to keep. Neither is checked at load: the process
  fails, with a message naming the step, when it reaches the step — so a keep
  step behind a branch not yet taken can fail after earlier steps have landed.
- Every pass keeps its own ref, so keeping the same step again never drops the
  earlier pass. A kept ref lives until you delete it: no landing deletes it, and
  a finished process does not either.
- Commit hooks do not run on the marker commit (its tree is always the commit
  the turn started from); commit signing (`commit.gpgSign`) still applies. If
  the marker cannot be written (a failing signer, the branch moving underneath):
  the landing exits 1, the turn is left in the working tree, and no kept ref
  remains, unless restoring the turn itself fails, in which case the kept ref
  stays. If only the final working-tree cleanup fails, the marker has already
  landed: the turn is still in the working tree and under its kept ref; discard
  it by hand before asking gtd again, or it lands on the branch with the next
  step.
- `kept(name)` answers from the `Gtd-Kept:` object, which exists only in the
  clone that landed the turn. Refs are never pushed or fetched. Deleting the ref
  of a live process lets `git gc` drop the object, and a flow that routed on
  `kept(name)` then replays a different path. Delete kept refs only once the
  process is finished.
- Read a kept tip back with `kept(name)` (see
  [helpers](#branching-helpers-read-the-tree-the-last-step-left)), or inspect it
  by hand with `git log <ref>`.
- `gtd history` neither lists nor fetches kept refs, and `Gtd-Format` stays `1`:
  `Gtd-Kept:` is additive.

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
  the content on either side (`undefined` on the side where the path is absent,
  or whose content could not be read, such as a submodule or an oversized file).
  The list also has `paths` and `get(path)`. A landing that changed nothing
  yields an empty list
- `changesSince(hash, glob?)` — the same shape as `changes()`, but over every
  commit from `hash` to where replay stands. `hash` must be a commit this run
  read from `head()` or `start()`; any other hash fails the step
- `mark(name, value)` — record a fact on the landing that leaves the current
  rest: one `Gtd-Mark: <name>=<value>` trailer per call, in call order, names
  may repeat. `name` matches `/^[a-z][a-z0-9-]*$/`; `value` is one non-empty
  line with no control character — anything else throws and fails the replay.
  Calls made while replaying history are ignored. Needs a gtd that knows `mark`,
  else it throws asking for an upgrade
- `kept(name)` — the latest kept tip of step `name` (scoped from here, like
  `agent()`) in this episode, as `{ hash, changes }`: the kept commit and what
  it changed against the commit it diverged from (same shape as `changes()`).
  `undefined` when none; a `restart()` starts over with nothing kept. While the
  keeping turn is still landing, `hash` is `""`: never branch on it. Needs a gtd
  that knows `keep`, else it throws asking for an upgrade. See
  [Kept tips](#kept-tips)
- `matches(path, pattern)` — whether `path` matches `pattern` in the same glob
  dialect as `glob()` and `changes(glob)`
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
  `session`), and every agent step in one conversation must run with the same
  `model` and `system` — a mismatch fails the process. A fresh `scope()` call of
  the same name is a fresh conversation, free to differ. Steps with no prefix
  share the `root` scope. `scope({ name, model, system }, fn)` also gives every
  agent step inside `fn` that `model`/`system` unless it sets its own; `name` is
  optional there. `scope({ name, skills }, fn)` declares the skill names
  (`readonly string[]`) every agent turn inside `fn` carries — what
  `gtd next --json`'s `skills` key reports. A nested scope inherits its parent's
  list unless it sets its own, which replaces it wholesale. Skills belong to the
  conversation, one list per conversation: agent steps in one conversation that
  resolve to different `model`, `system` or `skills` fail the process. `agent()`
  takes no `skills` option — passing one is an error.
  `scope({ name, access }, fn)` declares the file access every agent turn inside
  `fn` runs with; see [File access](#file-access). `agent()` takes no `access`
  option either: narrower access for one step needs its own `scope()`.
- `refuse(message)` — refuse the pending landing: nothing lands, `gtd land`
  exits 1 with `message`, and the process stays where it rests. Call it right
  after a step whose turn left something the flow does not accept.

Plain TypeScript functions that await steps compose like any other code — this
is how a larger workflow is written.

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
- `judgeDiffShape(name, { changes, allow, exempt?, minP? })` — judges whether a
  change set's strays (every path matching no `allow` glob, same dialect and
  same list as `gtd strays`, and not in `exempt`) are incidental. `exempt` is a
  list of exact paths, compared by equality and never as globs, so an exempt
  path holding `*` covers nothing else. Resolves
  `{ choice, strays, unreadable, judgment }`; see [Judges](#judges)
- `wrote(path)` and `codeChanges()` — whether the last step wrote `path`, and
  its changes outside `.gtd/`

The `require*` checks refuse a turn from flow code, called right after the step
whose turn they check:

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

The script renderers (`checkScript`, `revertScript`, `applyScript`,
`restoreScript`, `removeScript`, `moveScript`, `showScript`, and `quote`) are
exported for a workflow's own `run` steps.
`applyScript(commit, report, failure, exclude?)` applies `commit`'s diff to the
working tree, leaving out each `exclude` path (literal, no globs) and everything
under it; one that no longer applies changes nothing and writes `failure` and
git's error to `report`, as `revertScript` does.

### Workflow factories

A workflow factory is a function that, called with options, returns a workflow
configured by them — `feature({ testCommand: "npm run ci" })`. Exported called
or uncalled (then with its default options), it is a workflow, and gtd
**validates the options when it loads the config**. A rejected option fails
every command, naming the workflow, the key and what was expected:

```text
gtd: config:
  - /repo/gtd.config.ts: testComand: workflow "default" option "testComand": is unexpected, expected: "reviewBase" | … | "coderModel"
```

Each option becomes that workflow's own default of its kind — beneath `--var`
and `GTD_<NAME>`, which still layer on top (see [Settings](#settings)).

Make a factory of your own with `defineWorkflow` from `@pmelab/gtd/flows`. Its
options schema is any [Standard Schema](https://standardschema.dev) — Effect
Schema, Zod, Valibot, ArkType — and should reject unknown keys; validation must
be synchronous. The build function gets the validated options and returns the
flow, plus the settings it declares:

```ts
import { defineWorkflow, human } from "@pmelab/gtd/flows"
import { z } from "zod"

export const greeter = defineWorkflow(
  z.strictObject({ greeting: z.string().optional() }),
  (options) => ({
    flow: async () => {
      await human("idle", { message: options.greeting ?? "hello" })
    },
  }),
)
```

The build may also return `doors`, keyed by door name, each a door without its
`workflow` (see [Doors](#doors)), and `base(workflow, vars)`, the workflow's
diff base. The config's own `base` export wins when it returns a value; on
`undefined` this one applies.

Read a setting through `vars`/`env` in flow code, as before, when `--var` or
`GTD_<NAME>` should reach it; an option read straight from `options` is fixed by
the config.

`--var`, `GTD_<NAME>` and the pinned value never pass through the schema, so a
schema that transforms (trims, lowercases) or constrains a setting does not bind
them. Keep the schema a plain check.

Awaiting a factory's call inside a composed flow throws — compose the plain
flows it is built from instead.

### Judges

`judge(name, { questions, evidence, message?, label? })` asks one or more
questions and resolves to `{ answers, truncated }`. A question is
`{ id, primitive, instructions, criteria }`, where `primitive` is `noul`
(yes/no, read back as `"yes"`/`"no"`), `choice`, or `score` (read back as its
decimal string). A `choice` or `score` question's `criteria` lists at least two
options as `label: description` — a label is a letter then letters, digits, `_`
or `-`, and starts the string or follows `. ` (a newline does not separate
options). `evidence` is what the judge sees as its `state`: an object of
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

`judgeDiffShape(name, { changes, allow, exempt?, minP? })` is a ready-made judge
for the shape of a diff, such as `kept(name).changes` or `changesSince(hash)`.
It asks one `choice` question, `shape`, and resolves to
`{ choice, strays, unreadable, judgment }`: `strays` is the sorted list of
changed paths no `allow` glob matches and no `exempt` path names, and `judgment`
is the whole `judge()` result (`judgment.truncated` included). The choice is one
of:

- `land` — every stray is incidental (a needed import, a test fixture, a renamed
  call site)
- `refactor-first` — the strays are a seam change the task needs; land them
  first as a behaviour-neutral refactor
- `reject` — the naive pass solved the task the wrong way; discard it and
  re-implement, no human. Strays a refactor could absorb never count as `reject`

With zero strays it resolves `land` without a judge step. A verdict below
`minP`, no verdict, or an answer that is none of the three labels resolves
`refactor-first`, and so does truncated evidence. A stray whose content cannot
be read (an `added` one without its after, a `modified` one missing either side,
a `deleted` one without its before) resolves `refactor-first` too, with no judge
step; a refactor cannot make such a stray readable, so route a non-empty
`unreadable` to a human instead of looping. `minP` defaults to the
`judgeShapeMinP` var the workflow declares, or `0.7` when it declares none. The
judge sees the strays, the allowlist, the paths inside it (paths only) and each
stray's content before and after.

`seamGate(name, shape)` takes a `judgeDiffShape` result and rests at an approval
gate `name` — `human(name, { approve: true })` — only when `shape.choice` is
`refactor-first`; `land` and `reject` reach no step, so nothing rests and
nothing is committed. The gate's `message` is a seam report: every stray in
order (an unreadable one suffixed ` (unreadable — not judged)`), then the
instruction that a clean `gtd land` approves and `gtd abandon` stops. Approving
is the only outcome, and the person cannot narrow the list of strays: a landing
with any edit is refused and the gate stays. The approval commit is
`gtd(human): <name> → <next>` with `Gtd-Approved:`. Commit hooks do not run on
it; commit signing (`commit.gpgSign`) still applies, so a failing signer refuses
the approval. Replay never asks again, and a second `refactor-first` rests at
the same name as occurrence `#2`.

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
  `acceptClean: true`, in which case the clean landing completes the gate. An
  `approve: true` gate (see [Step options](#step-options)) goes further: a clean
  landing completes it and records the git author identity it ran under as the
  approver, and a landing with any change is refused.
- **Run, nothing changed** — the step completes. If replaying that landing
  brings the flow straight back to the same step, the landing is a **settled**
  no-op (`gtd land --json`'s `settled: true`): there is nothing more a driver
  can do by running it again.
- **The flow calls `refuse(message)`** while replaying the pending turn — the
  landing is refused, `gtd land` exits 1, and nothing lands.

### Workflows

`gtd --workflow <name>` starts a process on the named workflow: a function the
config file exports. An unknown name is a usage error (exit 2) listing the
startable names. The name is recorded on the process's opening commit
(`Gtd-Workflow:`), so every later command replays that workflow, and a process
stays on it even if the config's `default` changes.

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

A `base` export that answers wins over a workflow factory's own base (see
[Workflow factories](#workflow-factories)); `undefined` falls through to it.

A blank `base` result means the repository's default branch. Any base is pinned
as its merge-base with `HEAD`, not as the named tip. It is refused when the
commitish does not resolve, shares no common ancestor with `HEAD`, or its
merge-base is `HEAD` itself (nothing to review). `--var <name>=<value>` is
repeatable and only valid with `--workflow`; the name must already be declared
by the workflow's `defaults` (or its factory's build) — `--var` pins process
settings only, and naming an environment setting is a usage error (exit 2).
Every process setting is recorded as a `Gtd-Var:` trailer on the process's first
commit and stays in force for the whole process (see [Settings](#settings)).

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

A [workflow factory](#workflow-factories) may build doors of its own, without a
`workflow` (it is whatever name the config exports it under) — gtd-workflows'
`fix` builds `fix`, its `review` builds `review [base]`. A config's doors are
those of every workflow it exports, plus its `doors` export, which wins a name
clash — a door several exported workflows build belongs to the one exported
under the door's own name (the others build none, whatever the order); when none
is, no workflow builds that door and loading warns (`gtd: warning: …` on every
command that loads the config) until the `doors` export declares it; a declared
door replaces the derived one whole, so it restates `args` and `vars` itself. A
config exporting only `fix` offers only the `fix` door.
`gtd door <name> [args...]` starts the process (printing the same script
`gtd --workflow` does); an unknown door or the wrong number of args is a usage
error (exit 2). `gtd doors` lists every door, one `name [args] → workflow` line
each; `gtd doors --json` prints them as data for a driver to offer.

### Episodes, replay and divergence

gtd keeps **no state outside git**. To find where a process rests, it
**replays** the flow over the current **episode**: the first-parent commits
since the episode began, each answering the step it names, until a step has no
commit left — that step is the rest. Replaying the same history always reaches
the same rest, which is why flow code has to be pure (below).

A `--workflow` episode begins with an opening commit whose `Gtd-Workflow:`
trailer names the workflow it replays. A default episode, started from `idle`,
has no opening commit and no `Gtd-Workflow:` trailer — its first commit is the
first step's own. An episode ends when its flow returns or calls `restart()`.
The next episode starts over at the `default` workflow's first step — `idle` in
the [Shape](#shape) example. Because entering that step is what marks an episode
finished, **no started workflow may land on a step of that name** — gtd refuses
the landing. Opening there is fine.

A process opened by the removed `gtd --entry` (an opening commit with no
`Gtd-Workflow:` trailer) is refused by every command but `gtd abandon`.

**There is no migration.** A process's commits are only meaningful to the
workflow that made them. If you change `gtd.config.ts` (or upgrade the workflow
it imports) while a process is underway and its history no longer replays to the
steps its commits name, gtd refuses loudly with a **divergence** error and tells
you to run `gtd abandon`. Finish or abandon an in-flight process before changing
the workflow under it.

A workflow whose first step reads a process or environment setting (enumerating
them included) fails to load: that step is where a finished process waits. A
setting name must match `[A-Za-z_][A-Za-z0-9_]*`; any other name in `defaults`,
`envDefaults` or `--var` fails to load or is refused.

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

### Config purity

`gtd.config.ts` and every module it imports are evaluated again on every gtd
command, and the workflows they build decide how the process's history replays.
Code that reads anything but its own source can replay the same history
differently on two machines, or on the same machine an hour later. So the whole
config — its top level, its imports, and the flows it exports — is pure:

- **No environment reads**: no `process.env`. A value that differs per machine
  is a setting: declare it in `envDefaults` and read it as `env`, which
  `GTD_<NAME>` overrides.
- **No clock**: no `Date.now()`, `new Date()`, timers or randomness.
- **No network**: no `fetch`, sockets or child processes.
- **No file reads beyond imports**: no `fs`; the repository's files reach a flow
  through the [helpers](#helpers).

A `run()` body is exempt — it runs once, and what it leaves is committed. gtd
does not detect an impure config.

What gtd does detect is a config that **changed** while a process runs. The
landing that starts a process records a `Gtd-Config: <hash> <path>` trailer for
`gtd.config.ts` and for every local TypeScript or JavaScript module it imports
(`.json` and `.cjs` imports are not recorded). Paths are relative to the
repository root, and JSON-quoted when they begin or end with whitespace; the
hash is the first 16 hex digits of the file's SHA-256. Every later command
compares those with the files on disk, and on a difference warns on stderr,
naming the changed files:

```
gtd: warning: the config changed since this process started (lib/flow.ts) — the rest of the process replays under the changed config
```

A file that matches its copy in the commit that started the process counts as
unchanged, so a pre-commit hook reformatting the config does not warn.

It is a warning, not an error: fixing a config mid-process is legitimate. It
repeats on every command until the process ends. A process started before
`Gtd-Config:` existed carries no trailer and is never warned about.

### Rules for flow code

Flow code is re-run on every gtd command, replaying the process's history, so it
must reach the same steps every time it sees the same history. A `run()` body is
exempt — it may do anything. Everything else follows
[Config purity](#config-purity).

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
`{ entryCommit, processBase, processTip, humanCommits, processCost, processCostByModel, marks, vars, env }`
and returning a string. `humanCommits` lists every human-authored commit of the
process as `{ hash, state }`; `marks` lists every `Gtd-Mark` of the process as
`{ name, value }`, oldest first. Without `summary`, `gtd summary` refuses.

Authoring a workflow with a coding agent? `skills/authoring/SKILL.md` is the
agent-facing guide.

## The `config` export

The repository settings a workflow does not own live in `gtd.config.ts`'s
reserved `config` export. Build it with `defineConfig` from `@pmelab/gtd/flows`:

```ts
import { defineConfig } from "@pmelab/gtd/flows"

export { default, summary, steering, skills } from "./workflow.ts"

export const config = defineConfig({
  modes: {
    qa: { format: 'npx prettier --write "$GTD_FILE"' },
    review: { format: 'npx prettier --write "$GTD_FILE"' },
  },
  ui: { port: 8443 },
})
```

It has exactly these keys, all optional:

- **`modes`** — steering-file modes (`format`/`validate` shell commands) a
  step's `mode` may name, layered over gtd's built-in `qa`, `review` and
  `findings` modes. See [Modes](#modes).
- **`ui`** — `gtd ui`'s own settings. See [`ui`](#ui).
- **`skills`** — a flat scope full-name -> skill-name array map, one entry per
  scope whose skill list you want to change. See [Skills](#skills).
- **`access`** — a flat scope full-name -> `{ read?, write? }` glob-array map.
  See [File access](#file-access).

**An unknown key is rejected**, at every depth: a type error when `@pmelab/gtd`
is installed for editor type-checking, and a load error naming the key either
way — `defineConfig` throws while `gtd.config.ts` loads, and gtd checks a plain
object exported as `config` the same way. A key that moved out of the repository
config (`vars`, `env`, `judge`) therefore fails loudly instead of doing nothing:

```text
gtd: config:
  - /repo/gtd.config.ts: config.env: is not a known key
```

Process and environment settings are not here: they are the workflow's, set as
[factory options](#workflow-factories) or a plain flow's
`defaults`/`envDefaults` (see [Settings](#settings)).

### Modes

A mode is a pair of shell commands over one steering file, both optional:

```ts
export const config = defineConfig({
  modes: {
    adr: {
      format: 'npx prettier --write "$GTD_FILE"',
      validate: 'adr-lint "$GTD_FILE"',
    },
  },
})
```

Each command runs in `bash` with `$GTD_FILE` set to the steering file's path.
Quote it (`"$GTD_FILE"`) so a path with spaces stays one argument. The
`<%= it.file %>` templates of earlier versions are refused with a hint to use
`$GTD_FILE` instead. `format:` normalizes the file in place; `validate:` reports
findings, and exits zero only when there are none. A step names a mode with
`{ file, mode }`. A mode with neither command still registers its name: a step
may use it, and the file is neither formatted nor validated.

#### Built-in steering formats are ordinary modes

`qa`, `review` and `findings` are gtd's built-in steering-file formats (parsed
and validated in-process, because `gtd lsp` needs the same parsers for live
diagnostics), but their `validate:` is not hidden: every workflow's modes are
seeded with `qa`/`review`/`findings` entries whose `validate:` is the command
`gtd check <mode> '<file>'`. That seeded command is overridable the same way —
declare `modes: { qa: { validate: "your-own-command" } }` and your command
displaces the seed; declaring only a `format:` for a built-in mode composes with
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
but a gate whose workflow calls `requireThreadsClosed` (see [Helpers](#helpers))
refuses every landing until you reply with a conclusion or delete it.
`gtd check <mode> <file> --open-threads` prints
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
  one, an open thread (agent spoke last) refuses landing where the workflow
  calls `requireThreadsClosed`, and the agent answers a question with exactly
  one `A:` line directly below, or folds a conclusion in and deletes the thread.
  A syntax fault (agent opens, same author twice, empty entry) refuses too
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

### `ui`

`config.ui` holds `gtd ui`'s five settings, all optional — a flat struct, so an
unknown sub-key is rejected the same way any other unknown config key is.
`gtd ui` serves exactly the ONE worktree it is invoked in — there is no
roots/discovery setting, because there is no fleet to discover:

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
  the bytes it already wrote stay on disk either way.

Flags (`--host`, `--port`, `--self-signed`) always override the matching `ui`
value; see `docs/cli.md`'s `ui` row for the full flag list.

### Skills

`config.skills` is a flat map, scope full name -> array of skill names. Skills
are declared per SCOPE (`scope({ name, skills }, …)`), not per step: every agent
turn in a scope carries that scope's list. An entry REPLACES the list the
workflow declares for that scope wholesale — it never merges into it — and also
feeds the `skills` key `gtd next --json` reports at each turn in that scope (see
[Writing your own driver](./driver.md#writing-your-own-driver)); `[]` means no
skills at all for that scope, and no skills preamble either.

```ts
export const config = defineConfig({
  skills: {
    "implement.fix.suite": ["debugging-and-error-recovery"],
    build: ["debugging-and-error-recovery", "my-org-runbook"],
  },
})
```

Which scope names exist is the workflow's: gtd-workflows' `default` lists its
own in its reference. A nested scope with no entry of its own inherits its
parent's list, so a key on a parent reaches every scope beneath it that sets
none. A scope that only groups others runs no turn and carries no key. A
workflow's scopes are addressable through its `skills` export (a config
re-exporting a workflow re-exports it too); the export may be a function of the
resolved vars, and must list every scope holding an agent step. The type can
check an entry's VALUE (an array of strings) but never its KEY, since scope
names come from the workflow actually in play — there is no editor
autocompletion of scope names here.

A key that is not a scope running a turn is a load error, exit 1 — a group
scope, or a step name rather than its scope. The message lists the known scope
keys. Keying config on a scope's full name widens what renaming a scope breaks:
it also orphans every `config.skills` entry naming it, which becomes an unknown
key and exits 1.

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

#### `config.access`

`config.access` is a flat scope full-name -> `{ read?, write? }` map, one entry
per scope whose access you want to change. An entry REPLACES the scope's
declared access wholesale and reaches every nested scope that sets none of its
own, like a `skills` entry.

```ts
export const config = defineConfig({
  access: {
    "build.review": { write: [".gtd/REVIEW.md", "docs/**"] },
    design: {}, // lift the workflow's restriction
  },
})
```

An entry key other than `read`/`write`, or a scope name that is not a scope
running a turn, is a load error, exit 1; the message lists the known scopes. A
custom workflow's own scopes are addressable through its `access` export (a
record, or a function of the resolved vars, of scope -> `{ read?, write? }`).
Precedence: `config.access` entry, then a `scope()` option, then the workflow's
`access` export.

### Validation and errors

Config problems — an unknown `config` key, a wrong type, a `gtd.config.ts` that
fails to evaluate or whose default entry reaches no step — are collected
together. A bad config fails **once**, listing every finding, at load time —
before anything touches the repository — never partially. Each line names the
file and the config path:

```
gtd: config:
  - /path/to/repo/gtd.config.ts: config.ui.port: must be an integer
```

A step naming a mode nothing declares fails the same way, as soon as the process
rests at it:

```
gtd: config: step "idle": mode "adrs" is not a mode this workflow knows (qa, review, findings)
```

A `config.skills` key that is not a scope running a turn fails the same way,
listing the known scope keys. It is reported when gtd resolves the current
state, not by every config read (see [Skills](#skills)):

```
gtd: config:
  - /path/to/repo/gtd.config.ts: config.skills.build.fix: "skills.build.fix" is not a scope that runs a turn — known scopes: build, build.fix.quality, …
```

A workflow declaring one name in both `defaults` and `envDefaults` fails to
load. All load failures exit **1** and write to **stderr**, never stdout.

gtd requires a repository with **at least one commit** before any state command
(`land`, `--workflow`, `door`, `doors`, `next`, `abandon`, `restore`,
`validate`, `summary`) will run — there is no workflow state to derive from an
empty history. `gtd install`, `gtd lsp`, and `gtd check` are unaffected, since
none of them needs a process history (`gtd lsp` then serves `REVIEW.md` alone).

## Judge settings

Which judge `gtd judge run` uses is your machine's choice, never a repository's:
both fields are optional — **`provider`** (`fixed`, `jev` or `llm`) and
**`model`** (the `claude` model, for provider `llm` only). Per field, the first
one set wins: the `--provider` / `--model` flag, then the `GTD_JUDGE_PROVIDER` /
`GTD_JUDGE_MODEL` environment variables (an empty value counts as unset), then
the user-level file, then the automatic pick (`jev` when `TYPESAFE_API_KEY` is
set and no model is given, otherwise `llm`). A model resolved for a provider
other than `llm` is an error, whichever layer supplied each half.
`gtd judge run` needs no repository.

The user-level file is `$XDG_CONFIG_HOME/gtd/judge.json`, else
`~/.config/gtd/judge.json`: a JSON object with the same two optional keys. A
missing file is fine; an unreadable or invalid one, an unknown key, or a
provider outside the three fails `gtd judge run`:

```json
{ "provider": "llm", "model": "sonnet" }
```

## Settings

A workflow's settings come in two kinds, told apart by what they may change.

- A **process setting** changes which step comes next — flow code branches on
  it, so every replay must see the same value. Flow code reads `vars`.
- An **environment setting** only changes how a step runs on this machine — the
  test command, a model hint — so it follows the machine, even mid-process. Flow
  code reads `env`.

A workflow declares process settings in `defaults` and environment settings in
`envDefaults` — a file's exports, or a [factory](#workflow-factories)'s build,
which may take each setting as an option; a name in both is a load error.

A setting name is a letter or `_`, then letters, digits or `_`
(`[A-Za-z_][A-Za-z0-9_]*`), in `defaults`, `envDefaults` and `--var`: any other
name fails the load, or is refused as a usage error for `--var`. The flow's
first step — where a finished process waits — may not read a setting at all,
process or environment (any `vars`/`env` access, enumeration included); such a
workflow fails the load, naming the setting.

**A process setting's value is committed to Git history in its `Gtd-Var:`
trailer and stays there. A secret belongs in an environment setting
(`envDefaults`, or `GTD_<NAME>` for an `env` name), which is never recorded.** A
`GTD_<NAME>` export of a process setting is recorded too.

**Process settings** are resolved once, at process start, from three layers,
**later wins**, and recorded as sorted `Gtd-Var:` trailers on the process's
first commit:

1. **The workflow's `defaults`** — per repository, in `gtd.config.ts` (for a
   factory, an option). A `flag_<name>` setting it declares is a release flag of
   its own: `GTD_FLAG_<NAME>` pins it here (see
   [Feature flags](#feature-flags)).
2. **`--var <name>=<value>`** on `gtd --workflow <name>`. Each name must already
   be declared by layer 1; an undeclared name is refused (exit 1), and naming an
   environment setting is a usage error (exit 2). A `flag_*` value must be `1`,
   `0`, `true` or `false`, and is recorded as `1` or `0`.
3. **`GTD_<UPPERCASE-name>` environment variables** — matched case-insensitively
   against the names layer 1 declares: `GTD_TESTRETRIES` overrides
   `testRetries`. A `GTD_*` variable matching no declared name is ignored. A
   setting named `flag_*` (any case) takes no `GTD_<NAME>` override:
   `GTD_FLAG_*` belongs to [feature flags](#feature-flags).

Every later `gtd` call reads the recorded values and never the live layers, so
**editing `gtd.config.ts` or exporting `GTD_<NAME>` for a process setting
mid-process is ignored, silently, for the running process**; the new value
applies from the next process on. A process recorded before settings were pinned
resolves live. A value spanning several lines cannot be recorded and refuses the
process start, naming the setting.

**Environment settings** are resolved on every call, never recorded, from two
layers, later wins: the workflow's `envDefaults` and `GTD_<UPPERCASE-name>`
environment variables for any name it declares, except a `flag_*` name, which
takes no override, as above. A process started on a laptop and continued in CI
uses CI's test command.

Every setting value is a string. A `--var` value is always a single-line string
as given on the command line. gtd itself blesses no setting names, except that a
`flag_*` name takes no env override — a test command is a workflow's data like
any other.

## Feature flags

A feature flag is an environment variable, `GTD_FLAG_<NAME>`, one per feature
flag: `GTD_FLAG_FOO` for a feature flag `foo`. gtd documents the mechanism, not
a list of feature flags; gtd itself currently declares none.

- `1`, `true`, `0` and `false` are accepted, case-insensitively. Unset or empty
  is off, unless the flag is on by default — then it is on, and `0` or `false`
  is the kill switch that turns it off.
- A garbled value for a known feature flag exits `1` with a stderr line naming
  the variable.
- A `GTD_FLAG_*` variable naming no known feature flag is ignored.
- gtd's own feature flags are read live on every call, unlike a process setting:
  changing one mid-process applies to the rest of that process.
- Feature flags are in the [No promise](../COMPATIBILITY.md#no-promise) tier:
  any feature flag may appear, flip or vanish in any release.

**A workflow may own release flags.** A `flag_<name>` process setting the
workflow declares in `defaults` (default `"0"` for off) is pinned when a process
starts: `GTD_FLAG_<NAME>` set to `1`/`true` records `1`, `0`/`false` records
`0`, unset or empty keeps the declared default, and any other value refuses the
start, naming the variable. `--var flag_<name>=…` overrides it and takes the
same four values; `GTD_<NAME>` never does. The value is recorded like any
process setting, so flipping the variable mid-process never moves a running
process — branch on `vars.flag_<name>`, never on the live environment.

## Migrating from `.gtdrc`

gtd 23 no longer reads the `.gtdrc` family — `.gtdrc`, `.gtdrc.json`,
`.gtdrc.yaml`, `.gtdrc.yml`, `gtd.config.json` and `gtd.config.yaml`. Every
command that loads the config refuses one, wherever it sits: in the repository,
in a directory above it, or in your home directory (`~/.gtdrc.json` included — a
user-level rc file holding only `$schema` still fails). The message names each
file and exits **1**. Move each key, then delete the file:

| `.gtdrc` key | Where it goes now                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vars`       | A [factory option](#workflow-factories) in `gtd.config.ts` (`feature({ qualityReviews: "correctness" })`), or a plain flow's `defaults` export      |
| `env`        | A factory option in `gtd.config.ts` (`feature({ testCommand: "npm run ci" })`), or `envDefaults`; per machine, `GTD_<NAME>`                         |
| `judge`      | `~/.config/gtd/judge.json` (`$XDG_CONFIG_HOME/gtd/judge.json`), or `GTD_JUDGE_PROVIDER` / `GTD_JUDGE_MODEL` — see [Judge settings](#judge-settings) |
| `modes`      | `config.modes` — see [Modes](#modes)                                                                                                                |
| `ui`         | `config.ui` — see [`ui`](#ui); `--host`/`--port` still override it per run                                                                          |
| `skills`     | `config.skills` — see [Skills](#skills)                                                                                                             |
| `access`     | `config.access` — see [File access](#file-access)                                                                                                   |
| `$schema`    | Nothing: drop it. gtd no longer publishes `schema.json`; `defineConfig` types the config instead                                                    |

A `.gtdrc` in a directory above several checkouts (a worktree parent) has no
counterpart: each repository's `gtd.config.ts` carries its own settings, and
machine-wide ones go in `GTD_<NAME>` or `judge.json`. `$NAME` interpolation is
gone too — declare a per-machine value in `envDefaults` and override it with
`GTD_<NAME>` (see [Config purity](#config-purity)). `gtd init`, which only wrote
a `.gtdrc.json`, is removed; see [Lookup](#lookup) for where a `gtd.config.ts`
comes from.
