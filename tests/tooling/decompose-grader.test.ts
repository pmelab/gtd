import { describe, expect, it } from "vitest"
import { checkDeclaredTests } from "../../evals/asserts/architecture-decompose.mjs"
import spec from "../../evals/cases/architecture-decompose.mjs"

const { scenarioPackage, e2e, unit } = spec.expect.clean.declaredTests as {
  scenarioPackage: string
  e2e: string[]
  unit: string[]
}

const tests = (level: string, paths: readonly string[]): string =>
  `Package.\n\n## Tests\n\n${paths.map((p) => `- ${level}: \`${p}\``).join("\n")}\n`

const unitPackages = Object.fromEntries(
  unit.map((path, n) => [`.gtd/packages/0${n + 1}-unit.md`, tests("unit", [path])]),
)
const declared = { [scenarioPackage]: tests("e2e", e2e), ...unitPackages }

const check = (packageFiles: Record<string, string>) =>
  checkDeclaredTests({ packageFiles }, spec, "clean")

describe("the architecture-decompose grader's declared-tests check", () => {
  it("passes packages that declare every architecture test, e2e in package 00", () => {
    expect(check(declared)).toBeUndefined()
  })

  it("fails four prose-only packages", () => {
    const prose = Object.fromEntries(
      ["01-a", "02-b", "03-c", "04-d"].map((n) => [`.gtd/packages/${n}.md`, "Package.\n"]),
    )
    expect(check(prose)?.reason).toContain(scenarioPackage)
  })

  it("fails an e2e test declared outside package 00", () => {
    const moved = {
      ...declared,
      [scenarioPackage]: "Package.\n",
      ".gtd/packages/04-wiring.md": tests("e2e", e2e),
    }
    expect(check(moved)?.reason).toContain(e2e[0])
  })

  it("fails a unit test no package declares", () => {
    const missing = { ...declared, ".gtd/packages/03-unit.md": "Package.\n" }
    expect(check(missing)?.reason).toContain(unit[2])
  })
})
