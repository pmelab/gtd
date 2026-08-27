import { Effect, Option } from "effect"
import { describe, expect, it, vi } from "vitest"
import { strictGitOperations as stubGit } from "./testing/GitDoubles.js"
import {
  clearRetainedHistory,
  HISTORY_REF,
  readRetainedHistory,
  restorability,
} from "./RetainedHistory.js"

/**
 * Unit coverage for the retention edge module (`src/RetainedHistory.ts`),
 * using `strictGitOperations` (`src/testing/GitDoubles.ts`) as its
 * `GitOperations` double — a Proxy failing on any method a test didn't
 * override, so an unexpected call fails loudly instead of silently succeeding.
 */

const run = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect)

describe("readRetainedHistory", () => {
  it("returns Option.none() when readRefOption resolves to none", async () => {
    const git = stubGit({ readRefOption: () => Effect.succeed(Option.none()) })
    const result = await run(readRetainedHistory(git))
    expect(Option.isNone(result)).toBe(true)
  })

  it("returns Option.some(hash) when readRefOption resolves to some hash", async () => {
    const git = stubGit({ readRefOption: () => Effect.succeed(Option.some("abc123")) })
    const result = await run(readRetainedHistory(git))
    expect(result).toEqual(Option.some("abc123"))
  })
})

describe("restorability", () => {
  it("HEAD === tipHash (the degenerate ancestor case) is safe", async () => {
    const git = stubGit({ isAncestor: () => Effect.succeed(true) })
    const result = await run(restorability(git, "tip123", "tip123"))
    expect(result).toEqual({ ok: true })
  })

  it("cleaned abandon / fast-forward — headHash !== tipHash, isAncestor true — is safe", async () => {
    const git = stubGit({ isAncestor: () => Effect.succeed(true) })
    const result = await run(restorability(git, "head789", "tip123"))
    expect(result).toEqual({ ok: true })
  })

  it("refuses when HEAD is not an ancestor of the retained tip", async () => {
    const git = stubGit({ isAncestor: () => Effect.succeed(false) })
    const result = await run(restorability(git, "head789", "tip123"))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(typeof result.reason).toBe("string")
      expect(result.reason.length).toBeGreaterThan(0)
    }
  })
})

describe("clearRetainedHistory", () => {
  it("deletes HISTORY_REF", async () => {
    const deleteRef = vi.fn(() => Effect.succeed(undefined))
    const git = stubGit({ deleteRef })
    await run(clearRetainedHistory(git))
    expect(deleteRef).toHaveBeenCalledWith(HISTORY_REF)
  })
})
