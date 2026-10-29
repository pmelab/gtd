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
  it("takes the report positionally and renders the same step as the options form", async () => {
    const requests = recording()
    expect(await check("suite", "npm test", ".gtd/FEEDBACK.md", { label: "Tests" })).toBe(true)
    expect(await check("suite", "npm test", { report: ".gtd/FEEDBACK.md", label: "Tests" })).toBe(
      true,
    )
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(requests[1])
    expect(requests[0]).toMatchObject({ kind: "run", name: "suite", options: { label: "Tests" } })
  })
})
