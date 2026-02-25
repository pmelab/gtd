import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { VerboseMode } from "./services/VerboseMode.js"

describe("--verbose flag", () => {
  it("VerboseMode layer provides isVerbose=false by default", async () => {
    const result = await Effect.runPromise(
      VerboseMode.pipe(Effect.provide(VerboseMode.layer(false))),
    )
    expect(result.isVerbose).toBe(false)
  })

  it("VerboseMode layer provides isVerbose=true when verbose", async () => {
    const result = await Effect.runPromise(
      VerboseMode.pipe(Effect.provide(VerboseMode.layer(true))),
    )
    expect(result.isVerbose).toBe(true)
  })

  it("downstream effects can read verbose mode from context", async () => {
    const program = Effect.gen(function* () {
      const { isVerbose } = yield* VerboseMode
      return isVerbose
    })

    const verbose = await Effect.runPromise(
      program.pipe(Effect.provide(VerboseMode.layer(true))),
    )
    expect(verbose).toBe(true)

    const notVerbose = await Effect.runPromise(
      program.pipe(Effect.provide(VerboseMode.layer(false))),
    )
    expect(notVerbose).toBe(false)
  })
})
