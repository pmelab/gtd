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
| `context`     | `agent`              | Shares of the model's context window, `{ soft, hard }`, each in (0, 1] with `soft` below `hard` — `gtd next --json`'s `context`. Past `soft` the driver asks the agent to end its turn with a handoff note; past `hard`, or when the context is about to be compacted, it stops the turn and lands nothing. A key left out takes the driver's default: 0.6 and 0.7.                                                                                                                                           |
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
  `scope()`. `scope({ context }, fn)` gives every agent step inside `fn` a
  context limit (see [Step options](#step-options)); a nested scope's or the
  step's own replaces it key by key. It is no part of the scope's identity.
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

The script renderers (`checkScript`, `revertScript`, `applyScript`,
`restoreScript`, `removeScript`, `moveScript`, `showScript`, and `quote`) are
exported for a workflow's own `run` steps.
`applyScript(commit, report, failure, exclude?)` applies `commit`'s diff to the
working tree, leaving out each `exclude` path (literal, no globs) and everything
under it; one that no longer applies changes nothing and writes `failure` and
git's error to `report`, as `revertScript` does.

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
`fixFlow`), the phases (`unwind`, `planAndBuild`, `design`, `buildFeature`,
`seamBuild`, `implement`, `refactorFirst`, `buildTail`, `handOffTail`,
`handOffReview`, `fixReviewNotes`, `qualityLap`, `healthy`, `gate`, …) and every
single step (`triage`, `naivePass`, `fixCheck`, `reviewing`, `collecting`, …). A
step's name is relative to the `scope()` it runs in — the bundled workflow's
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
  return afterTail(await buildTail(start(), { fixFirst: true }))
}

export const doors = { hotfix: { workflow: "hotfix" } }
```

`buildTail(base, options?)` is the call form;
`buildTail(fixFirst, base, green?, options?)` is deprecated. A string second
argument selects the deprecated form, which then needs `fixFirst` and `green`
booleans or absent and `options` an object or absent; otherwise a string first
argument selects the current form, which takes nothing but an optional `options`
object. `null` counts as absent. A call fitting neither form is rejected before
any of `buildTail`'s own steps run. Every `BuildTailOptions` field accepts an
explicit `undefined` as absent, and its `feedback` and `lap` types are exported
as `FeedbackTarget` and `ReviewRange`.

`tail(finish, options?)` is the build tail without the review: `finish` gets the
escalation count and runs last; `options` (`TailOptions`) takes `fixFirst`,
`green`, `guard`, `lenses`, `guardRests`, `lensBase` and `rules`. `lenses`
entries take the `qualityReviews` form, `<lens>` or `<lens>=<model>`
(`lensEntriesOf` splits a list into them, `lensOf` splits one, `lensesOf` keeps
only the names); passed in, they replace `qualityReviews` hints and all.
`tail(fixFirst, finish, green?, guard?, lenses?, guardRests?, lensBase?, rules?)`
is deprecated; a function second argument selects it. A call fitting neither
form is rejected before any step runs.

A config's doors are those its workflows bring plus its `doors` export: export
`fix` and `review` to keep their doors (see [Doors](#doors)).

### Workflow factories

`feature`, `review` and `fix` are factories: calling one with options returns
that workflow configured. Their options are the
[bundled workflow's settings](#the-bundled-workflows-settings), each a string
(`flagMode` a boolean, stored as `true`/`false`), and each becomes that
workflow's own default of its kind — beneath `--var` and `GTD_<NAME>`, which
still layer on top. One option is no setting: `contextLimit`, `{ soft, hard }`,
the [context limit](#step-options) every agent step of the workflow runs under
(`feature({ contextLimit: { hard: 0.8 } })`); without it the driver's defaults
apply, and no variable overrides it:

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
behaviour-neutral refactor of its `strays`, minus any test file, and resolves
`true` once the refactor has closed. It resolves `false`, running no step,
unless `shape.choice` is `refactor-first`, `shape.unreadable` is empty and a
non-test stray remains — a stray whose content cannot be read goes to a human
instead, and a `refactor-first` whose strays are all test files goes straight to
`implement.*`, since a refactor never refactors a test file. `reference` is the
naive pass's kept tip (`kept(name)?.hash`; blank counts as none): the building
prompt names `git show <reference> -- <strays>` as reading material only and
forbids applying it, and names that diff's changes to existing code as the seam
the refactor must land — a refactor touching none of it is wrong; omitted, it
carries no reference line. `note` is the refactor note's text (blank counts as
none): the package carries it under `## Refactor note`, headings demoted, and
the building prompt tells the turn to build exactly the seams it names.

`refactorFirst` is the refactor alone. The shipped flow runs `reviewedRefactor`,
which is `refactorFirst` plus the refactor's quality lap and review inside the
same `refactor` scope, so the tail's steps are `refactor.build.*`; it resolves
`true` on sign-off and `false`, running no step, on exactly the shapes
`refactorFirst` rejects. The review tail's fix-check, quality-fix, risk-fix,
nit-fix and describe turns (`refactor.build.*`) are guarded and prompted with
the same rules as the refactor's own turns below.

The refactor review's closed collecting turn (after the review file is closed)
folds into `.gtd/REFACTOR.md` what that round left: every hand-edit and every
note after a hand-edit round, each note that asks for a change after a notes
round, each `edit`-judged note after a triaged round. It carries no
reply-in-place rules; those belong to the in-gate reply turn.

It runs inside the scope `refactor`, whose write access is the strays, the test
files (the list below) and `.gtd/**`, in these steps: `refactor.deriving`
(writes `.gtd/REFACTOR.md`, a file a person can read and edit),
`refactor.building`, the shared health loop (`refactor.health.check`,
`refactor.health.judge`, `refactor.health.recheck`, `refactor.health.describe`,
`refactor.health.stop`, `refactor.health.exhausted`) with
`refactor.fix.suite.fixing`, and `refactor.closing`, which removes only the
package file. A red suite goes to the fix loop, never to a refusal.

The package file's `## Scope (read-only)` list is for reading: the guards use
the strays as fixed when the package was derived, so editing the list widens or
narrows nothing. After the building turn, after every fix turn and after the
escalation describe turn (`refactor.health.describe`), `gtd land` refuses the
turn when:

- it changed a test file in any way but updating its call sites
  (`refactor-tests`). A test file is any path matching `**/*.test.*`,
  `**/*.spec.*`, `**/*.feature`, `**/tests/**`, `**/test/**` or
  `**/__tests__/**`; the list is fixed — `seamAllow` does not narrow it — and
  `*_test.go`, `test_*.py` and other namings are not test files here, so their
  call sites stay out of reach. An existing test file may be modified, so a seam
  that changes a call shape can update its callers there. Refused: adding or
  deleting a test file; changing a `.snap` snapshot or a `.feature` file (call
  sites live in code); changing a test file whose before or after cannot be
  read, or that held no `expect`/`assert*` call and no `it`/`test`/`describe`
  block (test data or a helper); and changing, outside comments, a file's count
  of `expect`/`assert*` calls, of `it`/`test`/`describe` blocks, or of skipped,
  focused or todo ones (`.skip`, `.only`, `.todo`, `xit`, …). A changed expected
  value keeps every count: the refactor review's prompt asks the reviewer to
  flag it, and `refactorFirst` alone has no review. Or
- it changed a path outside `.gtd/` that is neither a modified test file nor
  exactly one of the strays (`refactor-scope`; a fix turn is judged on its own
  changes, so a person's edit at an escalation stop does not block it; no globs:
  a stray `src/*.ts` does not admit `src/a.ts`), or
- it raised the number of reads of any one flag, or added a flag, across the
  changed files outside `.gtd/`. A flag is a match of the `refactorFlagPattern`
  setting; moving a read passes, and so does a swap that leaves every per-name
  count flat. A changed file whose before or after cannot be read refuses.

The human rests `refactor.health.stop` and `refactor.health.exhausted`, and
their counterparts in the refactor's review tail (`refactor.build.health.*`),
are never guarded: a person's edit there is not refused. The flag count, though,
spans every turn since the build: a flag read a person adds there refuses the
next fix turn until it is removed, and that turn may not touch the file to
remove it. Put no flag read in a person's edit at these rests.

A blank or invalid `refactorFlagPattern` throws before the first step, naming
the setting. A pattern that produces a zero-length match (a lookahead-only
pattern such as `(?=GTD_FLAG_\w+)`) on a stray throws before the first step, and
on text a turn introduces refuses the landing, naming the setting. The shipped
`feature` flow runs `reviewedRefactor` on the
[naive-pass path](#the-naive-pass-path); call `refactorFirst` or
`reviewedRefactor` from your own workflow after `judgeDiffShape`, with a suite
that is already green: the fix turns may touch only the strays, so they cannot
repair a failure outside them.

### Acceptance criteria

`.gtd/REQUIREMENTS.md` lists the change's acceptance criteria under a level-2
`## Acceptance Criteria`, one `- AC-<n>: <criterion>` line each, up to the next
heading. They are the build's stop condition, so each must be checkable by a
test or a command. Every later step re-reads them from the file.

- **Full path.** `design.triage` writes them; `gtd land` refuses a triage turn
  whose file has no criteria, a criterion without an ID, or two criteria sharing
  one (`acceptance-criteria`). While the file holds them, a later lap is asked
  to keep their IDs: reword in place, append with the next unused number, never
  renumber. The design gate settles them.
- **Skip path.** When the sketch adds or changes a list under an
  `Acceptance criteria` heading (any level, trailing `:` allowed) in exactly one
  `TODO.md` (any directory) and changes nothing else, `design.clear` asks a
  judge whether every criterion is clear and checkable. `yes` at `p` ≥ 0.8, with
  no evidence truncated, runs `design.normalise`: a script writes the list to
  `.gtd/REQUIREMENTS.md` as `AC-1`, `AC-2`, … (or keeps the sketch's own
  `AC-<n>` IDs when every item has a distinct one), with a `git show` pointer to
  the sketch, and the process goes straight to `seam.naive` — no triage, no
  design gate. Anything else, including one vague criterion, falls back to
  `design.triage`. A sketch with no such list skips the judge. With
  `GTD_FLAG_RISK_TIER` on there is no skip path: the tier is proposed at triage
  and set at the design gate.
- **Frozen.** After design only another design lap (review feedback) changes
  them: `gtd land` refuses an `implement.building` or
  `implement.fix.suite.fixing` turn that edits them (`criteria-frozen`).
  `seam.steer` is a human gate and may, but its edit must leave ID'd criteria,
  as at triage.
- **Stable after review.** A review feedback lap's design keeps a built
  criterion's ID — reworded in place when the review changes that behaviour, or
  deleted when it drops it — and numbers new behaviour above every ID handed out
  so far, including one a person narrowed away. `gtd land` refuses a triage turn
  that lists any other ID at or below that number (`criteria-ids`). It reads IDs
  only: a built criterion reworded to mean something else keeps its ID
  unnoticed.

**Upgrading:** finish or `gtd abandon` before upgrading any process that has
landed a `design.triage` turn whose `.gtd/REQUIREMENTS.md` has no ID'd
acceptance criteria — replay re-checks that turn and refuses it — and any
process past `start-gate.check` whose sketch held an `Acceptance criteria` list
in a `TODO.md`. A process resting at `design.triage` keeps replaying; its next
turn needs ID'd criteria.

### Acceptance-criteria coverage

Every `feature` implementation — with
[`flagMode`](#the-bundled-workflows-settings) on or off, and on a feedback lap —
ends at `implement.coverage` once its health loop is green: a judge asks, per
`AC-<n>` of `.gtd/REQUIREMENTS.md` (read afresh each time), whether a test file
changed since the process began (one the refactor's test globs match) covers it.
Each is a `noul` question named by the ID; `yes` at `p` ≥ 0.7 covers it, even
when the budget cut the evidence — a `yes` names a test the judge saw, while a
`no` on cut evidence sends the ID back. Landing without a verdict covers
nothing; a file with no ID'd criteria skips the judge.

- **Every ID covered**: the judge's landing carries one `Gtd-Mark: covers=<id>`
  trailer per ID, and `implement.closing` follows.
- **An ID uncovered**: the process goes back to `implement.covering`, an agent
  turn told which IDs lack a test, then the health loop and the judge again (an
  empty covering turn is allowed: the judge may have missed a test). After two
  covering turns it rests at `implement.uncovered`, a human step: an edit
  outside `.gtd/` (new or fixed tests) runs the health loop and the judge again
  with a fresh budget; a `gtd land` with no such edit overrules — that landing
  carries `covers=<id>` for the covered IDs and `Gtd-Mark: uncovered=<id>` for
  the rest. **The judge reads test text, it runs nothing**: the green suite is
  the only proof the tests pass.
- A `covering` turn, like the build turn, may not change the criteria
  (`criteria-frozen`).

**Upgrading:** finish or `gtd abandon` any process past `implement.health.check`
(resting at `implement.closing` or later in a `feature` slice): replay now
expects `implement.coverage` there. A process resting earlier keeps replaying.
Custom fixtures driving the `feature` workflow must answer `implement.coverage`.

### The naive-pass path

The `feature` workflow's path while
[`flagMode`](#the-bundled-workflows-settings) is on (the default); off, steps 1
and 2 run, no judge, and the pass lands as on `land`. After design it runs, in
order:

1. `seam.naive` — an agent implements `.gtd/REQUIREMENTS.md` directly,
   breadth-first, with behaviour-level acceptance tests; the turn is a
   [kept tip](#kept-tips), not landed on the branch until a `land` applies it. A
   pass whose added or changed test files (the fixed list `**/*.test.*`,
   `**/*.spec.*`, `**/*.feature`, `**/tests/**`, `**/test/**`,
   `**/__tests__/**`) leave an `AC-<n>` of `.gtd/REQUIREMENTS.md` unnamed
   (`acceptance-tests`; any mention on a line the pass added counts, `[AC-3] …`
   in the test name is the convention), or that import a non-test file the pass
   added (`acceptance-internals`: the string a `from`, `import`, `require(` or
   `mock(` takes, outside comments; relative ones resolved from the test's
   directory, `@/`-, `~/`- or `#`-aliased ones matching the path's end, others
   only as the exact path; a computed import goes unseen, and `.feature` and
   `.snap` files are not read for imports) runs `seam.naive` again, told why and
   to pick the attempt up. Tests outside those globs never count: such a project
   reaches `seam.steer` and overrules there.
2. `seam.check` — runs [`testCommand`](#the-bundled-workflows-settings) with the
   kept pass applied to the tree, then puts the pass's paths, and every other
   path the run changed or added that was not already dirty or untracked, back
   as `HEAD` has them (the pass's paths before the run too, so an interrupted
   one is cleaned up). Red — or a pass that no longer applies — writes
   `.gtd/FEEDBACK.md` and runs `seam.naive` again, told to pick the last attempt
   up and fix it; green goes on.
3. `seam.judge` — a judge rules on the shape of that diff (see
   [Judges](#judges)): `land`, `refactor-first` or `reject`.
4. `land` — or an overrule of `reject` at `seam.steer` — applies the kept pass
   as the implementation: `implement.applying` puts its diff, outside `.gtd/`,
   in the tree, with no build turn and no release flag, and the health loop
   follows. A pass that no longer applies writes `.gtd/FEEDBACK.md` and falls
   back to `implement.building`, built fresh from it as below; so does one with
   nothing outside `.gtd/` to apply. `refactor-first` never applies the pass:
   first `seam.note`, an agent turn, reads the whole naive diff and writes
   `.gtd/REFACTOR-NOTE.md` — which seams the refactor opens and the shape each
   takes. A note turn that changes any other path, or leaves the note empty, is
   refused (`refactor-note`). Then the refactor and its review run as the
   `refactor` slice, flag-free and behaviour-neutral, landing on their own with
   the existing suite green: `refactor.*` (its package carries the note under
   `## Refactor note`), then the refactor's quality lap
   (`refactor.build.quality.<lens>`, one per
   [`refactorQualityReviews`](#the-bundled-workflows-settings) lens) and a human
   review (`refactor.build.review.*`). The review's sign-off is the approval; no
   `Gtd-Approved:` trailer is recorded. Strays whose content cannot be read rest
   at `seam.by-hand`, with no refactor slice; a clean `gtd land` continues.
   `reject` discards the pass and runs `seam.naive` again. Rejects, test faults
   and red checks share one budget: two retries, then `seam.steer`.
5. `implement.*` — after a refactor (or a pass that no longer applies), one
   build turn that reads the kept pass as material only; after `land`, the
   applied pass. After a `refactor-first` verdict the build turn is the rebuild:
   its prompt quotes the refactor note (after a refactor; the note is fixed when
   `seam.note` lands, so a later edit of the file reaches neither turn) and
   names the naive pass's acceptance tests (`git show <tip> -- <tests>`) to
   carry over, and `gtd land` refuses it (`rebuild-acceptance`) while the test
   files changed since the feature slice began leave out an `AC-<n>` the naive
   pass's tests named on an added line; an `implement.fix.suite.fixing` turn
   that itself drops such an ID from a test file is refused the same way (a
   person's edit at an escalation rest is not). The check reads test text — a
   skipped test passes it; the health loop is what runs them green. Then the
   health loop (`implement.health.*`, `implement.fix.suite.fixing`), the
   [coverage judge](#acceptance-criteria-coverage) (`implement.coverage`) and
   `implement.closing`, which removes `.gtd/REQUIREMENTS.md` (and
   `.gtd/REFACTOR-NOTE.md`, when there is one). A build turn is asked for a new
   release flag. The feature's quality lap (`build.quality.<lens>`) follows,
   then the [feature review](#the-feature-review) (`build.review.*`); its
   findings are [triaged](#the-triaged-quality-lap). Between
   [coarse slices](#coarse-slices) nothing triages them: the fix turn fixes
   every one, and those the fix cap leaves in `.gtd/QUALITY.md` rest at
   `build.quality-unresolved`, a human step, until the file is deleted or
   emptied; the health loop then checks any hand edits before the next slice.
   After a `refactor` slice the build turn may change nothing but the
   carried-over tests — the refactor already carried the whole feature — and an
   empty turn completes the step when the naive pass's tests named no ID. A
   feature slice that changed no code but test files has its quality lap cover
   the whole change from the process start (with
   [coarse slices](#coarse-slices), from where its slice began), refactor
   included.

Every verdict wraps step 5 and its quality lap in the `feature` slice
(`gtd slices` lists it); `refactor-first` adds the `refactor` slice ahead of it.
Each slice's quality lap reviews from that slice's own base: the refactor's from
its entry commit, the feature's from the refactor's sign-off. The one exception
is a feature slice that changed no code but tests (step 5): its quality lap
covers the whole change from the process start (from where its slice began, with
[coarse slices](#coarse-slices)).

#### The triaged quality lap

Ahead of every `feature` review — the feature's and the refactor's — the quality
lenses are the only agentic review. Each lens appends its findings to
`.gtd/QUALITY.md`, one `## <title>` chunk per finding (prose outside every chunk
counts as one more finding). A judge, `build.quality.triage`, classifies each
one (`Q1`, `Q2`, … in file order):

- `mechanical` — fixed by `build.fix.quality.fixing`, up to three turns, each
  deleting the chunks it resolved; the health loop then runs the suite green
- `noise` — dropped, recorded on the judge's landing as
  `Gtd-Mark: noise=<id> p=<p> <title>`
- `design` — it questions a criterion or the approach: a note for the review

A verdict below `qualityTriageMinP` (`0.7`), a missing one, or a finding the
judge's budget cut is `design`. `build.quality.sorting` leaves only the
mechanical findings in `.gtd/QUALITY.md` for the fix turns; mechanical findings
still there after the third turn become notes too.

`build.review.composing` then writes `.gtd/REVIEW.md` — no reviewer turn runs —
and removes `.gtd/QUALITY.md`: a `## Weakened scenarios` chunk naming each
`Then` line a `.feature` file at the review base has lost, then one prose `## `
chunk per note (a mechanical one the fixer left is marked so), then
`## Fixed automatically` (one line per finding, with the fixing commit's short
hash) and `## Dropped as noise` (one line per finding, with its `p`). Each note
chunk ends in `Tick exactly one:` and three boxes — `fix as suggested`,
`won't fix`, `_your answer_` — and the review gate refuses to land
(`answer-completeness`) until every note holds exactly one tick, a ticked
`_your answer_` replaced by the human's text; only a round with a `- H:` thread
waiting on the agent may leave one open. The summary chunks carry no box and
need no answer; disagreeing with one means writing a note of your own. With
nothing to list, the file holds one `## Nothing to note` chunk. Task boxes in a
finding are written as plain bullets. The fresh review after a nit fix adds
`## Fixed from your notes` with the fixing commit and leaves out every note
already answered; after a round that also answered a question, the review is
restored as answered instead, ticks kept.

An answer routes without the note judge: `fix as suggested` joins the nit batch
(`build.review.fix.nits.fixing`) with the note's text; `won't fix` drops the
note and records `Gtd-Mark: wontfix=<title>` on the gate's commit; an own answer
is judged like any other note, keyed `answer-<n>`. Nothing is written to
`.gtd/TODO.md`. The `review` workflow runs this same review; `fix` keeps the
untriaged lap and its reviewer turn.

#### Learned standards

`feature`'s review and the `review` door learn alike. Once a review round's
answers are recorded, and before any is routed, each won't-fix and each own
answer becomes a candidate standard — `Won't fix:
<title> — <the note's first paragraph>`, or `<your answer> (re: <title>)` —
unless `.gtd/STANDARDS.md` already holds it. `build.review.standards.judge`
asks one yes/no per candidate (`standard-<n>`: is it reusable beyond this
note?), and whether it contradicts each kept standard
(`standard-<n>.contradicts-<k>`) and each candidate before it
(`standard-<n>.contradicts-new-<m>`). Each kept standard is its own evidence
key. A candidate is kept only on a `yes` at `standardMinP` or above, its
evidence and every kept standard's uncut; landing the judge without a verdict
keeps none, and a blank `standardMinP` asks no judge at all. A kept candidate
any contradiction question does not rule out — a `no` at `standardMinP` — is
not applied: it is written under `## Undecided`, each contradicted standard as
a nested `- contradicts:` line. `build.review.standards.recording` writes the
file, and `build.review.standards.raising` appends one
`## Standard conflict <id>` chunk per new conflict to `.gtd/REVIEW.md`, its
boxes `keep the new one (drop the old)`, `keep the old one (discard the new)`
and `_your answer_` — read by position, like a note's. The answer is settled
there and never routed: the new standard replaces the old ones, is dropped, or
your text replaces both. A sign-off while `## Undecided` holds anything composes
the review again with those conflicts instead, so the process never ends with
one open. A fresh review lists every standard kept since its base under
`## Standards added`.

Every agent turn the shipped workflows open with their skills preamble — the
lenses, naive pass, build, every fix, collecting and answering turns — gets the
kept standards (never the undecided ones) appended to its prompt; `seam.note`
and the `rollout`/`cleanup` turns do not. Any top-level bullet is a standard,
numbered or not, grouped under any heading but `## Undecided`; gtd rewrites the
file as one list when it learns, dropping prose and duplicates. Standards
compare without emphasis marks or case, so a formatter's rewrite never makes a
standard new. A kept standard the judge's evidence budget cuts leaves that round
unlearned — raise `judgeBudgetBytes` once the file grows long. Answering a
conflict drops the standards it replaces from every other open conflict, which
then asks only whether to keep, discard or reword its new standard.

#### The feature review

After the last slice's quality lap, the process rests at the human review
(`build.review.*`, `.gtd/REVIEW.md`) over the slice's own base — on
`refactor-first`, everything since the refactor's sign-off, unless the refactor
carried the whole feature (step 5), when it re-covers the refactor too — or, for
a sliced change, the whole change from the process start. A sign-off ends the
process at `idle`. Notes are triaged as in every review (`build.review.triage`);
an `edit` is collected into `.gtd/REQUIREMENTS.md` and starts a feedback lap:
`re-unwind` reverts the human's code edits, design runs again (its criteria
[stable after review](#acceptance-criteria)), then `implement.*` with a build
turn — never `implement.applying` — and the coverage judge over every criterion,
against the tests changed since the process start, then the quality lap and the
review again. A custom workflow ending in `afterTail` runs the same lap, without
the `criteria-ids` check. `seam.naive` and `seam.judge` never run again once
judged, so a seam a re-plan turns up is built unjudged and unrefactored; a wrong
or missing refactor means `gtd abandon` and a restart.

**Upgrading:** a `won't fix` or own answer at a `feature` or `review` review now
runs `build.review.standards.judge` (and
`refactor.build.review.standards.judge`) before anything is routed. A process
resting past a review round that held one — at its triage, nit fix, question
answer or collecting turn — no longer replays: finish or `gtd abandon` it before
upgrading. A driver or fixture that answers a note `won't fix` or in its own
words scripts that judge too (land it without a verdict to keep nothing).
Workflow-kit's `ReviewPolicy` gains optional `settles`, `learn` and `pending`,
and `routeNotes` an optional fifth argument.

**Upgrading:** `feature`'s review notes carry answer boxes and nothing is
deferred. `build.review.defer` and `refactor.build.review.defer` are gone: a
process resting at either no longer replays — finish or `gtd abandon` it first.
A `could` edit note is re-planned like any other. A driver or fixture that signs
off a review holding notes ticks one box per note first. Workflow-kit's
`Verdict` has no `defer`, and `ReviewPolicy` loses `defer` and gains an optional
`decided`. A `## Deferred review notes` section already in `.gtd/TODO.md` is no
longer kept out of a new process's triage: delete or move it before starting
one.

**Upgrading:** `review` runs `feature`'s review and fixes its notes in place. A
`review` process past its `review-gate.check` no longer replays: finish or
`gtd abandon` it before upgrading. A driver or fixture scripting the `review`
door's `build.review.reviewing` scripts `build.review.composing` and, with
lenses on, the `build.quality.triage` judge instead; a note there no longer
reaches `build.review.handing-off`, and a `.gtd/REVIEW.md` an older `review`
handed off is still read by `fix`.

**Upgrading:** `feature`'s reviews are composed from the quality lap. A process
resting at `build.review.reviewing`, `build.review.fix.risks.fixing`, a
`build.fix.quality.fixing` turn or `build.quality-unresolved` of its last slice
(or their `refactor.build.*` twins) no longer replays: finish or `gtd abandon`
it before upgrading. A driver or fixture scripting `build.review.reviewing` for
`feature` scripts `build.review.composing` (a script step) and, with lenses on,
the `build.quality.triage` judge instead.

**Upgrading:** `feature` ends at the review again. A process that ended at
`idle` stays ended; one resting in its last slice's quality lap, or at
`build.quality-unresolved` after it, moves on to the review instead of `idle`. A
driver or fixture expecting `feature` to land in `idle` after the quality lap
must sign the review off.

**Upgrading:** finish or `gtd abandon` before upgrading any process whose seam
judge ruled `land`, that overruled a reject at `seam.steer`, or — with
`flagMode` off — that has passed `design.gate.answer`: their history names
`implement.building` where the flow now reaches `seam.naive` or
`implement.applying`, and replay refuses it as divergence.

**Upgrading:** finish or `gtd abandon` any process whose seam judge ruled
`refactor-first`: replay now expects `seam.note` after the verdict where its
history names `refactor.deriving`, and refuses it as divergence.

### Continuations

A driver asks an agent turn past its [context limit](#step-options)'s `soft`
share to stop and end with a handoff note. In `feature`, three turns are told to
write that note to `.gtd/HANDOFF.md`: the naive pass (`seam.naive`), the
refactor (`refactor.building`) and the build (`implement.building`, the rebuild
included). A turn that writes it stopped at its limit; what it left is the
**snapshot**, broken or not:

- **Naive pass** — its [kept tip](#kept-tips), off the branch. The continuation,
  `seam.continue.naive`, applies the tip (`.gtd/HANDOFF.md` left out) and works
  on the `AC-<n>` its tests do not name yet. The pass that finally ends without
  a note is vetted, checked and judged as one.
- **Refactor** — the turn's own commit, then the health loop: every sub-step
  keeps the existing suite green before `refactor.continue.building` picks up.
  What is still open is the refactor's paths it has not changed yet.
- **Build** — the turn's own commit, on the branch, still behind the release
  flag. `implement.continue.building` works on the `AC-<n>` the build's tests do
  not name yet; the health loop runs once the build ends without a note.

Each continuation is a fresh conversation (`<phase>.continue` is its memory
scope), told the snapshot, the note and what is still open, and asked to delete
`.gtd/HANDOFF.md` once done: in the refactor and the build, a note still in the
tree after a turn means that turn stopped again (`implement.closing` and
`refactor.closing` remove it). Once a phase has continued, its later turns — a
naive retry, the next refactor lap — are fresh conversations too, under
`<phase>.fresh` (`seam.fresh.naive`, `refactor.fresh.building`). Per phase —
across its retries and laps — [`continuations`](#the-bundled-workflows-settings)
continuations run (default 3); one more stop, or
[`continuationStall`](#the-bundled-workflows-settings) continuations in a row
that close nothing still open (default 2; a stop with nothing countable left
open is never a stall), rests at `seam.oversized`, `refactor.oversized` or
`implement.oversized`. Landing there, clean or — at `seam.oversized` and
`implement.oversized` — after narrowing `.gtd/REQUIREMENTS.md` (refused unless
its criteria stay valid, and never deleted; a rebuild then carries only the
criteria still listed), starts a fresh round from the last snapshot;
`gtd abandon` gives the change up. A refactor's scope is fixed, so at
`refactor.oversized` only a raised context limit makes room. A continuation that
forgets to delete the note is read as stopped again, so it costs another
continuation, never a half-finished phase going on.

**A turn stopped at its `hard` limit is not a snapshot**: the driver lands
nothing, as in [Context limits](./driver.md#context-limits). Only the soft
stop's note continues.

A review note at the refactor review is collected into `.gtd/REFACTOR.md`, and
`refactor.deriving` runs again with the notes under `## Review feedback` — never
`design.triage`. A concern that needs a path outside the strays, a new or
changed test or assertion, or a new flag read cannot be built: abandon and
restart.

A refactor-review round carrying an `edit` note or a code hand-edit whose
collecting turn writes no `.gtd/REFACTOR.md` and changes nothing is never signed
off: `gtd land` refuses the collecting landing (`refactor-feedback`). A
hand-edit round's refusal names the edited paths. A notes-only round's refusal
names the notes judged `edit`, footnotes included, never praise or questions.
The only way out is `gtd abandon`, which throws away the naive pass, the
refactor and its review. A praise-only round still signs off. A settled round,
one where the human only added thread replies after the in-gate reply turn,
refuses the same way when anything since the review asked for a change: a note
judged `edit` or `nit`, or a hand-edited path. The refusal names them.

Footnotes are judged like line notes. A `- H:` thread left in `.gtd/REVIEW.md`
at the refactor review gets one `- A:` reply and the gate rests again; a thread
folds into `.gtd/REFACTOR.md` only when it asks for a change.

**Upgrading:** four migrations.

- The feature review was dropped (it is back since; see
  [The feature review](#the-feature-review)): `feature` ended after the feature
  slice's quality lap. A process resting at, or past, any `build.review.*` step
  of the feature slice (including a feature feedback lap) no longer replayed:
  finish it with the gtd that started it, or `gtd abandon` it, before upgrading.

- `GTD_FLAG_NAIVE_PASS`, its `flag_naive_pass` setting and the architecture and
  package path are gone: every process takes the naive-pass path. A process
  started on the old path (with the flag off — the default) no longer replays at
  any rest from `architecture.*` on — `architecture.*`, `packages.*`, and every
  `build.*` step after them — and must be finished or `gtd abandon`ed before
  upgrading; one resting at `idle`, `unwind`, `start-gate.*` or `design.*` on
  its first lap keeps replaying, onto the naive pass; one on a review loop-back
  lap has `architecture.*` in its history and must be abandoned too.
  `--var flag_naive_pass=…` is refused as undeclared, and a `config.skills` or
  `config.access` key on `architecture`, `architecture.decompose` or
  `packages.item*` fails every command: move it to the `implement*` scope. The
  `architecture`, `packages`, `packageItem`, `nextPackage`, `declaredTests`,
  `requireDeclaredTests`, `author`, `decompose`, `answerTechnicalQuestions`,
  `build` and `fixSuite` exports, the `ARCHITECTURE` constant and the
  `.gtd/ARCHITECTURE.md` steering entry are removed; `planAndBuild` takes only
  its base; `buildFeature` is everything after design. `GTD_FLAG_RISK_TIER` no
  longer needs the removed flag: an old-path process that started with it on and
  replays onto the naive pass records the tier from then on, and with no
  `## Risk Tier` section that tier is `high`.
- `seam.approve` is gone; the refactor's review sign-off is the approval. A
  naive-pass process from 27.5.0 or later whose judge ruled `refactor-first` no
  longer replays at any rest from that verdict on — `seam.approve`, every
  `refactor.*` step, and every `implement.*` and `build.*` step after the
  refactor — and must `gtd abandon`. Processes that rest at `design.*`,
  `seam.naive`, `seam.judge`, `seam.steer`, or past a `land` verdict short of
  the feature review keep replaying.
- `seamBuild(tier)` became `seamBuild(base)` and resolves `{ reference, base }`.
  It no longer runs `implement`; a custom workflow calls `implement` itself.
- `seamBuild(base)` resolves `land: true` when the pass is the implementation
  (`land`, an overruled `reject`, or `flagMode` off, where it runs no judge);
  pass its `reference` on as `implement({ naive: reference })` to apply it at
  `implement.applying`. Without `naive`, `implement` builds fresh as before.
- On `refactor-first`, `seamBuild(base)` also resolves `rebuild` (the refactor
  note and the naive pass's acceptance tests); pass it on as
  `implement({ rebuild })` to quote the note and enforce `rebuild-acceptance`.

With `GTD_FLAG_RISK_TIER` on, `design.triage` proposes a risk tier (`low` or
`high`, with a one-line reason) under `## Risk Tier` and the signals to watch
after merge under `## Production Signals` in `.gtd/REQUIREMENTS.md`. Edit the
first word under `## Risk Tier` at `design.gate.answer` to change the tier; a
missing or unreadable tier means `high`. The design gate's landing records
`Gtd-Mark: risk-tier=<low|high>` and one `Gtd-Mark: production-signal=…` per
signal; no step is added.

A third failed attempt — a `reject`, a test fault or a red `seam.check` — rests
at `seam.steer`. Two ways forward, then `gtd land`:

- **Steer** — edit `.gtd/REQUIREMENTS.md`; `seam.naive` runs again with a fresh
  retry budget. An edit together with an approval counts as steer.
- **Overrule** — land a clean tree. After a test fault the last attempt goes on
  to `seam.check` as it is, with a fresh retry budget, and later passes of this
  seam are not checked for test faults again: **a criterion may have no test
  that survives a refactor**. After a `reject` the implementation is built
  against the last attempt with no refactor: **overrule ships the seam the judge
  objected to**, unaddressed. After a red check the last attempt goes on to
  `seam.judge` as it is, with a fresh retry budget: **its acceptance tests never
  passed**, and only the implementation's health loop makes the suite green. The
  choice is recorded in history.

After either, `seam.clear` removes a red check's `.gtd/FEEDBACK.md`.

**Upgrading:** finish or `gtd abandon` any process that has landed a
`seam.naive` turn: replay now expects `seam.check` (or, for a turn whose tests
fall short, another `seam.naive`) after it. One resting at `seam.naive` or
earlier keeps replaying; its next naive turn needs ID-tagged tests.

The [`seamAllow`](#the-bundled-workflows-settings) setting is the judge's
allowlist. `GTD_FLAG_RISK_TIER` is recorded as `flag_risk_tier` when a process
starts, so a process keeps the setting it started with whatever the environment
does later.

### Coarse slices

A change with more `AC-<n>` criteria than
[`sliceMaxCriteria`](#the-bundled-workflows-settings) (8 by default) is built in
slices. Once design settled the criteria (the design gate, or the skip path),
`design.slicing`, an agent turn, writes `.gtd/SLICES.md`: one `## <title>`
heading per slice over one `- AC-<n>` item per criterion, related criteria
together, as few slices as the cap allows, in the order they build on each
other:

```md
# Slices

## Parsing

- AC-1
- AC-3

## Output

- AC-2
```

`gtd land` refuses the turn (`slices`) while the file has no slice, a slice with
no criterion, an item not led by an ID, a slice over the cap, an ID twice, an ID
`.gtd/REQUIREMENTS.md` does not list, or a criterion in no slice.

Each slice then runs the [naive-pass path](#the-naive-pass-path) in order, from
where the previous one landed, held to its own IDs only: `seam.naive` and the
build turn are told which IDs are theirs, `acceptance-tests` and
`rebuild-acceptance` ask only for those, and `implement.coverage` judges only
those, over the tests changed since the slice began. A slice's
`implement.closing` keeps `.gtd/REQUIREMENTS.md` and `.gtd/SLICES.md` for the
next one; the last removes both. The last slice also builds any criterion a
steer at `seam.steer` added after slicing; a slice a steer left with no
criterion is skipped. Until the last slice closes, a quality-lap fix turn that
changes the criteria is refused (`criteria-frozen`). Every turn of a slice,
covering turns included, is told its IDs, and to reuse a release flag an earlier
slice added. Slices are named `feature-<n>`, with `refactor-<n>` ahead of one
the seam judge sent to a refactor. A change within the cap runs no slicing turn
and keeps the single `feature` (and `refactor`) slice.

**Upgrading:** finish or `gtd abandon` any process past design whose
`.gtd/REQUIREMENTS.md` lists more than 8 criteria: replay now expects
`design.slicing` there and refuses its history as divergence. To keep building
such changes in one slice, raise the cap:
`feature({ sliceMaxCriteria: "100" })`.

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

- **`feature`** — the ordinary start, and its `default`: plan, build, the
  quality lap, then a human review whose notes are triaged and, for an edit,
  re-planned.
- **`review`** — `feature`'s review of everything since
  `--var reviewBase=<commitish>`, with no design phase and no coverage judge: a
  green gate (`review-gate`), the triaged quality lap, then the human review of
  [The feature review](#the-feature-review). Fixes and nits are fixed in place
  (`build.review.fix.nits.fixing`); a note judged `edit`, or a hand-edit, is
  collected into `.gtd/REQUIREMENTS.md` (`build.review.collecting`), your edits
  are reverted (`re-unwind`), one turn builds it (`feedback.fixing`), the file
  is removed (`feedback.closing`), and the tail runs again. A sign-off ends the
  process with no review file left. Starting it is refused while a pending
  hand-off from `fix` or a leftover `.gtd/REQUIREMENTS.md` is in the tree.
- **`fix`** — with a handed-off `.gtd/REVIEW.md` in the tree, one turn fixes
  every note (read from the two review files) and every `Risk:`
  (`notes.fixing`), both files are removed (`notes.closing`), and the result
  goes through the build tail to its own hand-off review. With none, it repairs
  a red baseline (`fix-precheck`) through the same tail. A note at its review
  ends the process with `.gtd/REVIEW.md` kept and the reviewer's own version
  copied beside it as `.gtd/REVIEW.orig.md` (`build.review.handing-off`), for
  the next `fix`, never re-planned. Until then, starting `feature` or `review`
  is refused; remove both review files to abandon the hand-off. `fix` refuses a
  lone `.gtd/REVIEW.orig.md`.

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
`rollout <flag>`, its `cleanup` builds `cleanup <flag>`, its `tests` builds
`tests`. A config's doors are those of every workflow it exports, plus its
`doors` export, which wins a name clash — a door several exported workflows
build belongs to the one exported under the door's own name (the others build
none, whatever the order); when none is, no workflow builds that door and
loading warns (`gtd: warning: …` on every command that loads the config) until
the `doors` export declares it; a declared door replaces the derived one whole,
so it restates `args` and `vars` itself. A config exporting only `fix` offers
only the `fix` door. The shipped module's own `doors` export is an empty no-op,
and its `base` export maps `reviewBase` for a workflow named `review`; both are
kept only so an older config re-exporting them still loads.
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
but it refuses every landing at the bundled requirements and review gates until
you reply with a conclusion or delete it. Those gates stop on every process; a
round that only replies returns to the same gate (at review: no revert, no
development lap). `gtd check <mode> <file> --open-threads` prints
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
  one, an open thread (agent spoke last) refuses landing at the requirements and
  review gates, and the agent answers a question with exactly one `A:` line
  directly below, or folds a conclusion in and deletes the thread. A syntax
  fault (agent opens, same author twice, empty entry) refuses too
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
    "implement.fix.suite": ["debugging-and-error-recovery"],
    build: ["debugging-and-error-recovery", "my-org-runbook"],
  },
})
```

The bundled workflow's addressable scope full names:

`design`, `seam`, `implement`, `implement.fix.suite`, `implement.health`,
`refactor`, `refactor.fix.suite`, `refactor.health`, `refactor.build`,
`refactor.build.health`, `refactor.build.fix.quality`, `refactor.build.review`,
`refactor.build.review.fix.nits`, `refactor.build.review.fix.risks`, one
`refactor.build.quality.<lens>` per `refactorQualityReviews` entry, `build`,
`build.health`, `build.fix.quality`, `build.review`, `build.review.fix.nits`,
`build.review.fix.risks`, and one `build.quality.<lens>` per `qualityReviews`
entry.

A nested scope with no entry of its own inherits its parent's list, so a key on
a parent reaches every scope beneath it that sets none. The group scopes
`build.fix`, `build.review.fix`, `build.quality`, `refactor.fix` and
`implement.fix` run no turn and carry no key, nor do `seam.judge`, `seam.steer`
and `seam.by-hand`. A custom workflow's own scopes are addressable through its
own `skills` export (see
[Reusing the shipped workflows](#reusing-the-shipped-workflows)); the export may
be a function of the resolved vars, and must list every scope holding an agent
step. The type can check an entry's VALUE (an array of strings) but never its
KEY, since scope names come from the workflow actually in play — there is no
editor autocompletion of scope names here.

A key that is not a scope running a turn is a load error, exit 1 — a group scope
such as `build.fix`, or a step name rather than its scope. The message lists the
known scope keys. Keying config on a scope's full name widens what renaming a
scope breaks: it also orphans every `config.skills` entry naming it, which
becomes an unknown key and exits 1.

`qualityReviews` (a process setting, not a `skills` entry — see
[Settings](#settings)) and the `build.quality.<lens>` keys are a pair:
`qualityReviews` decides how many quality-lap turns run, one per lens, and each
lens is its own scope, keyed `build.quality.<lens>`. By default that scope's
skills ARE the lens; a `build.quality.<lens>` entry REPLACES them with the
configured list, leaving the prompt body's own mention of the lens untouched.
Such a key is valid only while the lens is listed in `qualityReviews` (for a
`refactor.build.quality.<lens>` key, in `refactorQualityReviews`), judged
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
`config.access.refactor` entry replaces that wholesale. Every `refactor.build.*`
scope inherits that restriction, except the scopes below that set their own.
`refactor.build.review.fix.nits` and `refactor.build.review.fix.risks` carry the
same strays-plus-`.gtd/**` limit, set at run time; a `config.access` entry on
the fix scope outranks it, while a `config.access.refactor` entry does not reach
it.

| Scope                                                               | `write`                          |
| ------------------------------------------------------------------- | -------------------------------- |
| `design`                                                            | `[]`                             |
| `build.review`                                                      | `.gtd/REVIEW.md`                 |
| `build.review.fix.nits`, `build.review.fix.risks`                   | `{}` (reopened: fixes edit code) |
| `build.quality.<lens>`                                              | `[]`                             |
| `refactor.build.quality.<lens>`                                     | `[]`                             |
| `refactor.build.review`                                             | `.gtd/REVIEW.md`                 |
| `refactor.build.review.fix.nits`, `refactor.build.review.fix.risks` | the strays, `.gtd/**` (run time) |

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
  - /path/to/repo/gtd.config.ts: config.skills.build.fix: "skills.build.fix" is not a scope that runs a turn — known scopes: build, build.fix.quality, …
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

- **`testCommand`** (`npm test`) — the suite every health check, `seam.check`
  and baseline gate runs. It is interpolated into a POSIX `sh` script, so keep
  it sh-compatible.
- **`plannerModel`** (`smart`) / **`coderModel`** (`base`) — the `model` hints
  of the planning/reviewing steps (design triage, the review, the `correctness`,
  `owasp-security` and `spec-challenge` lenses) and of the building/fixing steps
  (the naive pass, implementation, refactor, every fix loop, the `conventions`,
  `ponytail-review` and `test-audit` lenses). A lens hint in `qualityReviews` or
  `refactorQualityReviews` wins over either. Judge steps such as `seam.judge`
  carry no hint: their model is the judge provider's (see
  [Judge settings](#judge-settings)).

**Process settings:**

- **`judgeIdenticalMinP`** (`0.7`) — the confidence an "identical failure"
  verdict at `health.judge` needs before a red streak escalates early, and a
  "progress" verdict needs to earn the extra fix turn at the cap. Blank,
  non-numeric or non-finite means it can never be cleared, so both are off.
- **`reviewNoteActionable`** (`0.7`) — the floor a non-`edit` verdict
  (`question`, `nit`, `praise`) on a review note must clear at
  `build.review.triage` and `refactor.build.review.triage`. Below it, the note
  counts as `edit` and goes to the collecting turn and a replan. A note whose
  evidence was cut, or that got no verdict, also counts as `edit`. Blank makes
  every note `edit`. Triage answers are keyed `note-<n>`.
- **`reviewSeverityMinP`** (`0.7`) — the confidence each severity judge answer
  on a review note must clear. Every tiered note gets a `critical`, `should` or
  `could` tier from four yes/no questions, keyed `note-<n>.<question>`:
  `security`, `reversibility`, `blastRadius`, `newConcept`. An unclear, cut or
  below-floor answer makes the note `critical`, never `could`. Blank makes every
  tiered note `critical`. A leading `! ` (bang, space) on any human review note
  forces `critical` and skips every judge question.
- **`standardMinP`** (`0.8`) — the floor a `yes` on "is this answer a reusable
  standard?" must clear at `build.review.standards.judge` (and
  `refactor.build.review.standards.judge`) before the answer is kept in
  `.gtd/STANDARDS.md`, and a `no` on "does it contradict this one?" must clear
  before it is kept without asking you. Blank keeps none and asks no judge. See
  [learned standards](#learned-standards).
- **`qualityTriageMinP`** (`0.7`) — the floor a `mechanical` or `noise` verdict
  on a quality finding must clear at `build.quality.triage` (and
  `refactor.build.quality.triage`). Below it, the finding is `design` and
  reaches the review as a note. Blank makes every finding `design`. Answers are
  keyed `Q<n>`. See [the triaged quality lap](#the-triaged-quality-lap).
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
- **`sliceMaxCriteria`** (`8`) — the most acceptance criteria one slice builds.
  A change with more is grouped into [coarse slices](#coarse-slices) by
  `design.slicing`; one within it runs no slicing turn. Must be a positive
  integer; anything else refuses the landing that would start the process.
  Pinned at process start.
- **`flagMode`** (`true`) — whether the project ships changes behind release
  flags. Set it explicitly, as the factory option `feature({ flagMode: false })`
  (or `--var flagMode=false`, `GTD_FLAGMODE=false`); gtd never detects it. Any
  value but `true` or `false` refuses the landing that would start the process.
  Off, for a project that is not publicly released: no `seam.judge` or
  `refactor.*` step runs; after design `seam.naive` and `seam.check` run as on,
  and the vetted pass lands as the implementation (`implement.applying`, no
  build turn, no release flag), then the health loop, `implement.coverage`,
  `implement.closing` and the quality lap, as on. A feedback lap asks for no
  flag either. With `GTD_FLAG_RISK_TIER` on, the tier is still asked for and
  recorded, but no longer decides the flag. Pinned at process start; a process
  started before gtd knew `flagMode` reads it live, so leave it on until such a
  process is finished.
- **`flag_risk_tier`** (`0`) — `1` when `GTD_FLAG_RISK_TIER` is on, recorded at
  process start. Not a factory option; `--var flag_risk_tier=1` is the only
  override. Off, no tier is asked for and no commit carries a `Gtd-Mark:`. See
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
  the prompt; in `feature` each finding is then
  [triaged](#the-triaged-quality-lap), elsewhere every finding any lens writes,
  blocking or not, is fixed by the one fix turn. An entry may carry a model
  hint, `<lens>=<model>` (split at the first `=`, both sides trimmed; a blank
  hint is none): `test-audit=smart` runs that lens on `smart`. A lens without
  one runs on `coderModel` when it is `conventions`, `ponytail-review` or
  `test-audit`, else on `plannerModel`. The hint is no part of the lens's name:
  its scope stays `build.quality.<lens>`. See
  [Setup](./setup.md#extending-the-quality-review-lap).
- **`refactorQualityReviews`** (`correctness, ponytail-review, conventions`) —
  the quality lap the refactor review runs, one turn per comma-separated lens,
  as `qualityReviews` does for the feature slice. `qualityReviews` does not
  reach it, and a lens left out never sees the refactor (the feature lap reviews
  from the refactor's sign-off); blank runs no refactor quality lap. Each lens
  is its own scope, keyed `refactor.build.quality.<lens>`. Entries take the same
  `<lens>=<model>` hints, read from this list alone.
- **`continuations`** (`3`) — per phase (naive pass, refactor, build), how many
  [continuations](#continuations) run before a turn that still stops at its
  context limit rests at `<phase>.oversized`. A whole number, `0` or more;
  anything else refuses the landing that reaches it.
- **`continuationStall`** (`2`) — how many continuations in a row may close
  nothing still open before the phase rests at `<phase>.oversized`. A whole
  number, `1` or more.
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
  deliverable: `.gtd/REQUIREMENTS.md` and `.gtd/REVIEW.md`.
- **A format contract** follows it for machine-read files: the format contract
  (headings, checkbox rows, marker lines) outranks the voice, and a violation
  refuses the turn. It is injected at the steps whose output a parser reads
  (`design.triage`, `build.review.reviewing`, `build.review.collecting`).

Files a script writes carry no injected voice: `.gtd/FEEDBACK.md` holds verbatim
test output plus a HEAD stamp.

### Escalation

A red suite that stays red past three fix turns (four while it makes progress,
below) — or that `health.judge` calls "identical" to the previous round —
escalates instead of retrying forever, counting escalation rounds since the last
green check:

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

When `health.judge` calls the round that reaches the cap "progress" — still red,
but closer to green — with at least `judgeIdenticalMinP` confidence, one more
fix turn runs first; the round after it escalates without asking the judge. The
extra turn comes once per run of fix turns, so each escalation stop starts a run
with its own. It never applies when the budget cut either report or one of them
was empty. A "new-failure" verdict never escalates early.

A round is one `health.describe` turn since the last green check; editing the
file at the human gate never spends one. Both gates release straight into the
caller's fix step (`build.fix` or `implement.fix.suite.fixing`), so the turn
that consumes the document is the very next one. `.gtd/ESCALATION.md` is
free-form prose with no mode of its own.

**Upgrading:** finish or `gtd abandon` any process whose history has a
`health.judge` landing that answered "progress", at `judgeIdenticalMinP`
confidence, on the round reaching the cap, even if it has moved on since: that
landing now leads to an extra fix turn, so its history no longer replays. A
`gtd.config.ts` calling `healthy` from `@pmelab/gtd/workflow-kit` passes
`compare` in place of `sameFailure`, resolving `"identical"` where it resolved
`true`, `"progress"` for a round closer to green, or `undefined`.

### Re-check before a person

No red check reaches a person without running once more. Before escalating, the
health loop re-runs the suite as `health.recheck`; a red baseline gate
(`start-gate`, `review-gate`, `rollout`'s `suite`) re-runs it as
`<gate>.recheck` before resting at `<gate>.blocked`. No judge is asked. Green on
the re-run continues as if the check had passed, and that landing carries
`Gtd-Mark: flaky=<check>` (`health.check`, or `<gate>.check`), which
`gtd history metrics` counts under the re-check's full step name. A green
re-check also resets the escalation rounds, as any green check does. Red again
escalates or rests as above.

**Upgrading:** finish or `gtd abandon` any process whose history has ever
escalated (reached `*.health.describe` or `*.health.exhausted`) or rested at a
`*.blocked` gate, even if it has moved on since: its history no longer replays,
since a re-check now comes first.

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

## Reviving skipped tests

The bundled `tests` workflow revives skipped tests, or proposes their deletion.
Export it from `gtd.config.ts`
(`export { tests } from "@pmelab/gtd/workflows/tests"`) and start it:

```bash
gtd door tests
```

`gtd --workflow tests` starts the same process. In order:

1. `tests-gate.check` runs `testCommand`; a red suite rests at
   `tests-gate.blocked`.
2. `tests.sweeping`: an agent, told every skipped test gtd found (`path:line`),
   audits the whole suite with the `test-audit` skill and writes `.gtd/TESTS.md`
   — `# Tests`, then one `## <path>` section per test file that needs work.
   Every file with a skipped test needs a section, and every section must name a
   file in the tree. Writing nothing ends the process.
3. `tests.rewriting`, once per section: the file's tests are rewritten until
   none is skipped, then `tests.health.check` (the shared health loop) keeps the
   suite green. A test the agent calls obsolete stays skipped and gets a
   `## <title>` section in `.gtd/RETIRE.md` naming its file and why it should go
   — one section per test left skipped. A file needing no change may land an
   empty turn.
4. `tests.closing` removes both files, and `.gtd/REVIEW.md` holds one chunk per
   proposal, ending in three boxes:

   ```markdown
   Tick exactly one:

   - [ ] delete it
   - [ ] keep it skipped
   - [ ] _your answer_
   ```

   The review (`build.review.await-review`, no quality lap) refuses every
   landing until each proposal holds exactly one tick. `delete it` has the nit
   fixer delete the test, then the suite runs and the review comes back;
   `keep it skipped` is dropped and recorded as `Gtd-Mark: wontfix=<title>`; an
   own answer is judged like any review note.

Only a person deletes a test: the sweep, the rewrites and their fix turns are
refused when they delete a test file. A person at the health loop's escalation
rests is not checked.

Two factory options say what a skipped test is; each is also a process setting
(`--var`, `GTD_<NAME>`):

- `testFiles` — comma-separated globs of the files scanned, default
  `**/*.test.*, **/*.spec.*, **/*.feature, **/tests/**, **/test/**, **/__tests__/**`.
- `skipPattern` — a regular expression tested against each line, default: a line
  opening with `.skip`/`.todo` on
  `describe`/`context`/`suite`/`it`/`test`/`specify`, with
  `xdescribe(`/`xit(`/…, or with a tag line holding `@skip` or `@ignore`.

```ts
import { tests as shipped } from "@pmelab/gtd/workflows/tests"
export const tests = shipped({
  testFiles: "tests/test_*.py",
  skipPattern: "@pytest\\.mark\\.skip\\b",
})
```

Refusals, each exiting non-zero with the text on stderr:

| Text                                                                                                             | When                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `gtd: <file> is left over — finish or remove it first.`                                                          | `.gtd/REQUIREMENTS.md`, `.gtd/TESTS.md` or `.gtd/RETIRE.md` at start           |
| `gtd: skipPattern must not be blank`, `… is not a valid regular expression`, `… must not match the empty string` | an unusable `skipPattern`                                                      |
| `gtd land: tests: in .gtd/TESTS.md, <faults>`                                                                    | a section names no file, or a file with a skipped test has none                |
| `gtd land: tests: <path>:<line> still skipped — revive it, or propose …`                                         | a rewritten file keeps more skips than `.gtd/RETIRE.md` has sections naming it |
| `gtd land: tests: <paths> deleted — a test goes only once a person ticks …`                                      | a sweep, rewrite or fix turn deleted a test file                               |

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
