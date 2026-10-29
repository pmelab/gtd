# Testing a workflow

`@pmelab/gtd/testkit` runs a workflow against gtd's real engine in an in-memory
repository: no git, no shell, no agent. Scripted actors stand in for the agent,
the checks and the judge, and the test inspects where the process rests, what it
committed and what the tree holds.

The testkit imports no test runner. Use it from `node:test`, vitest, or any
other runner, with that runner's assertions. Gherkin steps are an opt-in:
[`@pmelab/gtd/testkit/gherkin`](#gherkin-steps).

## Install

The testkit runs its own copy of the engine, so install the version of the gtd
that runs your workflow:

```sh
npm install --save-dev @pmelab/gtd@"$(gtd version)"
```

A test passing against one version says nothing about another.

## A complete workflow test

A workflow and its test, run with `node:test` (Node 22.18 or newer runs the
TypeScript as is):

```ts
// workflow.ts
import { agent, check, human, read } from "@pmelab/gtd/flows"

export const calculator = async (): Promise<void> => {
  await agent("plan", "Write PLAN.md.")
  await agent("build", `Build what PLAN.md says:\n${read("PLAN.md") ?? ""}`)
  const green = await check("test", "npm test", { report: ".gtd/FEEDBACK.md" })
  if (!green) await agent("repair", "Make the suite pass.")
  await human("sign-off")
}

export default calculator
```

```ts
// workflow.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { runsItsScript, testRepo } from "@pmelab/gtd/testkit"
import * as workflow from "./workflow.ts"

test("a plan is built, checked and handed to a human", async () => {
  const repo = testRepo({ workflow, commands: [{ run: "npm test" }] })
  repo.write("IDEA.md", "a calculator\n")

  const rest = await repo.drive({
    plan: (_, r) => r.write("PLAN.md", "add two numbers\n"),
    build: (beat, r) => {
      assert.match(beat.content, /add two numbers/)
      r.write(
        "src/add.ts",
        "export const add = (a: number, b: number) => a + b\n",
      )
    },
    test: runsItsScript,
  })

  assert.equal(rest.state, "sign-off")
  assert.deepEqual(repo.subjects().slice(-3), [
    "gtd(agent): plan → build",
    "gtd(agent): build → test",
    "gtd(check): test → sign-off",
  ])
})
```

```bash
node --test workflow.test.ts
```

## Driving a workflow

`testRepo({ workflow, files, env, commands, modules, ambientFlags })` creates
the repository:

- `workflow` — the workflow module, as the test imported it. Its exports are
  read as a `gtd.config.ts`'s would be: the default export starts on a change in
  the tree, every exported function is startable by name. A
  `{ default: feature({ … }) }` object works too.
- `files` — committed with the config before anything runs.
- `env` — the environment gtd sees. The real `process.env` is never read, except
  `GTD_FLAG_*`. `repo.setEnv(name, value)` changes a variable from gtd's next
  call on, mid-process included; `undefined` unsets it.
- `ambientFlags` — `false` keeps the runner's `GTD_FLAG_*` out too, so gtd sees
  `env` alone. Defaults to `true`.
- `commands` — the programs a step's script may run; see
  [Canned commands](#canned-commands).
- `modules` — modules a config given as source imports by specifier; see
  [A config as source](#a-config-as-source).

`repo.drive(actors)` runs the process beat by beat, as a driver would, and
returns the beat it rests at: the first step without an actor, or a stall. An
actor is keyed by the step's full name and gets the beat and the repository:

- at an agent, check or human step, it edits the tree (`r.write`, `r.remove`),
  and the beat lands;
- at a judge step, it returns the verdict: `verdict({ … })`, or a JSON string;
- `runsItsScript` runs the step's own script: file moves, copies and removals
  run in memory, and every other command runs as canned.

An actor's type is `ScriptedActor` (`Actor` is its deprecated name). The beat is
a `BeatDocument`, what `gtd next --json` prints; the testkit re-exports the type
from `@pmelab/gtd/wire`:

```ts
import type { BeatDocument, ScriptedActor } from "@pmelab/gtd/testkit"
```

`repo.drive(actors, { maxBeats })` gives up after `maxBeats` beats (50 by
default) and fails, listing the steps it passed through — a workflow that loops
without resting fails the test instead of hanging it.

`repo.drive(actors, { checks: "run" })` runs a check step without an actor as
`runsItsScript` would, its commands canned.

`repo.drive(actors, { strict: true })` fails where a lenient drive lets a
mistake pass:

- an actor whose step the drive never reached;
- a check step without an actor (unless `checks: "run"`);
- a human step whose actor changes nothing — the drive would repeat it until
  `maxBeats`;
- an actor returning a verdict anywhere but at a judge step.

### Composing actors

```ts
import { inTurn, verdict, verdictWhen, whenPrompted } from "@pmelab/gtd/testkit"

const rest = await repo.drive({
  build: inTurn([
    whenPrompted("add two numbers", (_, r) => r.write("src/add.ts", "…\n")),
    whenPrompted("subtract", (_, r) => r.write("src/sub.ts", "…\n")),
  ]),
  ready: inTurn([
    verdictWhen("Is the plan ready?", verdict({ ready: true })),
    verdictWhen("Is the build ready?", verdict({ ready: false })),
  ]),
})
```

- `whenPrompted(text, actor)` runs `actor` only at a visit whose beat content
  contains `text`; any other visit changes nothing.
- `inTurn(actors)` runs every actor in order, at every visit; the first verdict
  any of them returns is the result.
- `verdictWhen(text, verdict)` answers `verdict` when the judge's pending
  questions, as `gtd judge` prints them, contain `text`.

### Where a drive rests

- **A step without an actor.** `rest.state` is its name, `rest.actor` who acts
  there. A judge step without an actor rests too, as a `message` beat.
- **A stall.** An agent actor that changes nothing lands one empty attempt, and
  the drive returns a beat whose `kind` is `stalled` — unless the step sets
  `allowEmpty`.
- **Idle.** When no process is underway — before the first start, or after the
  flow returns — the beat has `idle: true` and names the default workflow's
  first step. With an actor for that step, the drive starts a new process there,
  so a test that drives past the end of a flow leaves that step without one.

### A human step

A human step is scripted like any other: its actor edits the tree, and the edit
lands as the human's turn. An actor that changes nothing lands nothing, unless
the step sets `acceptClean` — the drive stays at the step and fails once it runs
out of beats. Leave the step without an actor to have the drive rest there.

### A judge's verdict

At a judge step, `rest.judge` holds the pending judgment as a JSON string:
`{ schema, state, questions }`, each question
`{ id, primitive, instructions, criteria }`. The actor returns a verdict, keyed
by question id:

```ts
const rest = await repo.drive({
  ready: () => verdict({ ready: true, tier: { answer: "low", p: 0.6 } }),
})
```

`answer` is a boolean for a `noul` question (read back as `"yes"`/`"no"`), one
of the listed options for a `choice`, a number for a `score`; `p` is between 0
and 1, 0.9 unless given. The actor may instead return the JSON string of an
array with one entry per question,
`JSON.stringify([{ id: "ready", answer: true, p: 0.9 }])`. A verdict that does
not fit the questions fails the drive, echoing what was sent and the shape
expected.

The repository is also driven by hand: `repo.start(name, ...args)`,
`repo.door(name, ...args)`, `repo.land()`, `repo.next()` and
`repo.gtd(...args)`. It is read with `repo.read(path)`, `repo.show(ref, path)`,
`repo.subjects()`, `repo.messages()` and `repo.hashes()`, and changed outside a
process with `repo.write`, `repo.remove` and `repo.commit(message)`.
`repo.commits()` lists every commit, oldest first, as
`{ hash, subject, message, trailers }`; `trailers` maps each trailer of the
message's last paragraph to its values in order:

```ts
const last = repo.commits().at(-1)!
assert.deepEqual(last.trailers["Gtd-Step"], ["build#1"])
```

### Canned commands

Nothing runs a real program. A command a step's script runs — `npm test` under
`check`, or a whole line of a `run` script — runs as the first canned command
whose `run` matches it, exactly or by pattern:

```ts
const repo = testRepo({
  workflow,
  commands: [
    { run: "npm test", exit: 1, output: "1 failing" },
    { run: /^npx oxfmt /, effect: (r) => r.write("src/add.ts", "formatted\n") },
  ],
})
repo.command({ run: "npm run lint" })
```

`exit` defaults to 0 and `output` to nothing; `effect` is what the command does
to the tree. A command none matches fails the script, naming the command.

`repo.runScript(script, { commands })` runs a script with `commands` tried
before the repository's own, for that run only.

### Branches and refs

Before a process starts, or after it ends, the history can be set up:

```ts
repo.branch("feature/x") // at HEAD, or repo.branch(name, ref)
repo.checkout("feature/x") // refuses uncommitted changes
repo.ref("refs/remotes/origin/main") // at HEAD, or repo.ref(name, ref)
repo.branchName() // "feature/x"
```

The default branch is `main`. A remote is its refs: `origin/main` resolves to
`refs/remotes/origin/main`, so a review of `origin/main..HEAD` works. There is
no fetch, push, merge or rebase; a workflow that runs one needs a canned
command.

### A config as source

`workflow` may also be a `gtd.config.ts`'s source as a string. gtd then loads it
the way it loads a repository's config, which is slow, and the config's relative
imports resolve only to files written into the in-memory repository. Pass the
module unless the test is about loading the config itself.

`modules` lets such a config import a module the test imported, by any
specifier:

```ts
import * as workflow from "./index.ts"

const repo = testRepo({
  workflow: `export { feature as default, feature } from "#workflow"\n`,
  modules: { "#workflow": workflow },
})
```

The config's `import` and `export … from` statements naming a specifier in
`modules` read that module; `import type` lines are dropped. Only the config is
rewritten, not files it imports.

## Gherkin steps

`@pmelab/gtd/testkit/gherkin` speaks the testkit as
[quickpickle](https://github.com/dnotes/quickpickle) steps for vitest. Importing
it registers the steps; it also exports their world, `TestkitWorld`, to extend
with steps of your own. It needs `vitest` and `quickpickle`, the package's
optional peer dependencies.

```ts
// vitest.config.ts
import { quickpickle } from "quickpickle"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [quickpickle()],
  test: {
    include: ["*.feature"],
    setupFiles: ["@pmelab/gtd/testkit/gherkin"],
  },
})
```

```gherkin
# calculator.feature
Feature: the calculator workflow

  Scenario: a plan is built, checked and handed to a human
    Given a gtd config from the module "workflow.ts"
    And a file "IDEA.md" with:
      """
      a calculator
      """
    And step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "build" is prompted with "add two numbers"
    And step "build" writes "src/add.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the command "npm test" exits 0
    And step "test" runs its script
    When the process is driven
    Then the process rests at "sign-off"
    And "src/add.ts" contains "a + b"
```

```bash
npx vitest run
```

`a gtd config from the module` takes a path from the directory vitest runs in.
The step wording is public API: a step is renamed only in a major release.

Every actor step for one step name adds to that step's script, run in the order
the scenario gives them. `step "build" is prompted with "…"` is one of them: it
checks the beat, and on its own it scripts the step to change nothing: the drive
does not rest at `build` for the scenario to inspect, it lands an empty attempt
there and stalls. Pair it with a step that writes, as the example above does.

A failed outcome step ends with where the process rests: its step, kind and the
first lines of its content, the last commit subjects, and the actors the
scenario scripted that no drive used.

`the resting step's {word} is {string}` and `… includes {string}` read a field
of the beat document by its dotted path — `model`, `idle`, `skills`,
`access.write`. A string is compared as is, anything else as JSON; `includes`
looks for an element of an array, or a substring of a string.

`with {string}` splits its arguments on spaces; a word in quotes keeps them:
`gtd starts workflow "feature" with "--var 'title=a calculator'"`.

`check step {string} passes` runs the check step's script with every command it
runs exiting 0; `check step {string} fails with:` with every command exiting 1,
printing the text.

### The world

`TestkitWorld` is the scenario's state; a step of your own extends it:

- `world.repo()` — the repository, created on first use;
- `world.configure(config)`, `world.extendConfig(source)`;
- `world.setEnv(name, value)` before the repository exists,
  `world.changeEnv(name, value)` at any time;
- `world.command(canned)`;
- `world.importable(specifier, module)` — what
  `the module {string} is importable as {string}` does;
- `world.act(step, actor)`, `world.rescript(step, actor)`,
  `world.unscript(step)` — queue, replace or drop a step's actors;
- `world.answer(step, verdict)`, `world.answerWhen(step, text, verdict)`;
- `world.drive()`.

Its `actions`, `verdicts` and `conditionalVerdicts` maps are deprecated; use the
methods.

A support file can make the workflow under test importable in every scenario:

```ts
import { Before } from "quickpickle"
import type { TestkitWorld } from "@pmelab/gtd/testkit/gherkin"
import * as workflow from "./index.ts"

Before((world: TestkitWorld) => {
  world.importable("#workflow", workflow)
})
```

### Steps

Setup:

- `a gtd config from the module {string}`
- `a gtd config with:`
- `the gtd config ends with:`
- `an environment variable {string} set to {string}`
- `the environment variable {string} is {string}`
- `from now on the environment variable {string} is {string}`
- `the module {string} is importable as {string}`
- `a file {string} with:`
- `the file {string} is deleted`
- `the text {string} in {string} is replaced with {string}`
- `{string} gets appended:`
- `text is appended to {string}:`
- `the working tree is committed as {string}`
- `the working tree is committed with the message:`
- `the command {string} exits {int}`
- `the command {string} exits {int} with:`
- `the command matching {string} exits {int}`
- `the command matching {string} exits {int} with:`
- `a branch {string}`
- `a branch {string} at {string}`
- `{string} is checked out`
- `the ref {string} points at HEAD`

Actors:

- `step {string} changes nothing`
- `step {string} from now on changes nothing`
- `step {string} is no longer scripted`
- `step {string} writes {string} with:`
- `step {string}, when prompted with {string}, writes {string} with:`
- `step {string} appends to {string}:`
- `step {string} replaces the text {string} in {string} with {string}`
- `step {string} deletes {string}`
- `step {string} is prompted with {string}`
- `step {string} rewrites {string} with:`
- `step {string} overwrites {string}, if it exists, with:`
- `step {string} runs its script`
- `check step {string} passes`
- `check step {string} fails with:`
- `judge step {string} answers:`
- `judge step {string}, when its questions contain {string}, answers:`

Actions:

- `gtd starts workflow {string}`
- `gtd starts workflow {string} with {string}`
- `gtd opens door {string}`
- `gtd opens door {string} with {string}`
- `gtd lands`
- `the process is driven`

Outcomes:

- `opening door {string} is refused with {string}`
- `starting workflow {string} with {string} is refused with {string}`
- `landing is refused with {string}`
- `driving the process is refused with {string}`
- `driving the process is refused without {string}`
- `the process rests at {string}`
- `the process stalls at {string}`
- `the resting step's {word} is {string}`
- `the resting step's {word} includes {string}`
- `the resting step's content contains {string}`
- `the resting step's content contains the hash of the commit {string}`
- `the resting step's content does not contain {string}`
- `the last commit subject is {string}`
- `the commit subjects end with:`
- `the last commit body contains {string}`
- `the commit {string} has a body containing {string}`
- `no commit body contains {string}`
- `the output of gtd {string} contains {string}`
- `the output of gtd {string} does not contain {string}`
- `the output lines of gtd {string} start with:`
- `{string} contains {string}`
- `{string} contains:`
- `{string} contains the short hash of the commit {string}`
- `{string} as committed at {string} contains {string}`
- `{string} contains {string} exactly once`
- `{string} does not contain {string}`
- `{string} does not exist`
