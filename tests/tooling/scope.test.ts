import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const stryker = JSON.parse(
  readFileSync(new URL("../../stryker.config.json", import.meta.url), "utf8"),
)
const mutate: string[] = stryker.mutate

describe("stryker.config.json's mutate scope", () => {
  it("names only files that exist on disk", () => {
    for (const entry of mutate) {
      expect(
        existsSync(new URL(`../../${entry}`, import.meta.url)),
        `"${entry}" does not exist`,
      ).toBe(true)
    }
  })

  it("names at least one file under each of the five packages", () => {
    const packages = ["src/steering/", "src/platform/", "src/workflow/", "src/step/", "src/wire/"]
    for (const pkg of packages) {
      expect(
        mutate.some((entry) => entry.startsWith(pkg)),
        `mutate has no entry under "${pkg}"`,
      ).toBe(true)
    }
  })
})
