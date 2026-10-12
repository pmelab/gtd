import { afterEach, describe, expect, it } from "vitest"
import { installContext, type StepRequest } from "../../flows/index.js"
import { fixtureContext } from "../shared/text.fixture.js"
import { ordinaryStart } from "./feature.js"

afterEach(() => installContext(undefined))

const FILES: Readonly<Record<string, string>> = {
  ".gtd/REVIEW.md": "# Review: abc1234\n",
  ".gtd/REVIEW.orig.md": "# Review: abc1234\n",
}

describe("an ordinary feature start", () => {
  it("refuses a pending hand-off right after idle, before unwinding", async () => {
    const steps: StepRequest[] = []
    installContext(
      fixtureContext(
        {},
        {
          step: (request: StepRequest) => {
            steps.push(request)
            return Promise.resolve()
          },
          refuse: (message: string): never => {
            throw new Error(message)
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          read: (path) => FILES[path],
          head: () => "c1",
          start: () => "c0",
        },
      ),
    )
    await expect(ordinaryStart()).rejects.toThrow(".gtd/REVIEW.orig.md is a pending hand-off")
    expect(steps.map((s) => ("name" in s ? s.name : s.kind))).toEqual(["idle"])
  })
})
