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
import { agent, human, read, run } from "@pmelab/gtd/flows"

export const calculator = async (): Promise<void> => {
  await agent("plan", "Write PLAN.md.")
  await agent("build", `Build what PLAN.md says:\n${read("PLAN.md") ?? ""}`)
  await run("check", "npm test > .gtd/FEEDBACK.md 2>&1 && rm .gtd/FEEDBACK.md")
  if (read(".gtd/FEEDBACK.md") !== undefined)
    await agent("repair", "Make the suite pass.")
  await human("sign-off")
}

export default calculator
```

```ts
// workflow.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { testRepo } from "@pmelab/gtd/testkit"
import * as workflow from "./workflow.ts"

test("a plan is built, checked and handed to a human", async () => {
  const repo = testRepo({ workflow })
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
    check: () => undefined,
  })

  assert.equal(rest.state, "sign-off")
  assert.deepEqual(repo.subjects().slice(-3), [
    "gtd(agent): plan → build",
    "gtd(agent): build → check",
    "gtd(check): check → sign-off",
  ])
})
```

```bash
node --test workflow.test.ts
```

## Driving a workflow

`testRepo({ workflow, files, env })` creates the repository:

- `workflow` — the workflow module, as the test imported it. Its exports are
  read as a `gtd.config.ts`'s would be: the default export starts on a change in
  the tree, every exported function is startable by name. A
  `{ default: feature({ … }) }` object works too.
- `files` — committed with the config before anything runs.
- `env` — the environment gtd sees. The real `process.env` is never read, except
  `GTD_FLAG_*`.

`repo.drive(actors)` runs the process beat by beat, as a driver would, and
returns the beat it rests at: the first step without an actor, or a human step.
An actor is keyed by the step's full name and gets the beat and the repository:

- at an agent or check step, it edits the tree (`r.write`, `r.remove`), and the
  beat lands;
- at a judge step, it returns the verdict as a JSON string;
- `runsItsScript` runs the step's own script, for steps that only move, copy or
  remove files.

A step whose script runs anything else (a test suite, a formatter) needs an
actor that stands in for it.

The repository is also driven by hand: `repo.start(name, ...args)`,
`repo.door(name, ...args)`, `repo.land()`, `repo.next()` and
`repo.gtd(...args)`. It is read with `repo.read(path)`, `repo.show(ref, path)`,
`repo.subjects()`, `repo.messages()` and `repo.hashes()`, and changed outside a
process with `repo.write`, `repo.remove` and `repo.commit(message)`.

### A config as source

`workflow` may also be a `gtd.config.ts`'s source as a string. gtd then loads it
the way it loads a repository's config, which is slow, and the config's relative
imports resolve only to files written into the in-memory repository. Pass the
module unless the test is about loading the config itself.

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
    And step "check" changes nothing
    When the process is driven
    Then the process rests at "sign-off"
    And "src/add.ts" contains "a + b"
```

```bash
npx vitest run
```

`a gtd config from the module` takes a path from the directory vitest runs in.
The step wording is public API: a step is renamed only in a major release.

### Steps

Setup:

- `a gtd config from the module {string}`
- `a gtd config with:`
- `the gtd config ends with:`
- `an environment variable {string} set to {string}`
- `a file {string} with:`
- `the file {string} is deleted`
- `the text {string} in {string} is replaced with {string}`
- `{string} gets appended:`
- `the working tree is committed as {string}`
- `the working tree is committed with the message:`

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
- `step {string} runs its script`
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
- `the resting step's content contains {string}`
- `the resting step's content contains the hash of the commit {string}`
- `the resting step's content does not contain {string}`
- `the last commit subject is {string}`
- `the commit subjects end with:`
- `the output of gtd {string} contains {string}`
- `the output of gtd {string} does not contain {string}`
- `the output lines of gtd {string} start with:`
- `{string} contains {string}`
- `{string} contains:`
- `{string} contains the short hash of the commit {string}`
- `{string} contains {string} exactly once`
- `{string} does not contain {string}`
- `{string} does not exist`
