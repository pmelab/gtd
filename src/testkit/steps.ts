// Generic quickpickle steps over `testRepo`: they name no workflow, so any
// workflow's `.feature` can use them. A workflow's own steps live beside it.
import {
  Given,
  QuickPickleWorld,
  Then,
  When,
  setWorldConstructor,
  type InfoConstructor,
  type QuickPickleWorldInterface,
} from "quickpickle"
import assert from "node:assert"
import type { TestContext } from "vitest"
import { runsItsScript, testRepo, type Actor, type TestRepo } from "./TestRepo.js"

export class TestkitWorld extends QuickPickleWorld {
  // Re-declared: under `nodenext` a subclass loses the base's members from TS's view.
  declare info: QuickPickleWorldInterface["info"]

  constructor(context: TestContext, info: InfoConstructor) {
    super(context, info)
  }

  private gtdConfig: string | undefined = undefined
  private env: Record<string, string> = {}
  /** Per step, what its scripted actor does, in the order the scenario declared it. */
  actions = new Map<string, Actor[]>()
  verdicts = new Map<string, string>()
  private created: TestRepo | undefined = undefined

  // The repository is created on first use and keeps the config and
  // environment it was created with, so a later change to either is refused
  // rather than silently ignored.
  configure(config: string): void {
    this.assertNotCreated("a gtd config")
    this.gtdConfig = config
  }

  extendConfig(tail: string): void {
    this.assertNotCreated("a gtd config")
    if (this.gtdConfig === undefined) throw new Error("no gtd config to extend")
    this.gtdConfig += `\n${tail}`
  }

  setEnv(name: string, value: string): void {
    this.assertNotCreated(`the environment variable ${name}`)
    this.env[name] = value
  }

  private assertNotCreated(what: string): void {
    if (this.created !== undefined) {
      throw new Error(`${what} must be set before any step that touches the repository`)
    }
  }

  repo(): TestRepo {
    if (this.gtdConfig === undefined)
      throw new Error("no gtd config: add a `gtd config` step first")
    return (this.created ??= testRepo({ workflow: this.gtdConfig, env: this.env }))
  }

  act(step: string, action: Actor): void {
    this.actions.set(step, [...(this.actions.get(step) ?? []), action])
  }

  async drive(): Promise<void> {
    const actors: Record<string, Actor> = {}
    for (const [step, actions] of this.actions) {
      actors[step] = async (beat, repo) => {
        for (const action of actions) await action(beat, repo)
      }
    }
    for (const [step, verdict] of this.verdicts) {
      // A verdict would overwrite the queued actions, silently skipping their checks.
      if (this.actions.has(step)) {
        throw new Error(
          `step "${step}" has a judge verdict and queued actions; the actions would never run`,
        )
      }
      actors[step] = () => verdict
    }
    await this.repo().drive(actors)
  }
}

setWorldConstructor(TestkitWorld)

const withNewline = (content: string): string => (content.endsWith("\n") ? content : `${content}\n`)

const args = (list: string): string[] => list.split(" ").filter((arg) => arg !== "")

Given("a gtd config with:", (world: TestkitWorld, source: string) => {
  world.configure(withNewline(source))
})

Given("the gtd config ends with:", (world: TestkitWorld, source: string) => {
  world.extendConfig(withNewline(source))
})

Given(
  "an environment variable {string} set to {string}",
  (world: TestkitWorld, name: string, value: string) => {
    world.setEnv(name, value)
  },
)

Given("a file {string} with:", (world: TestkitWorld, path: string, content: string) => {
  world.repo().write(path, withNewline(content))
})

Given("the working tree is committed as {string}", (world: TestkitWorld, message: string) => {
  world.repo().commit(message)
})

Given("step {string} changes nothing", (world: TestkitWorld, step: string) => {
  world.act(step, () => undefined)
})

// Unlike `changes nothing`, this drops every action already queued for the step.
Given("step {string} from now on changes nothing", (world: TestkitWorld, step: string) => {
  world.actions.set(step, [() => undefined])
})

// Lets a later visit rest at a step an earlier one had scripted.
Given("step {string} is no longer scripted", (world: TestkitWorld, step: string) => {
  world.actions.delete(step)
})

Given(
  "step {string} writes {string} with:",
  (world: TestkitWorld, step: string, path: string, content: string) => {
    world.act(step, (_, repo) => repo.write(path, withNewline(content)))
  },
)

// A standing assertion like any queued action: it applies on every later visit
// to the step until `from now on` clears the list.
Given(
  "step {string} is prompted with {string}",
  (world: TestkitWorld, step: string, text: string) => {
    world.act(step, (beat) => {
      if (!beat.content.includes(text)) {
        throw new Error(`step "${step}" was not prompted with "${text}":\n${beat.content}`)
      }
    })
  },
)

Given("step {string} runs its script", (world: TestkitWorld, step: string) => {
  world.act(step, runsItsScript)
})

Given("judge step {string} answers:", (world: TestkitWorld, step: string, verdict: string) => {
  world.verdicts.set(step, String(verdict))
})

When("gtd starts workflow {string}", async (world: TestkitWorld, workflow: string) => {
  await world.repo().start(workflow)
})

When(
  "gtd starts workflow {string} with {string}",
  async (world: TestkitWorld, workflow: string, list: string) => {
    await world.repo().start(workflow, ...args(list))
  },
)

When("gtd opens door {string}", async (world: TestkitWorld, door: string) => {
  await world.repo().door(door)
})

When(
  "gtd opens door {string} with {string}",
  async (world: TestkitWorld, door: string, list: string) => {
    await world.repo().door(door, ...args(list))
  },
)

When("gtd lands", async (world: TestkitWorld) => {
  await world.repo().land()
})

When("the process is driven", async (world: TestkitWorld) => {
  await world.drive()
})

Then(
  "opening door {string} is refused with {string}",
  async (world: TestkitWorld, door: string, message: string) => {
    await assert.rejects(world.repo().door(door), (error: Error) => error.message.includes(message))
  },
)

Then(
  "starting workflow {string} with {string} is refused with {string}",
  async (world: TestkitWorld, workflow: string, list: string, message: string) => {
    await assert.rejects(world.repo().start(workflow, ...args(list)), (error: Error) =>
      error.message.includes(message),
    )
  },
)

Then(
  "driving the process is refused with {string}",
  async (world: TestkitWorld, message: string) => {
    await assert.rejects(world.drive(), (error: Error) => error.message.includes(message))
  },
)

Then("the process rests at {string}", async (world: TestkitWorld, step: string) => {
  assert.strictEqual((await world.repo().next()).state, step)
})

Then("the resting step's content contains {string}", async (world: TestkitWorld, text: string) => {
  const { content } = await world.repo().next()
  assert.ok(content.includes(text), content)
})

Then(
  "the resting step's content contains the hash of the commit {string}",
  async (world: TestkitWorld, subject: string) => {
    const repo = world.repo()
    const hash = repo.hashes()[repo.subjects().lastIndexOf(subject)]
    assert.ok(hash !== undefined, `no commit "${subject}"`)
    const { content } = await repo.next()
    assert.ok(content.includes(hash), content)
  },
)

Then(
  "the resting step's content does not contain {string}",
  async (world: TestkitWorld, text: string) => {
    const { content } = await world.repo().next()
    assert.ok(!content.includes(text), content)
  },
)

Then("the last commit subject is {string}", (world: TestkitWorld, subject: string) => {
  assert.strictEqual(world.repo().subjects().at(-1), subject)
})

Then("the commit subjects end with:", (world: TestkitWorld, list: string) => {
  const expected = list.split("\n").filter((line) => line.trim() !== "")
  assert.deepStrictEqual(world.repo().subjects().slice(-expected.length), expected)
})

const outputOf = async (world: TestkitWorld, list: string): Promise<string> => {
  const result = await world.repo().gtd(...args(list))
  assert.strictEqual(result.exitCode, 0, result.stderr)
  return result.stdout
}

Then(
  "the output of gtd {string} contains {string}",
  async (world: TestkitWorld, list: string, text: string) => {
    const out = await outputOf(world, list)
    assert.ok(out.includes(text), out)
  },
)

Then(
  "the output of gtd {string} does not contain {string}",
  async (world: TestkitWorld, list: string, text: string) => {
    const out = await outputOf(world, list)
    assert.ok(!out.includes(text), out)
  },
)

Then(
  "the output lines of gtd {string} start with:",
  async (world: TestkitWorld, list: string, prefixes: string) => {
    const out = (await outputOf(world, list)).split("\n").filter((line) => line !== "")
    const expected = prefixes.split("\n").filter((line) => line.trim() !== "")
    assert.strictEqual(out.length, expected.length, out.join("\n"))
    out.forEach((line, i) => assert.ok(line.startsWith(expected[i]!), out.join("\n")))
  },
)

Then("{string} contains {string}", (world: TestkitWorld, path: string, text: string) => {
  assert.ok(world.repo().read(path)?.includes(text), `${path}: ${world.repo().read(path)}`)
})

Then("{string} does not contain {string}", (world: TestkitWorld, path: string, text: string) => {
  const content = world.repo().read(path)
  assert.ok(content !== undefined && !content.includes(text), `${path}: ${content}`)
})

Then("{string} does not exist", (world: TestkitWorld, path: string) => {
  assert.strictEqual(world.repo().read(path), undefined)
})
