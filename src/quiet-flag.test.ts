import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { QuietMode } from "./services/QuietMode.js"

describe("--quiet flag", () => {
  it("QuietMode layer provides isQuiet=false by default", async () => {
    const result = await Effect.runPromise(
      QuietMode.pipe(Effect.provide(QuietMode.layer(false))),
    )
    expect(result.isQuiet).toBe(false)
  })

  it("QuietMode layer provides isQuiet=true when quiet", async () => {
    const result = await Effect.runPromise(
      QuietMode.pipe(Effect.provide(QuietMode.layer(true))),
    )
    expect(result.isQuiet).toBe(true)
  })

  it("downstream effects can read quiet mode from context", async () => {
    const program = Effect.gen(function* () {
      const { isQuiet } = yield* QuietMode
      return isQuiet
    })

    const quiet = await Effect.runPromise(
      program.pipe(Effect.provide(QuietMode.layer(true))),
    )
    expect(quiet).toBe(true)

    const notQuiet = await Effect.runPromise(
      program.pipe(Effect.provide(QuietMode.layer(false))),
    )
    expect(notQuiet).toBe(false)
  })
})
