import { describe, expect, it } from "vitest"
import type { TestContext } from "vitest"
import type { InfoConstructor } from "quickpickle"
import { agent, human } from "../flows/index.js"
import { TestkitWorld } from "./index.js"

const flow = async (): Promise<void> => {
  await agent("plan", "Write PLAN.md.")
  await human("sign-off")
  await agent("ship", "Ship it.")
  await human("done")
}

const world = (): TestkitWorld => {
  const info = { feature: "", scenario: "", tags: [], steps: [], common: {}, config: {} }
  const created = new TestkitWorld({} as TestContext, info as unknown as InfoConstructor)
  created.configure({ default: flow })
  created.act("plan", (_, repo) => repo.write("PLAN.md", "p\n"))
  created.act("ship", (_, repo) => repo.write("SHIPPED.md", "s\n"))
  created.repo().write("go", "\n")
  return created
}

describe("TestkitWorld's scenario-end check", () => {
  it("passes a step a later drive reaches, though an earlier one rested before it", async () => {
    const scenario = world()
    await scenario.drive()
    scenario.act("sign-off", (_, repo) => repo.write("SIGNED.md", "x\n"))
    await scenario.drive()
    await expect(scenario.assertReached()).resolves.toBeUndefined()
  })

  it("fails on a step no drive reached, naming it", async () => {
    const scenario = world()
    await scenario.drive()
    await expect(scenario.assertReached()).rejects.toThrow(
      'strict drive: at scenario end, no drive reached the steps scripted for "ship"',
    )
  })

  it("passes when every drive was lenient", async () => {
    const scenario = world()
    await scenario.drive({ strict: false })
    await expect(scenario.assertReached()).resolves.toBeUndefined()
  })
})
