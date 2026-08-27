import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { GtdError, Narrator, renderFailure } from "./Commentary.js"
import { PRESENTATION_FAILURE_WARNING } from "./Emit.js"

describe("Narrator", () => {
  it("is a no-op writer when built with verbose: false", async () => {
    const lines: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const narrator = yield* Narrator
        yield* narrator.narrate("hello")
      }).pipe(Effect.provide(Narrator.layer((chunk) => lines.push(chunk), false))),
    )
    expect(lines).toEqual([])
  })

  it("writes each narrated line, newline-terminated, when verbose: true", async () => {
    const lines: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const narrator = yield* Narrator
        yield* narrator.narrate("rest resolved: build.review.deciding")
        yield* narrator.narrate("config: layer /repo/.gtdrc")
      }).pipe(Effect.provide(Narrator.layer((chunk) => lines.push(chunk), true))),
    )
    expect(lines).toEqual([
      "rest resolved: build.review.deciding\n",
      "config: layer /repo/.gtdrc\n",
    ])
  })

  it("warn writes to the sink even when verbose: false", async () => {
    const lines: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const narrator = yield* Narrator
        yield* narrator.warn("careful: something odd")
      }).pipe(Effect.provide(Narrator.layer((chunk) => lines.push(chunk), false))),
    )
    expect(lines).toEqual(["careful: something odd\n"])
  })

  it("warn writes to the sink when verbose: true too", async () => {
    const lines: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const narrator = yield* Narrator
        yield* narrator.warn("careful: something odd")
      }).pipe(Effect.provide(Narrator.layer((chunk) => lines.push(chunk), true))),
    )
    expect(lines).toEqual(["careful: something odd\n"])
  })
})

describe("GtdError", () => {
  it("carries a message and a detail list, defaulting detail to empty", () => {
    const bare = new GtdError("boom")
    expect(bare.message).toBe("boom")
    expect(bare.detail).toEqual([])

    const detailed = new GtdError("boom", ["because X", "because Y"])
    expect(detailed.message).toBe("boom")
    expect(detailed.detail).toEqual(["because X", "because Y"])
  })

  it("is a genuine Error — every `error instanceof Error` normalization idiom still catches it", () => {
    expect(new GtdError("boom")).toBeInstanceOf(Error)
  })
})

describe("renderFailure", () => {
  it("prefixes a bare message with 'gtd: '", () => {
    expect(renderFailure(new Error("boom"))).toBe("gtd: boom")
  })

  it("does not double-prefix a message that already starts with 'gtd:'", () => {
    expect(renderFailure(new Error("gtd: already prefixed"))).toBe("gtd: already prefixed")
  })

  it("does not double-prefix a message that already starts with 'gtd '", () => {
    expect(renderFailure(new Error("gtd land: out of turn"))).toBe("gtd land: out of turn")
  })

  it("stringifies a non-Error thrown value", () => {
    expect(renderFailure("just a string")).toBe("gtd: just a string")
  })

  it("prints a GtdError's detail lines, each indented two spaces, after the prefixed message", () => {
    const error = new GtdError("gtd: bad config", ["testCommand: .gtdrc.json"])
    expect(renderFailure(error)).toBe("gtd: bad config\n  testCommand: .gtdrc.json")
  })

  it("prints every detail line, in order, for a multi-detail GtdError", () => {
    const error = new GtdError("boom", ["first", "second"])
    expect(renderFailure(error)).toBe("gtd: boom\n  first\n  second")
  })

  it("a plain Error (the ~100 unmigrated sites) still renders as exactly one line", () => {
    expect(renderFailure(new Error("plain failure"))).not.toContain("\n")
  })
})

describe("the emitted script's own stderr shape stays cross-referenced here", () => {
  // `Emit.ts`'s discarded-optional-failure warning is written by a SCRIPT gtd
  // emits, not by gtd's own process — so it never goes through `renderFailure`
  // — but it lands on the same commentary channel this module owns, so its
  // wording is pinned alongside every other stderr shape rather than only in
  // `Emit.test.ts`.
  it("is gtd:-prefixed, matching this channel's own convention", () => {
    expect(PRESENTATION_FAILURE_WARNING).toContain("gtd: presentation-only follow-up failed")
  })
})
