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

type W = { write(p: string, c: string): void }

describe("gate guard", () => {
  const config = (guard: string) =>
    [
      `import { gate } from "@pmelab/gtd/workflows"`,
      `import { agent, refuse } from "@pmelab/gtd/flows"`,
      `export const held = async () => { await agent("first", "go"); ${guard}; await gate("suite", "fix it", guard) }`,
      `export default held`,
    ].join("\n")

  const red = {
    first: (_: unknown, r: W) => r.write("f", "1\n"),
    "suite.check": (_: unknown, r: W) => r.write(".gtd/FEEDBACK.md", "red\n"),
    "suite.recheck": (_: unknown, r: W) => r.write(".gtd/FEEDBACK.md", "red again\n"),
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

describe("healthy describeGuard", () => {
  const config = (options: string) =>
    [
      `import { healthy } from "@pmelab/gtd/workflows"`,
      `import { agent, read, refuse } from "@pmelab/gtd/flows"`,
      `const describeGuard = () => { refuse("describe-guarded: nope") }`,
      `const guard = () => { refuse("guarded: nope") }`,
      `export const held = async () => { await agent("first", "go"); await healthy(() => agent("fix", "go"), ${options}) }`,
      `export default held`,
    ].join("\n")

  let runs = 0
  const handlers = (extra: Record<string, unknown>) => ({
    "health.check": (_: unknown, r: W) => r.write(".gtd/FEEDBACK.md", `red ${runs++}\n`),
    "health.recheck": (_: unknown, r: W) => r.write(".gtd/FEEDBACK.md", `red ${runs++}\n`),
    "health.judge": () => '[{"id":"verdict","answer":"progress","p":0.9}]',
    fix: (_: unknown, r: W) => r.write("f", `${runs}\n`),
    first: (_: unknown, r: W) => r.write("start", "1\n"),
    ...extra,
  })
  const make = (options: string) =>
    testRepo({ workflow: config(options), env: { GTD_TEST_COMMAND: "true" } })

  it("runs after a describe landing and its refusal stops the turn", async () => {
    runs = 0
    const repo = make("{ describeGuard }")
    await repo.start("held")
    await expect(repo.drive(handlers({ "health.describe": () => undefined }))).rejects.toThrow(
      "describe-guarded: nope",
    )
  })

  it("never runs after the human stop rest", async () => {
    runs = 0
    // Refuses only once a person's edit exists, which only a post-stop run can see.
    const repo = make(
      '{ describeGuard: () => { if (read("human.txt") !== undefined) refuse("describe-guarded: late") } }',
    )
    await repo.start("held")
    const rest = await repo.drive(handlers({ "health.describe": () => undefined }))
    expect(rest.state).toBe("health.stop")
    const after = await repo.drive(
      handlers({ "health.stop": (_: unknown, r: W) => r.write("human.txt", "edit\n") }),
    )
    expect(after.state).not.toBe("health.stop")
  })

  it("keeps guard running after describe", async () => {
    runs = 0
    // Refuses only once the describe turn has written its analysis.
    const repo = make(
      '{ guard: () => { if (read(".gtd/ESCALATION.md") !== undefined) refuse("guarded: nope") } }',
    )
    await repo.start("held")
    await expect(
      repo.drive(
        handlers({
          "health.describe": (_: unknown, r: W) => r.write(".gtd/ESCALATION.md", "why\n"),
        }),
      ),
    ).rejects.toThrow("guarded: nope")
  })
})

describe("healthy at the fix cap", () => {
  // Blank reports are not comparable; at an 8-byte budget the cut trims both.
  it.each([
    ["could not compare", "", (n: number) => "\n".repeat(n)],
    ["saw only cut", `, judgeBudgetBytes: "8"`, (n: number) => `a long failing report ${n}\n`],
  ])("grants no extra turn on progress the judge %s", async (_, extra, report) => {
    let runs = 0
    const repo = testRepo({
      workflow: [
        `import { healthy } from "@pmelab/gtd/workflows"`,
        `import { agent } from "@pmelab/gtd/flows"`,
        `export const defaults = { judgeIdenticalMinP: "0.7"${extra} }`,
        `export const held = async () => { await agent("first", "go"); await healthy(() => agent("fix", "go")) }`,
        `export default held`,
      ].join("\n"),
      env: { GTD_TEST_COMMAND: "true" },
    })
    await repo.start("held")
    const rest = await repo.drive({
      first: (_, r) => r.write("start", "1\n"),
      "health.check": (_, r) => r.write(".gtd/FEEDBACK.md", report(++runs)),
      "health.judge": () => '[{"id":"verdict","answer":"progress","p":0.9}]',
      fix: (_, r) => r.write("f", `${runs}\n`),
      "health.recheck": (_, r) => r.write(".gtd/FEEDBACK.md", "red again\n"),
    })
    expect(rest.state).toBe("health.describe")
    expect(repo.subjects().filter((s) => s.startsWith("gtd(agent): fix")).length).toBe(3)
  })
})
