import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { SETUP_FILES } from "../../tests/integration/support/setup-files.js"
import vitestConfig from "../../vitest.config.js"
import strykerVitestConfig from "../../vitest.stryker.config.js"

describe("setup-files invariants", () => {
  it("every SETUP_FILES entry exists on disk", () => {
    for (const path of SETUP_FILES) {
      expect(existsSync(new URL(`../../${path}`, import.meta.url)), path).toBe(true)
    }
  })

  it("vitest.stryker.config.ts uses the shared SETUP_FILES list", () => {
    expect(strykerVitestConfig.test?.setupFiles).toEqual(SETUP_FILES)
  })

  it("every e2e-* project in vitest.config.ts uses the shared SETUP_FILES list", () => {
    const projects = vitestConfig.test?.projects ?? []
    const e2eProjects = projects.filter(
      (project) =>
        typeof project === "object" &&
        project !== null &&
        "test" in project &&
        typeof project.test === "object" &&
        project.test !== null &&
        "name" in project.test &&
        typeof project.test.name === "string" &&
        project.test.name.startsWith("e2e-"),
    )
    expect(e2eProjects.length).toBeGreaterThan(0)
    for (const project of e2eProjects) {
      // @ts-expect-error narrowed above at runtime
      expect(project.test.setupFiles).toEqual(SETUP_FILES)
    }
  })
})
