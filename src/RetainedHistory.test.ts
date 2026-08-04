import { Effect, Option } from "effect"
import { describe, expect, it, vi } from "vitest"
import type { GitOperations } from "./Git.js"
import {
  clearRetainedHistory,
  HISTORY_REF,
  readRetainedHistory,
  restorability,
  retainHistory,
  withHistoryTrailer,
} from "./RetainedHistory.js"

/**
 * Unit coverage for the retention edge module (`src/RetainedHistory.ts`),
 * mirroring `src/ReviewWindow.ts`'s own `stubGit`-style test-double pattern
 * (see `src/Edge.test.ts`): a plain `GitOperations` stub with every method
 * failing by default, so an unexpected call fails loudly instead of silently
 * succeeding.
 */

const notImplemented = (name: string) => () =>
  Effect.fail(new Error(`${name} should not have been called by this test`))

const stubGit = (overrides: Partial<GitOperations>): GitOperations => ({
  readFileAtRef: notImplemented("readFileAtRef"),
  lastCommitSubject: notImplemented("lastCommitSubject"),
  lastCommitMessage: notImplemented("lastCommitMessage"),
  hasCommits: notImplemented("hasCommits"),
  resolveRef: notImplemented("resolveRef"),
  readRefOption: notImplemented("readRefOption"),
  isAncestor: notImplemented("isAncestor"),
  topLevel: notImplemented("topLevel"),
  commitHistory: notImplemented("commitHistory"),
  changedPathsSince: notImplemented("changedPathsSince"),
  changedPaths: notImplemented("changedPaths"),
  commitAllWithPrefix: notImplemented("commitAllWithPrefix"),
  softResetTo: notImplemented("softResetTo"),
  commitAsIs: notImplemented("commitAsIs"),
  discardPending: notImplemented("discardPending"),
  updateRef: notImplemented("updateRef"),
  deleteRef: notImplemented("deleteRef"),
  mixedResetTo: notImplemented("mixedResetTo"),
  hardResetTo: notImplemented("hardResetTo"),
  restoreStagedFrom: notImplemented("restoreStagedFrom"),
  addIntentToAdd: notImplemented("addIntentToAdd"),
  ...overrides,
})

const run = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect)

describe("retainHistory", () => {
  it("points HISTORY_REF at the tip hash in the normal case", async () => {
    const updateRef = vi.fn(() => Effect.succeed(undefined))
    const git = stubGit({ updateRef })
    await run(retainHistory(git, "tip123", "start456"))
    expect(updateRef).toHaveBeenCalledWith(HISTORY_REF, "tip123")
  })

  it("is a no-op (skips the git call entirely) when tipHash === startParentHash", async () => {
    const updateRef = vi.fn(() => Effect.succeed(undefined))
    const git = stubGit({ updateRef })
    await run(retainHistory(git, "same123", "same123"))
    expect(updateRef).not.toHaveBeenCalled()
  })
})

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
  it("(a) fresh squash — HEAD is the new squash commit, distinct from the retained tip, with a matching trailer — is safe", async () => {
    const git = stubGit({})
    const message = withHistoryTrailer("gtd(agent): squashed feature", "tip123")
    const result = await run(restorability(git, "squashHead999", message, "tip123"))
    expect(result).toEqual({ ok: true })
  })

  it("(a) also passes in the degenerate case headHash === tipHash, as long as the trailer matches", async () => {
    const git = stubGit({})
    const message = withHistoryTrailer("gtd(agent): squashed feature", "tip123")
    const result = await run(restorability(git, "tip123", message, "tip123"))
    expect(result).toEqual({ ok: true })
  })

  it("(a) with a mismatched trailer hash falls through to rule (b) — ok when isAncestor is true", async () => {
    const message = withHistoryTrailer("gtd(agent): squashed feature", "someOtherTip")
    const git = stubGit({ isAncestor: () => Effect.succeed(true) })
    const result = await run(restorability(git, "tip123", message, "tip123"))
    expect(result).toEqual({ ok: true })
  })

  it("(a) with a mismatched trailer hash falls through to rule (b) — refused when isAncestor is false", async () => {
    const message = withHistoryTrailer("gtd(agent): squashed feature", "someOtherTip")
    const git = stubGit({ isAncestor: () => Effect.succeed(false) })
    const result = await run(restorability(git, "tip123", message, "tip123"))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
  })

  it("(b) cleaned abandon / fast-forward — headHash !== tipHash, isAncestor true — is safe", async () => {
    const git = stubGit({ isAncestor: () => Effect.succeed(true) })
    const result = await run(restorability(git, "head789", "chore: cleanup", "tip123"))
    expect(result).toEqual({ ok: true })
  })

  it("refuses when HEAD is neither the tip nor an ancestor of it", async () => {
    const git = stubGit({ isAncestor: () => Effect.succeed(false) })
    const result = await run(restorability(git, "head789", "chore: unrelated", "tip123"))
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
