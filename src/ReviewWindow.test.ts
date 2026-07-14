import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { GitService } from "./Git.js"
import {
  closeReviewWindow,
  openReviewWindow,
  reviewWindowBase,
  REVIEW_BASE_REF,
  REVIEW_HEAD_REF,
} from "./ReviewWindow.js"
import { InMemRepo } from "../tests/integration/support/inmem/Repo.js"
import { makeGitServiceLayer } from "../tests/integration/support/inmem/layers.js"

// ---------------------------------------------------------------------------
// reviewWindowBase — pure base picker over synthetic histories
// ---------------------------------------------------------------------------

const ANCHOR_HASH = "a".repeat(40)

const entry = (hash: string, message: string) => ({ hash, message })

describe("reviewWindowBase", () => {
  it("picks the first grilling turn of the cycle when no review round happened yet", () => {
    const base = reviewWindowBase([
      entry("h1", "chore: boundary"),
      entry("h2", "gtd(human): grilling"),
      entry("h3", "gtd(agent): grilled"),
      entry("h4", "gtd(agent): building"),
      entry("h5", "gtd: awaiting review"), // HEAD — excluded
    ])
    expect(base).toBe("h2")
  })

  it("prefers the previous awaiting-review over the first grilling turn", () => {
    const base = reviewWindowBase([
      entry("h1", "gtd(human): grilling"),
      entry("h2", "gtd: awaiting review"),
      entry("h3", "gtd: review feedback"),
      entry("h4", "gtd(agent): grilling"),
      entry("h5", "gtd: awaiting review"), // HEAD — excluded
    ])
    expect(base).toBe("h2")
  })

  it("prefers a gtd: reviewing anchor over both other rules", () => {
    const base = reviewWindowBase([
      entry("h1", "gtd(human): grilling"),
      entry("h2", "gtd: awaiting review"),
      entry("h3", `gtd: reviewing ${ANCHOR_HASH}`),
      entry("h4", "gtd(agent): review"),
      entry("h5", "gtd: awaiting review"), // HEAD — excluded
    ])
    expect(base).toBe(ANCHOR_HASH)
  })

  it("resets the cycle at the last gtd: done", () => {
    const base = reviewWindowBase([
      entry("h1", "gtd(human): grilling"),
      entry("h2", "gtd: awaiting review"),
      entry("h3", "gtd: done"),
      entry("h4", "gtd(human): grilling"),
      entry("h5", "gtd: awaiting review"), // HEAD — excluded
    ])
    expect(base).toBe("h4")
  })

  it("returns undefined outside a process (no anchor, no grilling, no prior round)", () => {
    const base = reviewWindowBase([
      entry("h1", "chore: boundary"),
      entry("h2", "gtd: awaiting review"), // HEAD — excluded
    ])
    expect(base).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// open/close against the in-memory GitService
// ---------------------------------------------------------------------------

const runWith = <A>(repo: InMemRepo, eff: Effect.Effect<A, Error, GitService>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(makeGitServiceLayer(repo))))

const runWithEither = <A>(repo: InMemRepo, eff: Effect.Effect<A, Error, GitService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(makeGitServiceLayer(repo)), Effect.either))

/** A minimal cycle ending at `gtd: awaiting review` (HEAD). */
const makeReviewRepo = (): InMemRepo => {
  const repo = new InMemRepo()
  repo.writeFile("readme.txt", "hello")
  repo.commitAllWithPrefix("init: first commit")
  repo.writeFile(".gtd/TODO.md", "# Plan")
  repo.commitAllWithPrefix("gtd(human): grilling")
  repo.writeFile("src/code.ts", "export const x = 1")
  repo.commitAllWithPrefix("gtd(agent): building")
  repo.deleteFile(".gtd/TODO.md")
  repo.writeFile(".gtd/REVIEW.md", "# Review\n- [ ] chunk")
  repo.commitAllWithPrefix("gtd(agent): review")
  repo.commitAllWithPrefix("gtd: awaiting review")
  return repo
}

describe("openReviewWindow", () => {
  it("is a no-op when HEAD is not gtd: awaiting review", async () => {
    const repo = new InMemRepo()
    repo.writeFile("readme.txt", "hello")
    repo.commitAllWithPrefix("init: first commit")

    const { opened } = await runWith(repo, openReviewWindow)

    expect(opened).toBe(false)
    expect(repo.resolveRef(REVIEW_HEAD_REF)).toBeNull()
  })

  it("rewinds HEAD/index to the base and saves both refs", async () => {
    const repo = makeReviewRepo()
    const headBefore = repo.resolveRef("HEAD")!
    const grillingHash = repo.commitHistory().find((c) => c.message.startsWith("gtd(human)"))!.hash

    const { opened } = await runWith(repo, openReviewWindow)

    expect(opened).toBe(true)
    expect(repo.resolveRef("HEAD")).toBe(grillingHash)
    expect(repo.resolveRef(REVIEW_HEAD_REF)).toBe(headBefore)
    expect(repo.resolveRef(REVIEW_BASE_REF)).toBe(grillingHash)
    // The package diff is dirty (worktree still holds the built code)…
    expect(repo.statusPorcelain()).toContain("src/code.ts")
    // …but .gtd is pinned back to the saved head: no unstaged noise for it.
    const gtdLines = repo
      .statusPorcelain()
      .split("\n")
      .filter((l) => l.includes(".gtd/"))
    expect(gtdLines.every((l) => !l.startsWith("??") && l[1] === " ")).toBe(true)
  })
})

describe("closeReviewWindow", () => {
  it("is a no-op without a saved ref", async () => {
    const repo = makeReviewRepo()
    const { closed } = await runWith(repo, closeReviewWindow)
    expect(closed).toBe(false)
  })

  it("restores the saved head, deletes the refs, and leaves reviewer edits dirty", async () => {
    const repo = makeReviewRepo()
    const headBefore = repo.resolveRef("HEAD")!
    await runWith(repo, openReviewWindow)
    // The reviewer edits one file on top of the surfaced diff.
    repo.writeFile("src/code.ts", "export const x = 2")

    const { closed } = await runWith(repo, closeReviewWindow)

    expect(closed).toBe(true)
    expect(repo.resolveRef("HEAD")).toBe(headBefore)
    expect(repo.resolveRef(REVIEW_HEAD_REF)).toBeNull()
    expect(repo.resolveRef(REVIEW_BASE_REF)).toBeNull()
    // Only the reviewer's own edit remains dirty.
    expect(repo.statusPorcelain().trim()).toBe("M src/code.ts")
  })

  it("recovers a crash remnant where HEAD never moved off the saved head", async () => {
    const repo = makeReviewRepo()
    const headBefore = repo.resolveRef("HEAD")!
    const grillingHash = repo.commitHistory().find((c) => c.message.startsWith("gtd(human)"))!.hash
    // Simulate a crash between the ref writes and the mixed reset.
    repo.updateRef(REVIEW_BASE_REF, grillingHash)
    repo.updateRef(REVIEW_HEAD_REF, headBefore)

    const { closed } = await runWith(repo, closeReviewWindow)

    expect(closed).toBe(true)
    expect(repo.resolveRef("HEAD")).toBe(headBefore)
    expect(repo.statusPorcelain().trim()).toBe("")
  })

  it("fails loudly and keeps the refs when HEAD left the reviewed branch", async () => {
    const repo = makeReviewRepo()
    const headBefore = repo.resolveRef("HEAD")!
    await runWith(repo, openReviewWindow)
    // Simulate a checkout to an unrelated point: the base is no longer an
    // ancestor of HEAD (the root commit predates the base).
    repo.softResetTo(repo.commitHistory()[0]!.hash)

    const result = await runWithEither(repo, closeReviewWindow)

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left.message).toContain("review checkout window")
    }
    expect(repo.resolveRef(REVIEW_HEAD_REF)).toBe(headBefore)
  })
})
