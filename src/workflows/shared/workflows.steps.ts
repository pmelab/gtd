import { Given } from "quickpickle"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import type { TestkitWorld } from "../../testkit/index.js"

Given("the shipped workflows, as gtd install scaffolds them", (world: TestkitWorld) => {
  world.configure(CONFIG_SCAFFOLD)
})
