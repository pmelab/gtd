import { describe, expect, it } from "vitest"
import type { TestContext } from "vitest"
import { applyHooks, type InfoConstructor } from "quickpickle"
import { agent, human } from "../flows/index.js"
import { TestkitWorld } from "./index.js"

const flow = async (): Promise<void> => {
  await agent("plan", "Write PLAN.md.")
  await human("sign-off")
  await agent("ship", "Ship it.")
  await human("done")
}

type Common = TestkitWorld["common"]

const feature = (): Common => ({ info: { feature: "Feature: shipping", tags: [] } })

// `ship` scripted by a Background step (quickpickle numbers those negatively) or by the scenario.
const world = (
  shipFrom: "Background" | "scenario" = "scenario",
  common = feature(),
): TestkitWorld => {
  const info = { feature: "", scenario: "", tags: [], steps: [], common, config: {} }
  const created = new TestkitWorld({} as TestContext, info as unknown as InfoConstructor)
  created.common = common
  created.configure({ default: flow })
  created.act("plan", (_, repo) => repo.write("PLAN.md", "p\n"))
  created.info.stepIdx = shipFrom === "Background" ? -1 : 1
  created.act("ship", (_, repo) => repo.write("SHIPPED.md", "s\n"))
  created.info.stepIdx = 2
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
      'at scenario end, no drive reached the steps scripted for "ship" (scenario)',
    )
  })

  it("fails on a step no drive reached though every drive was lenient", async () => {
    const scenario = world()
    await scenario.drive({ strict: false })
    await expect(scenario.assertReached()).rejects.toThrow('"ship" (scenario)')
  })

  it("leaves a step only a Background scripted to the feature's end", async () => {
    const scenario = world("Background")
    await scenario.drive()
    await expect(scenario.assertReached()).resolves.toBeUndefined()
  })

  it("checks a step the Background scripted and the scenario scripts again", async () => {
    const scenario = world("Background")
    scenario.act("ship", () => undefined)
    await scenario.drive()
    await expect(scenario.assertReached()).rejects.toThrow('"ship" (scenario)')
  })

  it("excuses the steps a refused drive was handed, not those scripted after it", async () => {
    const scenario = world()
    scenario.act("sign-off", () => undefined)
    await expect(scenario.drive()).rejects.toThrow("changed nothing")
    await expect(scenario.assertReached()).resolves.toBeUndefined()
    scenario.act("done", (_, repo) => repo.write("DONE.md", "d\n"))
    await expect(scenario.assertReached()).rejects.toThrow('"done" (scenario)')
  })
})

describe("the feature-end check of Background steps", () => {
  const scenarioEnd = async (scenario: TestkitWorld): Promise<void> => {
    await applyHooks("after", scenario)
  }

  it("fails on a Background step no scenario of the feature reached, naming it", async () => {
    const common = feature()
    const scenario = world("Background", common)
    await scenario.drive()
    await scenarioEnd(scenario)
    await expect(applyHooks("afterAll", common)).rejects.toThrow(
      'Feature: shipping: no scenario reached the steps scripted for "ship" (Background)',
    )
  })

  it("passes a Background step one scenario of the feature reached", async () => {
    const common = feature()
    const resting = world("Background", common)
    await resting.drive()
    await scenarioEnd(resting)
    const shipping = world("Background", common)
    await shipping.drive()
    shipping.act("sign-off", (_, repo) => repo.write("SIGNED.md", "x\n"))
    await shipping.drive()
    await scenarioEnd(shipping)
    await expect(applyHooks("afterAll", common)).resolves.toBe(common)
  })

  it("counts a failed scenario as reaching its Background steps", async () => {
    const common = feature()
    const scenario = world("Background", common)
    await scenario.drive()
    scenario.info.errors.push(new Error("a step failed"))
    await scenarioEnd(scenario)
    await expect(applyHooks("afterAll", common)).resolves.toBe(common)
  })

  it("is left out when a scenario of the file did not run", async () => {
    const common = feature()
    const scenario = world("Background", common)
    const tasks = [{ mode: "run", result: { state: "pass" } }, { tasks: [{ mode: "skip" }] }]
    Object.assign(scenario, { context: { task: { file: { tasks } } } })
    await scenario.drive()
    await scenarioEnd(scenario)
    await expect(applyHooks("afterAll", common)).resolves.toBe(common)
  })
})
