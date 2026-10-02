import { describe, expect, it } from "vitest"
import { toRequest } from "../judges/index.js"
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
