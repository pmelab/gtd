// Generic quickpickle steps over `testRepo`: they name no workflow, so any
// workflow's `.feature` can use them. A workflow's own steps live beside it.
import {
  After,
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
  type CannedCommand,
  type DriveOptions,
  type ScriptedActor,
  type TestRepo,
  type WorkflowModule,
} from "../testkit/index.js"
import {
  assertContains,
  assertLacks,
  assertRestsAt,
  refusal,
  refusedWith,
  restDescription,
} from "./messages.js"

export class TestkitWorld extends QuickPickleWorld {
  // Re-declared: under `nodenext` a subclass loses the base's members from TS's view.
  declare info: QuickPickleWorldInterface["info"]

  constructor(context: TestContext, info: InfoConstructor) {
    super(context, info)
  }

  private gtdConfig: WorkflowModule | undefined = undefined
  private env: Record<string, string> = {}
  private commands: CannedCommand[] = []
  private modules: Record<string, Readonly<Record<string, unknown>>> = {}
  private actions = new Map<string, ScriptedActor[]>()
  private verdicts = new Map<string, string>()
  private conditionalVerdicts = new Map<string, [text: string, verdict: string][]>()
  private prompts = new Map<string, string[]>()
  private used = new Set<string>()
  private strictDrives = false
  private refusedDrives = false
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

  /** Unlike `setEnv`, also once the repository exists: gtd sees it from its next call on. */
  changeEnv(name: string, value: string): void {
    if (this.created === undefined) this.env[name] = value
    else this.created.setEnv(name, value)
  }

  /**
   * Lets a config given as source import `module` as `specifier`. A support
   * file may call it for every scenario, e.g. from a `Before` hook.
   */
  importable(specifier: string, module: Readonly<Record<string, unknown>>): void {
    this.assertNotCreated(`the module ${specifier}`)
    this.modules[specifier] = module
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
      modules: this.modules,
    }))
  }

  /** Adds `action` to what `step`'s actor does at every visit. */
  act(step: string, action: ScriptedActor): void {
    this.actions.set(step, [...(this.actions.get(step) ?? []), action])
  }

  /** Drops every action and prompt queued for `step`, leaving `action` alone. */
  rescript(step: string, action: ScriptedActor): void {
    this.actions.set(step, [action])
    this.prompts.delete(step)
  }

  /** Drops every action and prompt queued for `step`, so a drive rests there. */
  unscript(step: string): void {
    this.actions.delete(step)
    this.prompts.delete(step)
  }

  /**
   * `step`'s beat content must contain `text`. A scripted step is checked at
   * every visit, before its actor acts; a step with nothing else scripted is
   * not scripted at all, so a drive rests there and checks it at the rest.
   */
  expectPrompt(step: string, text: string): void {
    this.prompts.set(step, [...(this.prompts.get(step) ?? []), text])
  }

  /** Judge step `step` answers `verdict`, a JSON array. */
  answer(step: string, verdict: string): void {
    this.verdicts.set(step, verdict)
  }

  /** Judge step `step` answers `verdict` when its questions contain `text`; the first match answers. */
  answerWhen(step: string, text: string, verdict: string): void {
    this.conditionalVerdicts.set(step, [
      ...(this.conditionalVerdicts.get(step) ?? []),
      [text, verdict],
    ])
  }

  /** The steps the scenario scripted, or expects a prompt at, that no drive has reached. */
  neverUsed(): string[] {
    const scripted = new Set([
      ...this.actions.keys(),
      ...this.verdicts.keys(),
      ...this.conditionalVerdicts.keys(),
      ...this.prompts.keys(),
    ])
    return [...scripted].filter((step) => !this.used.has(step))
  }

  private checkPrompts(step: string, content: string): void {
    for (const text of this.prompts.get(step) ?? []) {
      if (!content.includes(text))
        throw new Error(`step "${step}" was not prompted with "${text}":\n${content}`)
    }
  }

  private actors(): Record<string, ScriptedActor> {
    const actors: Record<string, ScriptedActor> = {}
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
    return actors
  }

  /**
   * `strict: false` lets what a strict drive refuses pass. A strict drive
   * leaves scripted steps it never reached to `assertReached`: a Background or
   * an earlier step may script one for a later drive.
   */
  async drive(options: DriveOptions = {}): Promise<void> {
    const actors = this.actors()
    const tracked: Record<string, ScriptedActor> = {}
    for (const [step, actor] of Object.entries(actors)) {
      tracked[step] = (beat, repo) => {
        this.used.add(step)
        this.checkPrompts(step, beat.content)
        return actor(beat, repo)
      }
    }
    if (options.strict !== false) this.strictDrives = true
    try {
      const rest = await this.repo().drive(tracked, { ...options, unreachedActors: "pass" })
      if (rest.kind !== "stalled" && this.prompts.has(rest.state) && !(rest.state in actors)) {
        this.used.add(rest.state)
        this.checkPrompts(rest.state, rest.content)
      }
    } catch (error) {
      this.refusedDrives = true
      throw error
    }
  }

  /**
   * Fails on a step the scenario scripted, or expects a prompt at, that no
   * drive reached. Run at scenario end; a scenario with no strict drive, or
   * with a refused one, passes.
   */
  async assertReached(): Promise<void> {
    const never = this.neverUsed()
    if (!this.strictDrives || this.refusedDrives || never.length === 0) return
    throw new Error(
      `strict drive: at scenario end, no drive reached the steps scripted for ${never.map((step) => `"${step}"`).join(", ")} — script a step only for a drive that reaches it\n\n${await restDescription(() => this.repo(), never)}`,
    )
  }
}

// Only for a scenario whose steps all passed: a failed one already reports.
After(async (world: QuickPickleWorldInterface) => {
  if (world instanceof TestkitWorld && world.info.errors.length === 0) await world.assertReached()
})

setWorldConstructor(TestkitWorld)

const withNewline = (content: string): string => (content.endsWith("\n") ? content : `${content}\n`)

// Space-separated; a word that opens with a quote runs to its closing quote,
// spaces included, so `--var 'title=a b'` is two arguments.
const args = (list: string): string[] =>
  [...list.matchAll(/(["'])(.*?)\1(?=\s|$)|\S+/g)].map(([word, quote, inner]) =>
    quote === undefined ? word : inner!,
  )

/** An outcome step: a failure ends with where the process rests. */
const outcome =
  <A extends unknown[]>(check: (world: TestkitWorld, ...rest: A) => unknown) =>
  async (world: TestkitWorld, ...rest: A): Promise<void> => {
    try {
      await check(world, ...rest)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      failure.message += `\n\n${await restDescription(() => world.repo(), world.neverUsed())}`
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
  "the environment variable {string} is {string}",
  (world: TestkitWorld, name: string, value: string) => {
    world.setEnv(name, value)
  },
)

Given(
  "from now on the environment variable {string} is {string}",
  (world: TestkitWorld, name: string, value: string) => {
    world.changeEnv(name, value)
  },
)

// Imported by the test runner, like `a gtd config from the module`.
Given(
  "the module {string} is importable as {string}",
  async (world: TestkitWorld, path: string, specifier: string) => {
    world.importable(specifier, { ...(await import(pathToFileURL(resolve(path)).href)) })
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

Given(
  "the command matching {string} exits {int}",
  (world: TestkitWorld, pattern: string, exit: number) => {
    world.command({ run: new RegExp(pattern), exit })
  },
)

Given(
  "the command matching {string} exits {int} with:",
  (world: TestkitWorld, pattern: string, exit: number, output: string) => {
    world.command({ run: new RegExp(pattern), exit, output: withNewline(output) })
  },
)

Given("a branch {string}", (world: TestkitWorld, name: string) => {
  world.repo().branch(name)
})

Given("a branch {string} at {string}", (world: TestkitWorld, name: string, ref: string) => {
  world.repo().branch(name, ref)
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

Given("text is appended to {string}:", (world: TestkitWorld, path: string, text: string) => {
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
  world.rescript(step, () => undefined)
})

// Lets a later visit rest at a step an earlier one had scripted.
Given("step {string} is no longer scripted", (world: TestkitWorld, step: string) => {
  world.unscript(step)
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

// A standing assertion: it applies on every later visit to the step until
// `from now on` or `no longer scripted` clears it.
Given(
  "step {string} is prompted with {string}",
  (world: TestkitWorld, step: string, text: string) => {
    world.expectPrompt(step, text)
  },
)

// A closing step deletes the file before its collecting turn runs, so this edit
// leaves a closed turn changing nothing while still answering an in-gate one.
Given(
  "step {string} overwrites {string}, if it exists, with:",
  (world: TestkitWorld, step: string, path: string, content: string) => {
    world.act(step, (_, repo) => {
      if (repo.read(path) !== undefined) repo.write(path, withNewline(content))
    })
  },
)

Given("step {string} runs its script", (world: TestkitWorld, step: string) => {
  world.act(step, runsItsScript)
})

/** A check step's script, every command it runs answering as `command` does. */
const checkRuns = (world: TestkitWorld, step: string, command: Omit<CannedCommand, "run">) => {
  world.act(step, (beat, repo) => {
    if (beat.actor !== "check")
      throw new Error(`step "${step}" is no check step; its actor is ${beat.actor}`)
    repo.runScript(beat.content, { commands: [{ ...command, run: /[\s\S]*/ }] })
  })
}

Given("check step {string} passes", (world: TestkitWorld, step: string) => {
  checkRuns(world, step, {})
})

Given("check step {string} fails with:", (world: TestkitWorld, step: string, output: string) => {
  checkRuns(world, step, { exit: 1, output: withNewline(output) })
})

Given("judge step {string} answers:", (world: TestkitWorld, step: string, verdict: string) => {
  world.answer(step, String(verdict))
})

Given(
  "judge step {string}, when its questions contain {string}, answers:",
  (world: TestkitWorld, step: string, text: string, verdict: string) => {
    world.answerWhen(step, text, String(verdict))
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

When("the process is driven leniently", async (world: TestkitWorld) => {
  await world.drive({ strict: false })
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
    assertRestsAt(await world.repo().next(), step)
  }),
)

Then(
  "the process stalls at {string}",
  outcome(async (world, step: string) => {
    const beat = await world.repo().next()
    if (beat.kind !== "stalled" || beat.state !== step)
      assert.fail(
        `expected a stall at "${step}", but the process rests at "${beat.state}" (${beat.kind})`,
      )
  }),
)

/** A beat field by its dotted path (`model`, `access.write`), as text: a string as is, anything else as JSON. */
const beatField = async (world: TestkitWorld, path: string): Promise<unknown> => {
  let value: unknown = await world.repo().next()
  for (const key of path.split(".")) {
    value =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined
  }
  return value
}

const asText = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined")

Then(
  "the resting step's {word} is {string}",
  outcome(async (world, path: string, expected: string) => {
    const value = asText(await beatField(world, path))
    if (value !== expected)
      assert.fail(`the resting step's ${path} is not "${expected}"; it is:\n${value}`)
  }),
)

Then(
  "the resting step's {word} includes {string}",
  outcome(async (world, path: string, expected: string) => {
    const value = await beatField(world, path)
    const found = Array.isArray(value)
      ? value.some((item) => asText(item) === expected)
      : typeof value === "string" && value.includes(expected)
    if (!found)
      assert.fail(
        `the resting step's ${path} does not include "${expected}"; it is:\n${asText(value)}`,
      )
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

Then(
  "the last commit body contains {string}",
  outcome((world, text: string) => {
    assertContains("the last commit's message", text, world.repo().messages().at(-1))
  }),
)

// Every commit with the subject, so a repeated step is not judged by its first match.
Then(
  "the commit {string} has a body containing {string}",
  outcome((world, subject: string, text: string) => {
    const matching = world
      .repo()
      .commits()
      .filter((commit) => commit.subject === subject)
    assert.ok(matching.length > 0, `no commit "${subject}"`)
    for (const { message } of matching) assertContains(`the commit "${subject}"`, text, message)
  }),
)

Then(
  "no commit body contains {string}",
  outcome((world, text: string) => {
    const hit = world
      .repo()
      .messages()
      .find((message) => message.includes(text))
    if (hit !== undefined) assert.fail(`a commit's message contains "${text}":\n${hit}`)
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
  "{string} as committed at {string} contains {string}",
  outcome((world, path: string, ref: string, text: string) => {
    assertContains(`"${path}" at ${ref}`, text, world.repo().show(ref, path))
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
