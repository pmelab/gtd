import { describe, expect, it } from "vitest"
import { toRequest } from "../../judges/index.js"
import { testRepo } from "../../testkit/index.js"
import { retryQuestion } from "./health.js"

describe("retryQuestion", () => {
  it.each([true, false])("is sendable to jev (comparable=%s)", (comparable) => {
    const { primitive, ...rest } = retryQuestion(comparable)
    const { questions } = toRequest([{ ...rest, primitive } as never], {})
    expect(
      Object.keys((questions["verdict"] as { criteria: object }).criteria).length,
    ).toBeGreaterThanOrEqual(2)
  })
})

describe("gate guard", () => {
  const config = (guard: string) =>
    [
      `import { gate } from "@pmelab/gtd/workflows"`,
      `import { agent, refuse } from "@pmelab/gtd/flows"`,
      `export const held = async () => { await agent("first", "go"); ${guard}; await gate("suite", "fix it", guard) }`,
      `export default held`,
    ].join("\n")

  const red = {
    first: (_: unknown, r: { write(p: string, c: string): void }) => r.write("f", "1\n"),
    "suite.check": (_: unknown, r: { write(p: string, c: string): void }) =>
      r.write(".gtd/FEEDBACK.md", "red\n"),
  }

  it("runs the guard after a blocked landing and lets its refusal stop it", async () => {
    const repo = testRepo({
      workflow: config('const guard = () => { refuse("guarded: nope") }'),
      env: { GTD_TEST_COMMAND: "true" },
    })
    await repo.start("held")
    await repo.drive(red)
    await expect(repo.drive({ "suite.blocked": (_, r) => r.write("x", "1\n") })).rejects.toThrow(
      "guarded: nope",
    )
  })

  it("never runs the guard after the check step", async () => {
    const repo = testRepo({
      workflow: config('const guard = () => { refuse("guarded: nope") }'),
      env: { GTD_TEST_COMMAND: "true" },
    })
    await repo.start("held")
    const rest = await repo.drive(red)
    expect(rest.state).toBe("suite.blocked")
  })
})
