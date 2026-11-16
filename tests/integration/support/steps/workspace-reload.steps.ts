import { Given, When } from "quickpickle"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

Given("the command {string} holds its answer", (world: GtdWorld, argv: string) => {
  bench(world).holdCommand(argv)
})

When("the command {string} gives its answer", async (world: GtdWorld, argv: string) => {
  await bench(world).answerCommand(argv)
})

When(
  "the workspace file {string} changes to:",
  async (world: GtdWorld, path: string, content: string) => {
    await bench(world).changeFile(path, content)
  },
)
