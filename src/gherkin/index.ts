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
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  runsItsScript,
  testRepo,
  type Actor,
  type CannedCommand,
  type TestRepo,
  type WorkflowModule,
} from "../testkit/index.js"
import { assertContains, assertLacks, refusal, refusedWith, restDescription } from "./messages.js"

// Kept off the class so the exported world's type stays as it is.
const usedActors = new WeakMap<TestkitWorld, Set<string>>()

export class TestkitWorld extends QuickPickleWorld {
  // Re-declared: under `nodenext` a subclass loses the base's members from TS's view.
  declare info: QuickPickleWorldInterface["info"]

  constructor(context: TestContext, info: InfoConstructor) {
    super(context, info)
  }

  private gtdConfig: WorkflowModule | undefined = undefined
  private env: Record<string, string> = {}
  private commands: CannedCommand[] = []
  /** Per step, what its scripted actor does, in the order the scenario declared it. */
  actions = new Map<string, Actor[]>()
  verdicts = new Map<string, string>()
  /** Per judge step, a verdict for each text its questions may contain; the first match answers. */
  conditionalVerdicts = new Map<string, [text: string, verdict: string][]>()
  private created: TestRepo | undefined = undefined

  // The repository is created on first use and keeps the config and
  // environment it was created with, so a later change to either is refused
  // rather than silently ignored.
  configure(config: WorkflowModule): void {
    this.assertNotCreated("a gtd config")
    this.gtdConfig = config
  }

  extendConfig(tail: string): void {
    this.assertNotCreated("a gtd config")
    if (this.gtdConfig === undefined) throw new Error("no gtd config to extend")
    if (typeof this.gtdConfig !== "string")
      throw new Error("a gtd config from a module cannot be extended")
    this.gtdConfig += `\n${tail}`
  }

  command(command: CannedCommand): void {
    if (this.created === undefined) this.commands.push(command)
    else this.created.command(command)
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
    return (this.created ??= testRepo({
      workflow: this.gtdConfig,
      env: this.env,
      commands: this.commands,
    }))
  }

  act(step: string, action: Actor): void {
    this.actions.set(step, [...(this.actions.get(step) ?? []), action])
  }

  async drive(): Promise<void> {
    const actors: Record<string, Actor> = {}
    const used = usedActors.get(this) ?? new Set<string>()
    usedActors.set(this, used)
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
    for (const [step, choices] of this.conditionalVerdicts) {
      if (this.actions.has(step) || this.verdicts.has(step)) {
        throw new Error(`step "${step}" has a conditional verdict and another script`)
      }
      // Matched against the pending questions, which `gtd judge` prints and the beat does not.
      actors[step] = async (_, repo) => {
        const { stdout } = await repo.gtd("judge")
        const hit = choices.find(([text]) => stdout.includes(text))
        if (hit === undefined)
          throw new Error(`judge step "${step}" matched no verdict:\n${stdout}`)
        return hit[1]
      }
    }
    const tracked: Record<string, Actor> = {}
    for (const [step, actor] of Object.entries(actors)) {
      tracked[step] = (beat, repo) => {
        used.add(step)
        return actor(beat, repo)
      }
    }
    await this.repo().drive(tracked)
  }
}

setWorldConstructor(TestkitWorld)

const withNewline = (content: string): string => (content.endsWith("\n") ? content : `${content}\n`)

const args = (list: string): string[] => list.split(" ").filter((arg) => arg !== "")

const neverUsed = (world: TestkitWorld): string[] => {
  const used = usedActors.get(world) ?? new Set<string>()
  const scripted = new Set([
    ...world.actions.keys(),
    ...world.verdicts.keys(),
    ...world.conditionalVerdicts.keys(),
  ])
  return [...scripted].filter((step) => !used.has(step))
}

/** An outcome step: a failure ends with where the process rests. */
const outcome =
  <A extends unknown[]>(check: (world: TestkitWorld, ...rest: A) => unknown) =>
  async (world: TestkitWorld, ...rest: A): Promise<void> => {
    try {
      await check(world, ...rest)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      failure.message += `\n\n${await restDescription(() => world.repo(), neverUsed(world))}`
      throw failure
    }
  }

Given("a gtd config with:", (world: TestkitWorld, source: string) => {
  world.configure(withNewline(source))
})

// Imported by the test runner itself, from the working directory: the module and
// the engine share one `@pmelab/gtd/flows`, and a config source string could
// import only files written into the in-memory repository.
Given("a gtd config from the module {string}", async (world: TestkitWorld, path: string) => {
  world.configure({ ...(await import(pathToFileURL(resolve(path)).href)) })
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

Given("the command {string} exits {int}", (world: TestkitWorld, run: string, exit: number) => {
  world.command({ run, exit })
})

Given(
  "the command {string} exits {int} with:",
  (world: TestkitWorld, run: string, exit: number, output: string) => {
    world.command({ run, exit, output: withNewline(output) })
  },
)

Given("a branch {string}", (world: TestkitWorld, name: string) => {
  world.repo().branch(name)
})

Given("{string} is checked out", (world: TestkitWorld, name: string) => {
  world.repo().checkout(name)
})

Given("the ref {string} points at HEAD", (world: TestkitWorld, name: string) => {
  world.repo().ref(name)
})

Given("a file {string} with:", (world: TestkitWorld, path: string, content: string) => {
  world.repo().write(path, withNewline(content))
})

Given("the file {string} is deleted", (world: TestkitWorld, path: string) => {
  world.repo().remove(path)
})

// A human's edit in place, so a scenario need not restate a file gtd wrote.
Given(
  "the text {string} in {string} is replaced with {string}",
  (world: TestkitWorld, text: string, path: string, replacement: string) => {
    const content = world.repo().read(path) ?? ""
    assert.ok(content.includes(text), `${path}: ${content}`)
    world.repo().write(
      path,
      content.replace(text, () => replacement),
    )
  },
)

Given("{string} gets appended:", (world: TestkitWorld, path: string, text: string) => {
  const content = world.repo().read(path) ?? ""
  world.repo().write(path, `${content.trimEnd()}\n\n${text}\n`)
})

Given("the working tree is committed as {string}", (world: TestkitWorld, message: string) => {
  world.repo().commit(message)
})

Given("the working tree is committed with the message:", (world: TestkitWorld, message: string) => {
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

// Lets one step write differently per visit, told apart by what it is prompted with.
Given(
  "step {string}, when prompted with {string}, writes {string} with:",
  (world: TestkitWorld, step: string, text: string, path: string, content: string) => {
    world.act(step, (beat, repo) => {
      if (beat.content.includes(text)) repo.write(path, withNewline(content))
    })
  },
)

Given(
  "step {string} appends to {string}:",
  (world: TestkitWorld, step: string, path: string, text: string) => {
    world.act(step, (_, repo) => {
      repo.write(path, `${(repo.read(path) ?? "").trimEnd()}\n\n${withNewline(text)}`)
    })
  },
)

// An agent's edit in place, keeping whatever gtd wrote around it.
Given(
  "step {string} replaces the text {string} in {string} with {string}",
  (world: TestkitWorld, step: string, text: string, path: string, replacement: string) => {
    world.act(step, (_, repo) => {
      const content = repo.read(path) ?? ""
      assert.ok(content.includes(text), `${path}: ${content}`)
      repo.write(
        path,
        content.replace(text, () => replacement),
      )
    })
  },
)

Given("step {string} deletes {string}", (world: TestkitWorld, step: string, path: string) => {
  world.act(step, (_, repo) => repo.remove(path))
})

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

// A closing step deletes the file before its collecting turn runs, so this edit
// leaves a closed turn changing nothing while still answering an in-gate one.
Given(
  "step {string} rewrites {string} with:",
  (world: TestkitWorld, step: string, path: string, content: string) => {
    world.act(step, (_, repo) => {
      if (repo.read(path) !== undefined) repo.write(path, withNewline(content))
    })
  },
)

Given("step {string} runs its script", (world: TestkitWorld, step: string) => {
  world.act(step, runsItsScript)
})

Given("judge step {string} answers:", (world: TestkitWorld, step: string, verdict: string) => {
  world.verdicts.set(step, String(verdict))
})

Given(
  "judge step {string}, when its questions contain {string}, answers:",
  (world: TestkitWorld, step: string, text: string, verdict: string) => {
    world.conditionalVerdicts.set(step, [
      ...(world.conditionalVerdicts.get(step) ?? []),
      [text, String(verdict)],
    ])
  },
)

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
  outcome(async (world, door: string, message: string) => {
    await refusedWith(world.repo().door(door), message)
  }),
)

Then(
  "starting workflow {string} with {string} is refused with {string}",
  outcome(async (world, workflow: string, list: string, message: string) => {
    await refusedWith(world.repo().start(workflow, ...args(list)), message)
  }),
)

Then(
  "landing is refused with {string}",
  outcome(async (world, message: string) => {
    await refusedWith(world.repo().land(), message)
  }),
)

Then(
  "driving the process is refused with {string}",
  outcome(async (world, message: string) => {
    await refusedWith(world.drive(), message)
  }),
)

Then(
  "driving the process is refused without {string}",
  outcome(async (world, message: string) => {
    const got = await refusal(world.drive(), `without "${message}"`)
    if (got.includes(message))
      assert.fail(`expected a refusal without "${message}", but it was refused with:\n${got}`)
  }),
)

Then(
  "the process rests at {string}",
  outcome(async (world, step: string) => {
    assert.strictEqual((await world.repo().next()).state, step)
  }),
)

Then(
  "the resting step's content contains {string}",
  outcome(async (world, text: string) => {
    assertContains("the resting step's content", text, (await world.repo().next()).content)
  }),
)

Then(
  "the resting step's content contains the hash of the commit {string}",
  outcome(async (world, subject: string) => {
    const repo = world.repo()
    const hash = repo.hashes()[repo.subjects().lastIndexOf(subject)]
    assert.ok(hash !== undefined, `no commit "${subject}"`)
    assertContains("the resting step's content", hash, (await repo.next()).content)
  }),
)

Then(
  "the resting step's content does not contain {string}",
  outcome(async (world, text: string) => {
    assertLacks("the resting step's content", text, (await world.repo().next()).content)
  }),
)

Then(
  "the last commit subject is {string}",
  outcome((world, subject: string) => {
    assert.strictEqual(world.repo().subjects().at(-1), subject)
  }),
)

Then(
  "the commit subjects end with:",
  outcome((world, list: string) => {
    const expected = list.split("\n").filter((line) => line.trim() !== "")
    assert.deepStrictEqual(world.repo().subjects().slice(-expected.length), expected)
  }),
)

const outputOf = async (world: TestkitWorld, list: string): Promise<string> => {
  const result = await world.repo().gtd(...args(list))
  assert.strictEqual(result.exitCode, 0, result.stderr)
  return result.stdout
}

Then(
  "the output of gtd {string} contains {string}",
  outcome(async (world, list: string, text: string) => {
    assertContains(`the output of gtd ${list}`, text, await outputOf(world, list))
  }),
)

Then(
  "the output of gtd {string} does not contain {string}",
  outcome(async (world, list: string, text: string) => {
    assertLacks(`the output of gtd ${list}`, text, await outputOf(world, list))
  }),
)

Then(
  "the output lines of gtd {string} start with:",
  outcome(async (world, list: string, prefixes: string) => {
    const out = (await outputOf(world, list)).split("\n").filter((line) => line !== "")
    const expected = prefixes.split("\n").filter((line) => line.trim() !== "")
    const sides = `expected lines starting with:\n${expected.join("\n")}\ngot:\n${out.join("\n")}`
    assert.strictEqual(out.length, expected.length, sides)
    out.forEach((line, i) => assert.ok(line.startsWith(expected[i]!), sides))
  }),
)

Then(
  "{string} contains {string}",
  outcome((world, path: string, text: string) => {
    assertContains(`"${path}"`, text, world.repo().read(path))
  }),
)

Then(
  "{string} contains:",
  outcome((world, path: string, text: string) => {
    assertContains(`"${path}"`, text, world.repo().read(path))
  }),
)

Then(
  "{string} contains the short hash of the commit {string}",
  outcome((world, path: string, subject: string) => {
    const repo = world.repo()
    const hash = repo.hashes()[repo.subjects().lastIndexOf(subject)]
    assert.ok(hash !== undefined, `no commit "${subject}"`)
    assertContains(`"${path}"`, hash.slice(0, 7), repo.read(path))
  }),
)

Then(
  "{string} contains {string} exactly once",
  outcome((world, path: string, text: string) => {
    const content = world.repo().read(path) ?? ""
    const times = content.split(text).length - 1
    assert.strictEqual(
      times,
      1,
      `"${path}" contains "${text}" ${times} times; it holds:\n${content}`,
    )
  }),
)

Then(
  "{string} does not contain {string}",
  outcome((world, path: string, text: string) => {
    assertLacks(`"${path}"`, text, world.repo().read(path))
  }),
)

Then(
  "{string} does not exist",
  outcome((world, path: string) => {
    const content = world.repo().read(path)
    assert.strictEqual(content, undefined, `"${path}" exists; it holds:\n${content}`)
  }),
)
