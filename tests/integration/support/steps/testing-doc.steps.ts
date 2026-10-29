import { Given, When } from "quickpickle"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { extractBashBlock } from "../../helpers/driver-doc.js"
import { extractFiles } from "../../helpers/testing-doc.js"
import type { GtdWorld } from "../world.js"

const DOC = resolve(import.meta.dirname, "../../../../docs/testing.md")

Given("the files docs\\/testing.md shows under {string}", (world: GtdWorld, heading: string) => {
  for (const [name, content] of extractFiles(readFileSync(DOC, "utf8"), heading)) {
    writeFileSync(join(world.repoDir, name), content)
  }
})

// What npm writes for an installed vitest; the linked one comes without it.
Given("npx finds the linked vitest", (world: GtdWorld) => {
  const bin = join(world.repoDir, "node_modules", ".bin")
  mkdirSync(bin, { recursive: true })
  if (!existsSync(join(bin, "vitest"))) symlinkSync("../vitest/vitest.mjs", join(bin, "vitest"))
})

When(
  "I run the command docs\\/testing.md shows under {string} within {int} seconds",
  async (world: GtdWorld, heading: string, seconds: number) => {
    await world.runShell(extractBashBlock(readFileSync(DOC, "utf8"), heading), seconds * 1000)
  },
)
