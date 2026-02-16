import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { QuietMode } from "./QuietMode.js"

describe("QuietMode", () => {
  it("defaults to not quiet", async () => {
    const result = await Effect.runPromise(
      QuietMode.pipe(Effect.provide(QuietMode.layer(false))),
    )
    expect(result.isQuiet).toBe(false)
  })

  it("can be set to quiet", async () => {
    const result = await Effect.runPromise(
      QuietMode.pipe(Effect.provide(QuietMode.layer(true))),
    )
    expect(result.isQuiet).toBe(true)
  })
})
