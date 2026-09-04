import { describe, expect, it } from "vitest"
import type { BeatRead, WorktreeRef } from "./Beat.js"
import { bucketOf, groupIntoBuckets, readFleet, wantsYouCount } from "./Fleet.js"

const row = (over: Partial<Extract<BeatRead, { status: "ok" }>> = {}): BeatRead => ({
  status: "ok",
  id: "id",
  path: "/repos/x",
  repo: "gtd",
  branch: "main",
  label: "doing",
  kind: "prompt",
  actor: "human",
  idle: false,
  rest: "2026-08-01T10:00:00Z",
  ...over,
})

const brokenRow = (over: Partial<Extract<BeatRead, { status: "broken" }>> = {}): BeatRead => ({
  status: "broken",
  id: "id",
  path: "/repos/x",
  repo: "gtd",
  branch: "main",
  detail: "boom",
  ...over,
})

describe("bucketOf", () => {
  it("puts an idle worktree with a human actor in Quiet, never Wants you", () => {
    expect(bucketOf(row({ idle: true, actor: "human" }))).toBe("quiet")
  })

  it("puts a not-idle worktree with a human actor in Wants you", () => {
    expect(bucketOf(row({ idle: false, actor: "human" }))).toBe("wants-you")
  })

  it("puts a stalled kind in Wants you regardless of actor or idle", () => {
    expect(bucketOf(row({ kind: "stalled", idle: true, actor: "agent" }))).toBe("wants-you")
  })

  it("puts a not-idle worktree with an agent actor in neither Wants you nor Quiet", () => {
    const bucket = bucketOf(row({ idle: false, actor: "agent" }))
    expect(bucket).not.toBe("wants-you")
    expect(bucket).not.toBe("quiet")
  })

  it("puts a broken row in Broken", () => {
    expect(bucketOf(brokenRow())).toBe("broken")
  })
})

describe("groupIntoBuckets", () => {
  it("sorts Wants you oldest-rest-first and every other bucket newest-first", () => {
    const older = row({ id: "older", rest: "2026-01-01T00:00:00Z", actor: "human", idle: false })
    const newer = row({ id: "newer", rest: "2026-06-01T00:00:00Z", actor: "human", idle: false })
    const wantsYou = groupIntoBuckets([older, newer])["wants-you"]
    expect(wantsYou.map((r) => r.id)).toEqual(["older", "newer"])

    const olderQuiet = row({ id: "older-q", rest: "2026-01-01T00:00:00Z", idle: true })
    const newerQuiet = row({ id: "newer-q", rest: "2026-06-01T00:00:00Z", idle: true })
    const quiet = groupIntoBuckets([olderQuiet, newerQuiet]).quiet
    expect(quiet.map((r) => r.id)).toEqual(["newer-q", "older-q"])
  })

  it("lists every worktree found, including a broken one, without dropping any", () => {
    const buckets = groupIntoBuckets([row({ id: "a" }), brokenRow({ id: "b" })])
    const all = Object.values(buckets).flat()
    expect(all.map((r) => r.id).sort()).toEqual(["a", "b"])
  })
})

describe("wantsYouCount", () => {
  it("counts only the Wants you bucket", () => {
    const buckets = groupIntoBuckets([
      row({ id: "a", actor: "human", idle: false }),
      row({ id: "b", idle: true }),
    ])
    expect(wantsYouCount(buckets)).toBe(1)
  })
})

describe("readFleet", () => {
  it("keeps one broken worktree from failing the whole fleet request", async () => {
    const result = await readFleet({
      roots: [],
      readBeat: async (w: WorktreeRef): Promise<BeatRead> => {
        if (w.id === "throws") throw new Error("boom")
        return row({ id: w.id })
      },
    })
    expect(result.wantsYouCount).toBe(0)
  })

  it("a fleet payload for 30 worktrees stays under 32 KB", async () => {
    const worktrees = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, path: `/repos/w${i}` }))
    const readBeat = async (w: WorktreeRef) => row({ id: w.id, path: w.path })
    const buckets = groupIntoBuckets(await Promise.all(worktrees.map(readBeat)))
    const size = Buffer.byteLength(JSON.stringify(buckets), "utf8")
    expect(size).toBeLessThan(32 * 1024)
  })
})
