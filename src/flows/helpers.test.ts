import { afterEach, describe, expect, it } from "vitest"
import { check } from "./helpers.js"
import { installContext, type FlowContext, type StepRequest } from "./internal.js"

afterEach(() => installContext(undefined))

const recording = () => {
  const requests: StepRequest[] = []
  installContext({
    step: async (request: StepRequest) => {
      requests.push(request)
    },
    head: () => "abcdef1234",
    changes: () => [],
    matches: (path: string, pattern: string) => path === pattern,
  } as unknown as FlowContext)
  return requests
}

describe("check()", () => {
  it("takes the report positionally and renders a run step", async () => {
    const requests = recording()
    expect(await check("suite", "npm test", ".gtd/FEEDBACK.md", { label: "Tests" })).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: "run", name: "suite", options: { label: "Tests" } })
  })

  it("refuses the removed options form, which an untyped config can still write", async () => {
    recording()
    const removed = check as unknown as (n: string, c: string, o: object) => Promise<boolean>
    await expect(removed("suite", "npm test", { report: ".gtd/FEEDBACK.md" })).rejects.toThrow(
      'gtd: check("suite"): the report path is the third argument — check(name, command, report, options?)',
    )
  })
})
