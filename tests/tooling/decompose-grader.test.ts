import { describe, expect, it } from "vitest"
import { checkDeclaredTests } from "../../evals/asserts/architecture-decompose.mjs"
import spec from "../../evals/cases/architecture-decompose.mjs"

const { e2e, unit } = spec.expect.clean.declaredTests as {
  e2e: string[]
  unit: string[]
}

const tests = (lines: readonly string[]): string =>
  `Package.\n\n## Tests\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`

const declared = Object.fromEntries(
  unit.map((path, n) => [
    `.gtd/packages/0${n + 1}-slice.md`,
    tests([`unit: \`${path}\``, ...(n === unit.length - 1 ? e2e.map((p) => `e2e: \`${p}\``) : [])]),
  ]),
)

const check = (packageFiles: Record<string, string>) =>
  checkDeclaredTests({ packageFiles }, spec, "clean")

describe("the architecture-decompose grader's declared-tests check", () => {
  it("passes slices that together declare every architecture test", () => {
    expect(check(declared)).toBeUndefined()
  })

  it("fails prose-only packages", () => {
    const prose = Object.fromEntries(
      ["01-a", "02-b", "03-c"].map((n) => [`.gtd/packages/${n}.md`, "Package.\n"]),
    )
    expect(check(prose)?.reason).toContain(e2e[0])
  })

  it("fails an e2e test no package declares", () => {
    const last = `.gtd/packages/0${unit.length}-slice.md`
    const dropped = { ...declared, [last]: tests([`unit: \`${unit[unit.length - 1]}\``]) }
    expect(check(dropped)?.reason).toContain(e2e[0])
  })

  it("fails a unit test no package declares", () => {
    const missing = { ...declared, ".gtd/packages/01-slice.md": "Package.\n" }
    expect(check(missing)?.reason).toContain(unit[0])
  })
})
