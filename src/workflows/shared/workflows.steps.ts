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
    const message = world
      .repo()
      .messages()
      .find((m) => m.split("\n")[0] === subject)
    assert.ok(message !== undefined, `no commit "${subject}"`)
    assert.ok(message.includes(text), message)
  },
)
