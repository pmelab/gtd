import { describe, expect, it } from "vitest"
import { withTrpcEndpoint } from "./Gate.js"

describe("withTrpcEndpoint", () => {
  it("names the page's API path in the head, escaped", () => {
    expect(
      withTrpcEndpoint('<html><head lang="en"><title>gtd</title></head>', '/a"b/gate/trpc'),
    ).toBe(
      '<html><head lang="en"><meta name="gtd-trpc" content="/a&quot;b/gate/trpc"><title>gtd</title></head>',
    )
  })
})
