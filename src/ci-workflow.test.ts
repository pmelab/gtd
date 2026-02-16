import { describe, it, expect } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { execSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

describe("CI workflow lint & format steps", () => {
  const workflowPath = join(import.meta.dirname, "../.github/workflows/test.yml")

  const getSteps = () => {
    const content = readFileSync(workflowPath, "utf-8")
    const workflow = parse(content)
    return workflow.jobs.test.steps as Array<{ name?: string; run?: string }>
  }

  const stepIndex = (steps: Array<{ name?: string; run?: string }>, pattern: string) =>
    steps.findIndex((s) => s.run?.includes(pattern))

  it("has a lint step", () => {
    const steps = getSteps()
    expect(stepIndex(steps, "bun run lint")).toBeGreaterThan(-1)
  })

  it("has a format:check step", () => {
    const steps = getSteps()
    expect(stepIndex(steps, "bun run format:check")).toBeGreaterThan(-1)
  })

  it("runs lint after tests", () => {
    const steps = getSteps()
    const testIdx = stepIndex(steps, "bun test")
    const lintIdx = stepIndex(steps, "bun run lint")
    expect(lintIdx).toBeGreaterThan(testIdx)
  })

  it("runs format:check after lint", () => {
    const steps = getSteps()
    const lintIdx = stepIndex(steps, "bun run lint")
    const formatIdx = stepIndex(steps, "bun run format:check")
    expect(formatIdx).toBeGreaterThan(lintIdx)
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
