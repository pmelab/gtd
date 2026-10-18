# Configuration reference

A repository's configuration is one file, **`gtd.config.ts`**: a TypeScript
module that says which steps a process goes through, with which settings, plus
the repository settings in its [`config` export](#the-config-export) —
steering-file modes, `gtd ui` settings, per-scope skills and access. It is
required: without one, every command that resolves workflow state fails, saying
to run `gtd install`, which scaffolds one running gtd's shipped workflows.

Settings that belong to a machine rather than a repository live outside it: the
judge `gtd judge run` uses (see [Judge settings](#judge-settings)) and the
loop's (see [the CLI reference](./cli.md)), plus `GTD_<NAME>` variables (see
[Settings](#settings)). The `.gtdrc` files earlier versions read are gone — a
leftover one is an error (see [Migrating from `.gtdrc`](#migrating-from-gtdrc)).

> **Trust: `gtd.config.ts` is code, and gtd runs it.** Because the workflow is a
> TypeScript module, every gtd command that resolves workflow state evaluates
> the repository's `gtd.config.ts` — including the read-only ones: `gtd next`,
> `gtd lsp`, `gtd validate`, `gtd judge`, `gtd door` and `gtd doors`, not only
> `gtd land`. Nothing else is evaluated: every workflow lives in this one file
> and what it imports. The lookup walks up from the current directory, so a
> `gtd.config.ts` in a parent directory counts too. Treat a repository's
> `gtd.config.ts` like any other code you run from it — a Makefile, a
> `package.json` script: **do not run gtd in a checkout you do not trust.**
> Settings end up on command lines too (`testCommand` is interpolated into the
> scripts gtd emits), which is the same trust decision.

## `gtd.config.ts`

### Lookup

gtd walks from the current directory **up to your home directory** (or to the
filesystem root when the current directory is outside home) and uses the
**innermost** `gtd.config.ts` it finds. There is no merging: one file is the
whole workflow. A `gtd.config.ts` found nowhere is an error naming
`gtd install`.

`gtd install`, run at a repository root no `gtd.config.ts` governs yet, writes
one that re-exports gtd's shipped workflows, each from its own subpath:

```ts
export {
  feature as default,
  feature,
  defaults,
  envDefaults,
  summary,
  steering,
  skills,
  access,
} from "@pmelab/gtd/workflows/feature"
export { review } from "@pmelab/gtd/workflows/review"
export { fix } from "@pmelab/gtd/workflows/fix"
```

**Upgrading from a gtd that ran its workflows without a `gtd.config.ts`:** run
`gtd install` and commit the file. A process already underway continues: it
replays on the same names (`feature` as the default, `fix`, `review`). A config
of your own that relied on the shipped `feature`, `fix` or `review` being
startable beside it, or on their doors, now exports them itself (see
[Reusing the shipped workflows](#reusing-the-shipped-workflows)); one with no
`default` export needs one.

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
ordinary start is where a finished process waits (the bundled workflow calls it
`idle`). A flow takes no arguments; which workflow runs is decided by name. The
reserved exports are optional and per **file**, shared by every workflow the
file exports: `defaults` and `envDefaults` (the file's process and environment
settings, see [Settings](#settings)), `summary` (the prompt `gtd summary`
prints, see [Summary](#summary)), `base` (see [Workflows](#workflows)),
`steering` — steering file paths with their mode, e.g.
`{ ".gtd/docs/adr.md": "adr" }` — `skills`, `doors` (see [Doors](#doors)) and
`config` (see [The `config` export](#the-config-export)). gtd ignores every
other non-function export. **A helper you export is a workflow too**, startable
by name — keep helpers un-exported, or export them from another module you
import.

gtd resolves every `@pmelab/gtd/*` subpath but `@pmelab/gtd/testkit` itself (see
[Entrypoints](https://github.com/pmelab/gtd/blob/main/README.md#entrypoints)),
to its own copy, so a repository — JavaScript or not (Python, Rust, notes) —
needs no `package.json`, `node_modules` or install: a root `gtd.config.ts` is
all it takes. The workflows a config imports are always the running gtd's, so
pinning the gtd version pins them. Add `@pmelab/gtd` as a dev dependency only if
you want editor type-checking for it.

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
| `mode`        | all, requires `file` | The steering file's mode: `qa`, `review`, or a name declared in `config.modes`. An unknown name is a load error.                                                                                                                                                                                                                                                                                                                                                                                              |
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
- `slice(name, fn)` — marks the span `fn` covers as one named **slice** of the
  episode. For now it only names the span: it changes nothing about how the
  episode lands, and `gtd slices` lists the spans (`--json` is the contract a
  driver reads; it refuses, exit 1, when HEAD neither closes nor sits inside a
  process or today's config disagrees with history about the process). It lands
  no commit, renames no step and opens no memory scope — it is not a `scope()`;
  wrap one in the other when you want both. A slice's commits run from where the
  previous slice ended: commits before the first slice fold into it, commits
  between two slices into the next, commits after the last into the last. A
  slice that landed no commit is dropped, its neighbours absorbing the gap. A
  flow with no surviving slice has one implicit slice named `main` over the
  whole episode, so `main` is reserved. Names match `/^[a-z][a-z0-9-]*$/` and
  are unique within an episode: entering one twice, nesting a `slice()` inside
  another (even through a `scope()`), or breaking the name rule fails the
  episode naming the slice. A loop must sit inside its slice. `restart()` starts
  a new episode with its own base, so the next one may reuse the names and its
  slices never include the earlier episode's commits.
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
- `judgeDiffShape(name, { changes, allow, exempt?, minP? })` — judges whether a
  change set's strays (every path matching no `allow` glob, same dialect and
  same list as `gtd strays`, and not in `exempt`) are incidental. `exempt` is a
  list of exact paths, compared by equality and never as globs, so an exempt
  path holding `*` covers nothing else. Resolves
  `{ choice, strays, unreadable, judgment }`; see [Judges](#judges)
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
`removeScript`, `moveScript`, `showScript`, and `quote`) are exported for a
workflow's own `run` steps.

### Reusing the shipped workflows

`@pmelab/gtd/workflows` is gtd's shipped workflows (`@pmelab/gtd/workflow` still
resolves to the same module). Each also has its own subpath —
`@pmelab/gtd/workflows/feature`, `…/review` and `…/fix` — exporting its factory
as the default, its own parts and the reserved exports (`defaults`,
`envDefaults`, `summary`, `steering`, `skills`, `access`). The aggregate's
default export is the `feature` factory, and every part of it is a named export
another workflow can import — its `defaults`, `envDefaults`, `summary` and
`skills`, the three startable workflows as [factories](#workflow-factories)
(`feature`, `review`, `fix`) and as plain flows (`ordinaryStart`, `reviewFlow`,
`fixFlow`), the phases (`unwind`, `planAndBuild`, `design`, `architecture`,
`packages`, `refactorFirst`, `buildTail`, `handOffTail`, `handOffReview`,
`fixReviewNotes`, `qualityLap`, `healthy`, `gate`, …) and every single step
(`triage`, `build`, `fixCheck`, `reviewing`, `collecting`, …). A step's name is
relative to the `scope()` it runs in — the bundled workflow's
`scope("build", …)` around `healthy` is what makes `build.health.check` — and
the full names are part of gtd's versioned API: they never change outside a
major release, because a rename strands every process resting on the old name.

Re-export `envDefaults` alongside `defaults`: a workflow that re-exports only
`defaults` loses `testCommand`, `plannerModel` and `coderModel`. Re-export
`skills` alongside `steering`: it is what makes the bundled workflow's scope
names addressable by a `config.skills` entry in THIS config (see
[Skills](#skills)) — dropping it from the re-export list, the way dropping any
other named export does, silently empties it instead of keeping the bundled
defaults, because the loader reads a missing export as `{}`, not as "inherit the
bundled module's".

**Import the phases; never `export *` them.** Every exported function of your
file is a startable workflow, so `export * from "@pmelab/gtd/workflows"` would
turn each phase and step into one — `gtd --workflow buildTail` would start a
half-flow and strand the process. Re-export the reserved names and the workflows
you want startable by name, and write each other workflow you want as your own
function:

```ts
import { start } from "@pmelab/gtd/flows"
import { afterTail, buildTail, feature } from "@pmelab/gtd/workflows"

export {
  defaults,
  envDefaults,
  summary,
  steering,
  skills,
} from "@pmelab/gtd/workflows"

export default feature

export async function hotfix() {
  return afterTail(await buildTail(true, start()))
}

export const doors = { hotfix: { workflow: "hotfix" } }
```

A config's doors are those its workflows bring plus its `doors` export: export
`fix` and `review` to keep their doors (see [Doors](#doors)).

### Workflow factories

`feature`, `review` and `fix` are factories: calling one with options returns
that workflow configured. Their options are the
[bundled workflow's settings](#the-bundled-workflows-settings), each a string,
and each becomes that workflow's own default of its kind — beneath `--var` and
`GTD_<NAME>`, which still layer on top:

```ts
import { feature, review } from "@pmelab/gtd/workflows"

export { summary, steering, skills, access } from "@pmelab/gtd/workflows"

export default feature({ testCommand: "npm run test:ci", coderModel: "fast" })
export const quickReview = review({ qualityReviews: "correctness" })
```

Exported without a call, a factory is a workflow too, with its default options —
which is what the config `gtd install` writes does. Either way gtd **validates
the options when it loads the config**. A rejected option fails every command:

```text
gtd config:
  - /repo/gtd.config.ts: testComand: workflow "default" option "testComand": is unexpected, expected: "reviewBase" | … | "coderModel"
```

Unknown options are rejected, not dropped, so a misspelled or removed option
fails the load — and, typed, fails `tsc` too, when `@pmelab/gtd` is installed
for editor type-checking.

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

Awaiting a factory's call inside a composed flow throws — compose `fixFlow`,
`reviewFlow` and the other plain flows instead.

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

`judgeDiffShape(name, { changes, allow, exempt?, minP? })` is a ready-made judge
for the shape of a diff, such as `kept(name).changes` or `changesSince(hash)`.
It asks one `choice` question, `shape`, and resolves to
`{ choice, strays, judgment }`: `strays` is the sorted list of changed paths no
`allow` glob matches and no `exempt` path names, and `judgment` is the whole
`judge()` result (`judgment.truncated` included). The choice is one of:

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

### `refactorFirst`

`refactorFirst(shape, { reference? })` turns a `judgeDiffShape` result into a
behaviour-neutral refactor of exactly its `strays`, and resolves `true` once the
refactor has closed. It resolves `false`, running no step, unless `shape.choice`
is `refactor-first` and `shape.unreadable` is empty — a stray whose content
cannot be read goes to a human instead. `reference` is the naive pass's kept tip
(`kept(name)?.hash`; blank counts as none): the building prompt names
`git show <reference> -- <strays>` as reading material only and forbids applying
it; omitted, it carries no reference line.

It runs inside the scope `refactor`, whose write access is the strays plus
`.gtd/**`, in these steps: `refactor.deriving` (writes `.gtd/REFACTOR.md`, a
file a person can read and edit), `refactor.building`, the shared health loop
(`refactor.health.check`, `refactor.health.judge`, `refactor.health.describe`,
`refactor.health.stop`, `refactor.health.exhausted`) with
`refactor.fix.suite.fixing`, and `refactor.closing`, which removes only the
package file. A red suite goes to the fix loop, never to a refusal.

The package file's `## Scope (read-only)` list is for reading: the guards use
the strays as fixed when the package was derived, so editing the list widens or
narrows nothing. After the building turn, after every fix turn and after the
escalation describe turn (`refactor.health.describe`), `gtd land` refuses the
turn when:

- it changed a path outside `.gtd/` that is not exactly one of the strays (a fix
  turn is judged on its own changes, so a person's edit at an escalation stop
  does not block it; no globs: a stray `src/*.ts` does not admit `src/a.ts`), or
- it raised the number of reads of any one flag, or added a flag, across the
  changed files outside `.gtd/`. A flag is a match of the `refactorFlagPattern`
  setting; moving a read passes, and so does a swap that leaves every per-name
  count flat. A changed file whose before or after cannot be read refuses.

The human rests `refactor.health.stop` and `refactor.health.exhausted` are never
guarded: a person's edit there is not refused. The flag count, though, spans
every turn since the build: a flag read a person adds there refuses the next fix
turn until it is removed, and that turn may not touch the file to remove it. Put
no flag read in a person's edit at these rests.

A blank or invalid `refactorFlagPattern` throws before the first step, naming
the setting. A pattern that produces a zero-length match (a lookahead-only
pattern such as `(?=GTD_FLAG_\w+)`) on a stray throws before the first step, and
on text a turn introduces refuses the landing, naming the setting. The shipped
`feature` flow runs `refactorFirst` only on the
[naive-pass path](#the-naive-pass-path); call it from your own workflow after
`judgeDiffShape`, with a suite that is already green: the fix turns may touch
only the strays, so they cannot repair a failure outside them.

### The naive-pass path

`GTD_FLAG_NAIVE_PASS` selects it; it is off by default. Off, `feature` plans an
architecture and package files as before. On, it replaces those two phases with,
in order:

1. `seam.naive` — an agent implements `.gtd/REQUIREMENTS.md` directly; the turn
   is a [kept tip](#kept-tips), not landed on the branch.
2. `seam.judge` — a judge rules on the shape of that diff (see
   [Judges](#judges)): `land`, `refactor-first` or `reject`.
3. `land` goes straight to `implement.*`. `refactor-first` rests at
   `seam.approve`, an approval gate, then runs `refactor.*` (see
   [`refactorFirst`](#refactorfirst)). Strays whose content cannot be read rest
   at `seam.by-hand`; a clean `gtd land` continues. `reject` discards the pass
   and runs `seam.naive` again, twice at most.
4. `implement.*` — one build turn that reads the kept pass as material only,
   then the health loop (`implement.health.*`, `implement.fix.suite.fixing`) and
   `implement.closing`, which removes `.gtd/REQUIREMENTS.md`. The turn is asked
   for a new release flag.

With `GTD_FLAG_RISK_TIER` also on, `design.triage` proposes a risk tier (`low`
or `high`, with a one-line reason) under `## Risk Tier` and the signals to watch
after merge under `## Production Signals` in `.gtd/REQUIREMENTS.md`. Edit the
first word under `## Risk Tier` at `design.gate.answer` to change the tier; a
missing or unreadable tier means `high`. The design gate's landing records
`Gtd-Mark: risk-tier=<low|high>` and one `Gtd-Mark: production-signal=…` per
signal; no step is added.

A third `reject` rests at `seam.steer`. Two ways forward, then `gtd land`:

- **Steer** — edit `.gtd/REQUIREMENTS.md`; `seam.naive` runs again with a fresh
  retry budget. An edit together with an approval counts as steer.
- **Overrule** — land a clean tree. The implementation is built against the last
  attempt with no seam gate and no refactor. **Overrule ships the seam the judge
  objected to**, unaddressed; the choice is recorded in history.

The [`seamAllow`](#the-bundled-workflows-settings) setting is the judge's
allowlist. The flag is recorded as `flag_naive_pass` when a process starts, so a
process keeps the path it started on whatever the environment does later.

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

A `base` export that answers wins over a workflow factory's own base (the
shipped `review` takes `reviewBase`); `undefined` falls through to it.

A blank `base` result means the repository's default branch. Any base is pinned
as its merge-base with `HEAD`, not as the named tip. It is refused when the
commitish does not resolve, shares no common ancestor with `HEAD`, or its
merge-base is `HEAD` itself (nothing to review). `--var <name>=<value>` is
repeatable and only valid with `--workflow`; the name must already be declared
by the workflow's `defaults` (or its factory's build) — `--var` pins process
settings only, and naming an environment setting is a usage error (exit 2).
Every process setting is recorded as a `Gtd-Var:` trailer on the process's first
commit and stays in force for the whole process (see [Settings](#settings)).

The shipped module offers three workflows:

- **`feature`** — the ordinary start, and its `default`: plan, build, then a
  human review whose notes are triaged and, for an edit, re-planned.
- **`review`** — a pure review of everything since
  `--var reviewBase=<commitish>`: a green gate, the quality lap, then the human
  review. A sign-off closes `.gtd/REVIEW.md`. A note ends the process with
  `.gtd/REVIEW.md` kept and the reviewer's own version copied beside it as
  `.gtd/REVIEW.orig.md` (`build.review.handing-off`); nothing is triaged or
  re-planned. Until `fix` runs, starting `feature` or `review` is refused;
  remove both review files to abandon the hand-off. `fix` refuses a lone
  `.gtd/REVIEW.orig.md`.
- **`fix`** — with a handed-off `.gtd/REVIEW.md` in the tree, one turn fixes
  every note (read from the two review files) and every `Risk:`
  (`notes.fixing`), both files are removed (`notes.closing`), and the result
  goes through the build tail to its own hand-off review. With none, it repairs
  a red baseline (`fix-precheck`) through the same tail. A note at its review is
  handed to the next `fix`, never re-planned.

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

A [workflow factory](#workflow-factories) may build doors of its own, without a
`workflow` (it is whatever name the config exports it under): gtd's `fix` builds
`fix`, its `review` builds `review [base]`, its `rollout` builds
`rollout <flag>`, its `cleanup` builds `cleanup <flag>`. A config's doors are
those of every workflow it exports, plus its `doors` export, which wins a name
clash — a door several exported workflows build belongs to the one exported
under the door's own name (the others build none, whatever the order); when none
is, no workflow builds that door and loading warns (`gtd: warning: …` on every
command that loads the config) until the `doors` export declares it; a declared
door replaces the derived one whole, so it restates `args` and `vars` itself. A
config exporting only `fix` offers only the `fix` door. The shipped module's own
`doors` export is an empty no-op, and its `base` export maps `reviewBase` for a
workflow named `review`; both are kept only so an older config re-exporting them
still loads. `gtd door <name> [args...]` starts the process (printing the same
script `gtd --workflow` does); an unknown door or the wrong number of args is a
usage error (exit 2). `gtd doors` lists every door, one `name [args] → workflow`
line each; `gtd doors --json` prints them as data for a driver to offer.

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
defaults/envDefaults or --var — fails to load or is refused.

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
- **Await only steps**: a flow may `await` a step, `scope()`, `slice()`, or a
  function that itself awaits steps. Awaiting anything else fails the replay:
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
(plus `slice` under `--slice`, below) and returning a string. `humanCommits`
lists every human-authored commit of the process as `{ hash, state }`; `marks`
lists every `Gtd-Mark` of the process as `{ name, value }`, oldest first.
Without `summary`, `gtd summary` refuses.

`gtd summary --slice <name>` calls it once for one slice (names and order as
`gtd slices` lists them) with an extra `slice` field,
`{ name, base, tip, index, count }`. `index` is 1-based, so `index === count` is
the last slice. On plain `gtd summary` the `slice` key is absent. Under
`--slice`, `processBase`, `processTip`, `humanCommits`, `processCost` and
`processCostByModel` narrow to the slice (`base` exclusive, `tip` inclusive; the
per-slice costs sum to the plain cost), while `entryCommit` and `marks` stay
whole-process. A template that says "the process" mislabels a slice unless it
reads `slice`. `--slice` replays the process, so it also refuses a HEAD-closing
process whose config files differ from the working tree or whose replay
diverged; plain `gtd summary` never does. On a process still underway the last
slice is open: its range, `count` and the production signals are provisional,
since later commits fold into it and `count` grows as slices land.

Authoring a workflow with a coding agent? `skills/authoring/SKILL.md` is the
agent-facing guide.

## The `config` export

The repository settings a workflow does not own live in `gtd.config.ts`'s
reserved `config` export. Build it with `defineConfig` from `@pmelab/gtd/flows`:

```ts
import { defineConfig } from "@pmelab/gtd/flows"

export { feature as default, feature, review, fix } from "@pmelab/gtd/workflows"
export { summary, steering, skills, access } from "@pmelab/gtd/workflows"

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
  step's `mode` may name, layered over gtd's built-in `qa` and `review` modes.
  See [Modes](#modes).
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
gtd config:
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
turn in a scope carries that scope's list. An entry REPLACES the scope's bundled
(or custom-workflow-declared) list wholesale — it never merges into it — and
also feeds the `skills` key `gtd next --json` reports at each turn in that scope
(see [Writing your own driver](./driver.md#writing-your-own-driver)); `[]` means
no skills at all for that scope, and no skills preamble either.

```ts
export const config = defineConfig({
  skills: {
    "packages.item.fix.suite": ["debugging-and-error-recovery"],
    build: ["debugging-and-error-recovery", "my-org-runbook"],
  },
})
```

The bundled workflow's addressable scope full names:

`design`, `architecture`, `architecture.decompose`, `packages.item`,
`packages.item.fix.suite`, `packages.item.health`, `refactor`,
`refactor.fix.suite`, `refactor.health`, `build`, `build.health`,
`build.fix.quality`, `build.review`, `build.review.fix.nits`,
`build.review.fix.risks`, and one `build.quality.<lens>` per `qualityReviews`
entry. `seam`, `implement`, `implement.fix.suite` and `implement.health` run
only under the `naive_pass` release flag; they are addressable either way, so a
config keyed on them keeps loading when the flag is off.

A nested scope with no entry of its own inherits its parent's list, so a key on
a parent reaches every scope beneath it that sets none. The group scopes
`packages.item.fix`, `build.fix`, `build.review.fix`, `build.quality` and
`refactor.fix` and `implement.fix` run no turn and carry no key, nor do
`seam.judge`, `seam.approve`, `seam.steer` and `seam.by-hand`. A custom
workflow's own scopes are addressable through its own `skills` export (see
[Reusing the shipped workflows](#reusing-the-shipped-workflows)); the export may
be a function of the resolved vars, and must list every scope holding an agent
step. The type can check an entry's VALUE (an array of strings) but never its
KEY, since scope names come from the workflow actually in play — there is no
editor autocompletion of scope names here.

A key that is not a scope running a turn is a load error, exit 1 — a group scope
such as `build.fix`, or a step name rather than its scope. The `naive_pass`
scopes (`seam`, `implement`, `implement.fix.suite`, `implement.health`) are
always accepted, flag on or off. The message lists the known scope keys. Keying
config on a scope's full name widens what renaming a scope breaks: it also
orphans every `config.skills` entry naming it, which becomes an unknown key and
exits 1.

`qualityReviews` (a process setting, not a `skills` entry — see
[Settings](#settings)) and the `build.quality.<lens>` keys are a pair:
`qualityReviews` decides how many quality-lap turns run, one per lens, and each
lens is its own scope, keyed `build.quality.<lens>`. By default that scope's
skills ARE the lens; a `build.quality.<lens>` entry REPLACES them with the
configured list, leaving the prompt body's own mention of the lens untouched.
Such a key is valid only while the lens is listed in `qualityReviews`, judged
against the running process's recorded settings, or against the workflow's
settings, `GTD_<NAME>` and `--var` when no process is underway. A key added for
a lens mid-process errors until that process finishes.

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
    design: {}, // lift the bundled restriction
  },
})
```

An entry key other than `read`/`write`, or a scope name that is not a scope
running a turn, is a load error, exit 1; the message lists the known scopes. A
custom workflow's own scopes are addressable through its `access` export (a
record, or a function of the resolved vars, of scope -> `{ read?, write? }`).
Precedence: `config.access` entry, then a `scope()` option, then the workflow's
`access` export.

#### Bundled defaults

Only planning and review scopes are restricted, and only on writes; no bundled
scope restricts reads. Build and fix scopes carry no entry, except `refactor`:
`refactorFirst` restricts its writes to the strays and `.gtd/**` itself, and a
`config.access.refactor` entry replaces that wholesale.

| Scope                                             | `write`                                    |
| ------------------------------------------------- | ------------------------------------------ |
| `design`                                          | `[]`                                       |
| `architecture`                                    | `.gtd/REQUIREMENTS.md`                     |
| `architecture.decompose`                          | `.gtd/packages/**`, `.gtd/ARCHITECTURE.md` |
| `build.review`                                    | `.gtd/REVIEW.md`                           |
| `build.review.defer`                              | `.gtd/TODO.md`                             |
| `build.review.fix.nits`, `build.review.fix.risks` | `{}` (reopened: fixes edit code)           |
| `build.quality.<lens>`                            | `[]`                                       |

### Validation and errors

Config problems — an unknown `config` key, a wrong type, a `gtd.config.ts` that
fails to evaluate or whose default entry reaches no step — are collected
together. A bad config fails **once**, listing every finding, at load time —
before anything touches the repository — never partially. Each line names the
file and the config path:

```
gtd config:
  - /path/to/repo/gtd.config.ts: config.ui.port: must be an integer
```

A step naming a mode nothing declares fails the same way, as soon as the process
rests at it:

```
gtd config: step "idle": mode "adrs" is not a mode this workflow knows (qa, review)
```

A `config.skills` key that is not a scope running a turn fails the same way,
listing the known scope keys. It is reported when gtd resolves the current
state, not by every config read (see [Skills](#skills)):

```
gtd config:
  - /path/to/repo/gtd.config.ts: config.skills.build.fix: "skills.build.fix" is not a scope that runs a turn — known scopes: architecture, architecture.decompose, build, …
```

A workflow declaring one name in both `defaults` and `envDefaults` fails to
load. All load failures exit **1** and write to **stderr**, never stdout.

gtd requires a repository with **at least one commit** before any state command
(`land`, `--workflow`, `door`, `doors`, `slices`, `next`, `abandon`, `restore`,
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
where the shipped workflows take each setting as an option; a name in both is a
load error.

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

1. **The workflow's `defaults`** — per repository, in `gtd.config.ts` (for the
   shipped workflows, a factory option).
2. **`--var <name>=<value>`** on `gtd --workflow <name>`. Each name must already
   be declared by layer 1; an undeclared name is refused (exit 1), and naming an
   environment setting is a usage error (exit 2).
3. **`GTD_<UPPERCASE-name>` environment variables** — matched case-insensitively
   against the names layer 1 declares: `GTD_QUALITYREVIEWS` overrides
   `qualityReviews`. A `GTD_*` variable matching no declared name is ignored. A
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
`flag_*` name takes no env override — `testCommand` is the bundled workflow's
data like any other.

```ts
// gtd.config.ts — overriding the bundled workflow's testCommand
import { feature } from "@pmelab/gtd/workflows"

export default feature({ testCommand: "npm run test:ci" })
```

```bash
# highest precedence — beats the workflow's own value above
GTD_TESTCOMMAND="npm run test -- --bail" gtd next
```

The bundled workflow puts a preamble naming the skills an agent step loads (its
scope's `config.skills` entry — see [Skills](#skills)) ahead of that step's
prompt; an empty entry switches it off for that scope. A preamble in a workflow
of your own must carry three clauses, or it is unsafe: load only what your
harness has and skip the rest silently; THE STEP'S OWN FILE FORMAT AND
COMPLETION CONDITION OUTRANK ANYTHING A SKILL SAYS; never turn the turn
interactive, because no one is at a keyboard. The precedence clause is
load-bearing — the preamble sits above the step's own format prose, so a skill
that reflows the steering file changes which branch the flow takes next.

### The bundled workflow's settings

Overridable as [factory options](#workflow-factories) or through `GTD_<NAME>`.
**Environment settings:**

- **`testCommand`** (`npm test`) — the suite every health check and baseline
  gate runs. It is interpolated into a POSIX `sh` script, so keep it
  sh-compatible.
- **`plannerModel`** (`smart`) / **`coderModel`** (`base`) — the `model` hints
  of the planning/reviewing steps and of the building/fixing steps.

**Process settings:**

- **`judgeIdenticalMinP`** (`0.7`) — the confidence an "identical failure"
  verdict at `health.judge` needs before a red streak escalates early. Blank,
  non-numeric or non-finite means it can never be cleared, so the early
  escalation is off.
- **`reviewNoteActionable`** (`0.7`) — `feature`'s `build.review.triage` floor a
  non-`edit` verdict (`question`, `nit`, `praise`) on a review note must clear.
  Below it, the note counts as `edit` and goes to `build.review.collecting` and
  a replan. A note whose evidence was cut, or that got no verdict, also counts
  as `edit`. Blank makes every note `edit`. Triage answers are keyed `note-<n>`.
- **`reviewSeverityMinP`** (`0.7`) — the confidence each severity judge answer
  on a review note must clear. Every tiered note gets a `critical`, `should` or
  `could` tier from four yes/no questions, keyed `note-<n>.<question>`:
  `security`, `reversibility`, `blastRadius`, `newConcept`. An unclear, cut or
  below-floor answer makes the note `critical`, never `could`. Blank makes every
  tiered note `critical`. A leading `! ` (bang, space) on any human review note
  forces `critical` and skips every judge question.
- **`refactorFlagPattern`** (`\bGTD_FLAG_\w+`) — the regular expression whose
  matches `refactorFirst` counts as flag reads (see
  [`refactorFirst`](#refactorfirst)). Blank or an invalid expression fails
  before the refactor starts, as does a pattern that matches the empty string.
  The default matches gtd's own `GTD_FLAG_<NAME>` naming; most repositories
  should set their own.
- **`seamAllow`**
  (`**/*.test.*, **/*.spec.*, **/*.feature, **/tests/**, **/test/**, **/__tests__/**, .gtd/**`)
  — the paths the [naive pass](#the-naive-pass-path) may change without the
  judge counting them as strays. Comma-separated globs, trimmed, blanks dropped;
  no brace alternation (`{a,b}` splits at the comma). A file the pass newly adds
  is allowed by its exact path, never as a glob: a new `src/a*.ts` does not
  cover a modified `src/a.ts`.
- **`flag_naive_pass`** (`0`) — `1` when `GTD_FLAG_NAIVE_PASS` is on, recorded
  at process start. Not a factory option; `--var flag_naive_pass=1` is the only
  override. A process keeps the path it started on.
- **`flag_risk_tier`** (`0`) — `1` when `GTD_FLAG_RISK_TIER` is on, recorded at
  process start. Acts only together with `flag_naive_pass`. Not a factory
  option; `--var flag_risk_tier=1` is the only override. Off, no tier is asked
  for and no commit carries a `Gtd-Mark:`. See
  [the naive-pass path](#the-naive-pass-path).
- **`judgeBudgetBytes`** (`32768`) — the total byte budget split across one
  judge step's evidence keys. Must be a positive integer; blank, zero, negative
  or fractional values fail the step rather than disabling the bound.
- **`qualityReviews`**
  (`correctness, owasp-security, ponytail-review, test-audit, conventions, spec-challenge`)
  — sets the quality lap `build.quality` runs ahead of the human review: one
  turn per comma-separated lens, in order. It is the one skill control that is a
  process setting rather than a `skills` entry — it decides the turn COUNT. Each
  lens is its own scope, keyed `build.quality.<lens>`; by default that scope's
  skills ARE the lens, and a `build.quality.<lens>` entry (see
  [Skills](#skills)) replaces them, valid only while the lens is listed here.
  Every round pays for it, so extend the list only as far as that is worth
  paying for — each lens adds about 1–1.5 min and about $0.5 per run; blanking
  it disables the lap. `correctness` (loads `code-review-and-quality`),
  `conventions` and `spec-challenge` are built-in lenses whose brief rides in
  the prompt; every finding any lens writes, blocking or not, is fixed by the
  one fix turn. See [Setup](./setup.md#extending-the-quality-review-lap).
- **`reviewBase`** (empty) — the commitish `--workflow review` reviews from
  (`gtd door review` sets it).

The prompts' wording — the voice below, the personas, the shared rules — is not
a variable: a workflow that wants different words writes its own prompts,
reusing the bundled workflow's steps and phases where it can (see
[Reusing the shipped workflows](#reusing-the-shipped-workflows)).

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

## Feature flags

A feature flag is an environment variable, `GTD_FLAG_<NAME>`, one per feature
flag: `GTD_FLAG_FOO` for a feature flag `foo`. gtd documents the mechanism, not
a list of feature flags.

- `1`, `true`, `0` and `false` are accepted, case-insensitively. Unset or empty
  is off, unless the flag is on by default — then it is on, and `0` or `false`
  is the kill switch that turns it off.
- A garbled value for a known feature flag exits `1` with a stderr line naming
  the variable.
- A `GTD_FLAG_*` variable naming no known feature flag is ignored.
- Feature flags are read live on every call, unlike a process setting: changing
  one mid-process applies to the rest of that process.
- Feature flags are in the [No promise](../COMPATIBILITY.md#no-promise) tier:
  any feature flag may appear, flip or vanish in any release.

### Rolling out and cleaning up a release flag

Two bundled workflows move a release flag through its life. Export them from
`gtd.config.ts` (`export { rollout, cleanup } from "@pmelab/gtd/workflows"`) and
start each through its door:

```bash
gtd door rollout <flag>
gtd door cleanup <flag>
```

`gtd --workflow rollout --var flag=<name>` (likewise `cleanup`) starts the same
process. A door with no argument is refused (see below).

- `flag` is the flag's name in the registry; it is required.
- `flagRegistry` is a factory option
  (`rollout({ flagRegistry: "src/flags.ts" })`), default `src/flags/index.ts`:
  the file declaring the flags, read as text: each flag is a flat object literal
  such as
  `{ name: "beta", owner: "me", expiry: "2027-01-01", kind: "release", defaultOn: true }`
  (`defaultOn` optional). Comments and string contents are not entries.
- **Rollout** takes a non-default-on release flag and has an agent set
  `defaultOn: true` on its entry, and nothing else. The suite must stay green.
  There is no review: once the suite passes, step `rollout.mentions` lists every
  line in a tracked file, `src/` help strings and `docs/` alike, that names the
  flag (as `GTD_FLAG_<NAME>`, `flag_<name>` or the bare name, case-insensitive),
  outside the registry and `.gtd/`, and the process ends. The list edits no file
  and leaves none behind: the closing commit records
  `Gtd-Mark: flag-mentions=<total>` and one
  `Gtd-Mark: flag-mention=<path>:<line>` per listed line (the first 50), and the
  closing message `gtd summary` prints carries the same lines, then "…and N
  more:" with a `git grep -niIE` command over tracked files, excluding the
  registry and `.gtd/`, matching the same three forms. Fix that prose by hand,
  or leave it for cleanup. These limits also bind the mentions step
  (`rollout.mentions`) and a human's fix at `rollout.suite.blocked`: each may
  touch only the flag's registry entry (`.gtd/FEEDBACK.md` aside), or the
  landing is refused.
- **Cleanup** takes a default-on release flag, deletes its entry and every
  `GTD_FLAG_<NAME>` check from `src/` (only `.ts`/`.tsx` files there are
  scanned), keeping the flag-on path, then runs the review. A review note ends
  the process; `gtd door fix` works it off. Those checks re-run after every
  later agent turn (fixes, escalation, quality lenses, the review's own turns)
  and a human's escalation landing, over the `src/` files that turn changed —
  but not after the human's review sign-off.

Refusals, each exiting non-zero with the text on stderr:

| Text                                                                                         | When                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `gtd: <workflow> needs --var flag=<name>`                                                    | no `flag` var                                                                   |
| `gtd door <rollout\|cleanup>: missing arguments — usage: gtd door <rollout\|cleanup> <flag>` | `gtd door rollout` or `gtd door cleanup` with no flag                           |
| `gtd: <workflow>: no flag "<name>" in <registry>`                                            | name not in the registry                                                        |
| `gtd: <workflow>: flag "<name>" is <kind>, not release`                                      | not a release flag                                                              |
| `gtd: rollout: flag "<name>" is already default-on`                                          | rollout of a default-on flag                                                    |
| `gtd: cleanup: flag "<name>" is not default-on — roll it out first`                          | cleanup of a flag still default-off                                             |
| `gtd land: rollout-only: <paths> changed — rollout may only set …`                           | rollout (agent, mentions step or human fix) touched a file besides the registry |
| `gtd land: rollout-only: other edits in <registry>: <faults>`                                | rollout (agent, mentions step or human fix) edited beyond that one field        |
| `gtd land: cleanup: <registry> still declares flag "<name>"`                                 | cleanup left or restored the registry entry                                     |
| `gtd land: cleanup: <paths> still names GTD_FLAG_<NAME>`                                     | cleanup left or reintroduced an env-var check under `src/`                      |

New step names in both workflows are public API.

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
a `.gtdrc.json`, is removed: `gtd install` scaffolds `gtd.config.ts`.
