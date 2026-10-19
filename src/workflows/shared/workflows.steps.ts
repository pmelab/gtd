import { After, Given, Then } from "quickpickle"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import assert from "node:assert"
import type { TestkitWorld } from "../../testkit/index.js"

Given("the shipped workflows, as gtd install scaffolds them", (world: TestkitWorld) => {
  world.configure(CONFIG_SCAFFOLD)
})

// Ambient, not explicit: the repository's own env is fixed when it is created,
// and only a real environment variable can change between two steps of one process.
const restores: (() => void)[] = []

Given(
  "the ambient environment variable {string} is {string}",
  (_: TestkitWorld, name: string, value: string) => {
    const before = process.env[name]
    restores.push(() => {
      if (before === undefined) delete process.env[name]
      else process.env[name] = before
    })
    process.env[name] = value
  },
)

After(() => {
  while (restores.length > 0) restores.pop()!()
})

Then("the last commit body contains {string}", (world: TestkitWorld, text: string) => {
  const message = world.repo().messages().at(-1) ?? ""
  assert.ok(message.includes(text), message)
})

Then(
  "the commit {string} has a body containing {string}",
  (world: TestkitWorld, subject: string, text: string) => {
    // Every commit with the subject, so a repeated step is not judged by its first match.
    const matching = world
      .repo()
      .messages()
      .filter((m) => m.split("\n")[0] === subject)
    assert.ok(matching.length > 0, `no commit "${subject}"`)
    for (const message of matching) assert.ok(message.includes(text), message)
  },
)

Then("no commit body contains {string}", (world: TestkitWorld, text: string) => {
  const hit = world
    .repo()
    .messages()
    .find((m) => m.includes(text))
  assert.ok(hit === undefined, `a commit body contains "${text}":\n${hit}`)
})

Then(
  "slice {string} begins where slice {string} ends",
  async (world: TestkitWorld, later: string, earlier: string) => {
    const { stdout } = await world.repo().gtd("slices")
    const range = (name: string): string[] => {
      const line = stdout.split("\n").find((l) => l.startsWith(`${name} `))
      assert.ok(line !== undefined, stdout)
      return line.slice(name.length + 1).split("..")
    }
    assert.strictEqual(range(later)[0], range(earlier)[1], stdout)
  },
)
