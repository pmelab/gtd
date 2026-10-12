import { afterEach, describe, expect, it } from "vitest"
import { installContext, type StepRequest } from "../../flows/index.js"
import { fixtureContext } from "../shared/text.fixture.js"
import { base, reviewFlow } from "./review.js"

afterEach(() => installContext(undefined))

describe("the review workflow", () => {
  it("refuses a pending hand-off before requesting any step, the gate's check included", async () => {
    const requested: string[] = []
    const files = new Map([
      [".gtd/REVIEW.md", "notes"],
      [".gtd/REVIEW.orig.md", "orig"],
    ])
    installContext(
      fixtureContext(
        {},
        {
          step: (request: StepRequest) => {
            requested.push(request.kind)
            return Promise.resolve()
          },
          refuse: (message: string): never => {
            throw new Error(message)
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          read: (path) => files.get(path),
        },
      ),
    )
    await expect(reviewFlow()).rejects.toThrow(".gtd/REVIEW.orig.md is a pending hand-off")
    expect(requested).toEqual([])
  })
})

describe("the deprecated shipped base", () => {
  it("answers for a workflow named review only, mapping reviewBase", () => {
    expect(base("review", {})).toBe("")
    expect(base("review", { reviewBase: "v1" })).toBe("v1")
    expect(base("audit", { reviewBase: "v1" })).toBeUndefined()
  })
})
