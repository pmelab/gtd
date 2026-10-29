import { afterEach, describe, expect, it } from "vitest"
import { agent, read } from "../flows/index.js"
import { installContext, type FlowContext, type StepRequest } from "./index.js"

afterEach(() => installContext(undefined))

describe("the flow-context harness", () => {
  it("renders a prompt and records a step against an installed context", async () => {
    const requests: StepRequest[] = []
    installContext({
      read: (path: string) => (path === "PLAN.md" ? "add a button" : undefined),
      step: async (request: StepRequest) => {
        requests.push(request)
      },
    } as Partial<FlowContext> as FlowContext)

    await agent("build", `Build: ${read("PLAN.md")}`)

    expect(requests).toEqual([
      { kind: "agent", name: "build", prompt: "Build: add a button", options: {} },
    ])
  })

  it("leaves a flow failing outside a replay once uninstalled", () => {
    installContext(undefined)
    expect(() => read("PLAN.md")).toThrow("called outside a gtd replay")
  })
})
