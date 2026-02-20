import { describe, it, expect } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { execSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

describe("CI workflow step ordering", () => {
  const workflowPath = join(import.meta.dirname, "../.github/workflows/test.yml")

  const getSteps = () => {
    const content = readFileSync(workflowPath, "utf-8")
    const workflow = parse(content)
    return workflow.jobs.test.steps as Array<{ name?: string; run?: string }>
  }

  const stepIndex = (steps: Array<{ name?: string; run?: string }>, pattern: string) =>
    steps.findIndex((s) => s.run?.includes(pattern))

  it("has a format:check step", () => {
    const steps = getSteps()
    expect(stepIndex(steps, "format:check")).toBeGreaterThan(-1)
  })

  it("has a typecheck step", () => {
    const steps = getSteps()
    expect(stepIndex(steps, "typecheck")).toBeGreaterThan(-1)
  })

  it("has a lint step", () => {
    const steps = getSteps()
    expect(stepIndex(steps, "npm run lint")).toBeGreaterThan(-1)
  })

  it("has a unit test step", () => {
    const steps = getSteps()
    expect(stepIndex(steps, "npm test")).toBeGreaterThan(-1)
  })

  it("has an e2e test step", () => {
    const steps = getSteps()
    expect(stepIndex(steps, "test:e2e")).toBeGreaterThan(-1)
  })

  it("runs steps in fail-early order: typecheck → lint → format → unit tests → e2e", () => {
    const steps = getSteps()
    const typecheckIdx = stepIndex(steps, "typecheck")
    const lintIdx = stepIndex(steps, "npm run lint")
    const formatIdx = stepIndex(steps, "format:check")
    const unitIdx = stepIndex(steps, "npm test")
    const e2eIdx = stepIndex(steps, "test:e2e")

    expect(typecheckIdx).toBeLessThan(lintIdx)
    expect(lintIdx).toBeLessThan(formatIdx)
    expect(formatIdx).toBeLessThan(unitIdx)
    expect(unitIdx).toBeLessThan(e2eIdx)
  })

  it("prettier --check fails on formatting violations", () => {
    const dir = mkdtempSync(join(tmpdir(), "format-test-"))
    writeFileSync(join(dir, ".prettierrc"), JSON.stringify({ semi: false }))
    writeFileSync(join(dir, "bad.ts"), 'const x = 1;\nconst y = "hello";\n')

    expect(() =>
      execSync(`bunx prettier --check bad.ts`, { cwd: dir, encoding: "utf-8" }),
    ).toThrow()
  })
})
