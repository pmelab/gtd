import { When } from "quickpickle"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

When(
  "the workspace file {string} changes to:",
  async (world: GtdWorld, path: string, content: string) => {
    await bench(world).changeFile(path, content)
  },
)
