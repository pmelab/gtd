/**
 * `src/BeatMarker.ts` — the pure `isSameBeat`/`hashContent` helpers, then
 * `resolveDispatch`'s read→compare→clear-or-arm round trip against the
 * in-memory tier (`testLayers`).
 */

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { GitService } from "./Git.js"
import {
  hashContent,
  isSameBeat,
  resolveDispatch,
  type Beat,
  type BeatRecord,
} from "./BeatMarker.js"
import { fakeGitOperations } from "./testing/GitDoubles.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { testLayers } from "./testing/Layers.js"

describe("isSameBeat", () => {
  const beat: Beat = { state: "build.fix", content: "abc123", head: "deadbeef" }
  const record: BeatRecord = { state: "build.fix", content: "abc123", head: "deadbeef" }

  it("is true when state, content, and head all match", () => {
    expect(isSameBeat(record, beat)).toBe(true)
  })

  it("is false when only state differs", () => {
    expect(isSameBeat({ ...record, state: "build.check" }, beat)).toBe(false)
  })

  it("is false when only content differs", () => {
    expect(isSameBeat({ ...record, content: "different" }, beat)).toBe(false)
  })

  it("is false when only head differs", () => {
    expect(isSameBeat({ ...record, head: "otherhash" }, beat)).toBe(false)
  })

  it("treats an unborn HEAD's empty string like any other head value", () => {
    const unbornBeat: Beat = { ...beat, head: "" }
    const unbornRecord: BeatRecord = { ...record, head: "" }
    expect(isSameBeat(unbornRecord, unbornBeat)).toBe(true)
    expect(isSameBeat(record, unbornBeat)).toBe(false)
  })
})

describe("hashContent", () => {
  it("is stable for the same input", () => {
    expect(hashContent("prompt text")).toBe(hashContent("prompt text"))
  })

  it("differs for different input", () => {
    expect(hashContent("prompt text")).not.toBe(hashContent("other text"))
  })

  it("is a lowercase hex sha256 digest", () => {
    expect(hashContent("x")).toMatch(/^[0-9a-f]{64}$/)
  })
})

const runDispatch = (repo: InMemRepo, beat: Beat): Promise<boolean> =>
  Effect.runPromise(resolveDispatch(beat).pipe(Effect.provide(testLayers(repo))))

const readMarker = (repo: InMemRepo): string | undefined =>
  repo.readGitDirFile("/repo/.git/gtd-beat")

describe("resolveDispatch", () => {
  const beat: Beat = { state: "build.fix", content: hashContent("do the thing"), head: "" }

  it("arms the marker on the first dispatch and reports not stalled", async () => {
    const repo = new InMemRepo()
    const stalled = await runDispatch(repo, beat)
    expect(stalled).toBe(false)
    expect(readMarker(repo)).toBe(JSON.stringify(beat))
  })

  it("reports stalled on the exact same beat dispatched again, and consumes the marker", async () => {
    const repo = new InMemRepo()
    await runDispatch(repo, beat)
    const stalled = await runDispatch(repo, beat)
    expect(stalled).toBe(true)
    expect(readMarker(repo)).toBeUndefined()
  })

  it("a third dispatch after a consumed stall report is clean (arms fresh, not stalled)", async () => {
    const repo = new InMemRepo()
    await runDispatch(repo, beat)
    await runDispatch(repo, beat) // consumes, reports stalled
    const third = await runDispatch(repo, beat)
    expect(third).toBe(false)
    expect(readMarker(repo)).toBe(JSON.stringify(beat))
  })

  it("does not report stalled when HEAD moved between dispatches, even with identical state/content", async () => {
    const repo = new InMemRepo()
    await runDispatch(repo, beat)
    const afterCommit: Beat = { ...beat, head: "abc1234" }
    const stalled = await runDispatch(repo, afterCommit)
    expect(stalled).toBe(false)
    expect(readMarker(repo)).toBe(JSON.stringify(afterCommit))
  })

  it("reads corrupt marker bytes as no record — arms fresh instead of throwing", async () => {
    const repo = new InMemRepo()
    repo.writeGitDirFile("/repo/.git/gtd-beat", "{ not json")
    const stalled = await runDispatch(repo, beat)
    expect(stalled).toBe(false)
    expect(readMarker(repo)).toBe(JSON.stringify(beat))
  })

  it("degrades to not-stalled, without throwing, when the git dir is unreadable", async () => {
    const repo = new InMemRepo()
    const failingGit = { ...fakeGitOperations(repo), gitDir: () => Effect.fail(new Error("nope")) }
    const result = await Effect.runPromise(
      resolveDispatch(beat).pipe(
        Effect.provideService(GitService, failingGit),
        Effect.provide(testLayers(repo)),
      ),
    )
    expect(result).toBe(false)
    expect(readMarker(repo)).toBeUndefined()
  })
})
