import { describe, expect, it } from "vitest"
import { toRequest } from "../judges/index.js"
import { fastSuiteGuard, retryQuestion } from "./health.js"
import { renderText } from "./text.fixture.js"

describe("retryQuestion", () => {
  it.each([true, false])("is sendable to jev (comparable=%s)", (comparable) => {
    const { primitive, ...rest } = retryQuestion(comparable)
    const { questions } = toRequest([{ ...rest, primitive } as never], {})
    expect(
      Object.keys((questions["verdict"] as { criteria: object }).criteria).length,
    ).toBeGreaterThanOrEqual(2)
  })
})

describe("fastSuiteGuard", () => {
  it("unset: names the setting and exits 0", () => {
    const lines = renderText(fastSuiteGuard).join("\n")
    expect(lines).toContain("fastTestCommand")
    expect(lines).toContain("GTD_FASTTESTCOMMAND")
    expect(lines).toContain("exit 0")
  })

  it("blank after trim counts as unset", () => {
    expect(renderText(fastSuiteGuard, { env: { fastTestCommand: "  \t " } })).toContain("exit 0")
  })

  it("set: only removes SETUP", () => {
    const lines = renderText(fastSuiteGuard, { env: { fastTestCommand: "true" } })
    expect(lines.join("\n")).not.toContain("exit 0")
    expect(lines.join("\n")).toContain("rm -f")
  })
})
