import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { BeatRead, WorktreeRef } from "./Beat.js"
import { bucketOf, groupIntoBuckets, readFleet, wantsYouCount } from "./Fleet.js"
import { Registry } from "./Registry.js"
import type { LoopChild } from "./Loop.js"

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

  it("a registry entry always wins, even over an otherwise-Broken row", () => {
    expect(bucketOf(brokenRow(), true)).toBe("working")
  })
})

describe("groupIntoBuckets with a Registry", () => {
  const fakeChild: LoopChild = { wait: new Promise(() => {}), interrupt: vi.fn(), kill: vi.fn() }

  it("puts a driven worktree in Working regardless of its own beat", () => {
    const registry = new Registry()
    registry.register("driven", fakeChild)
    const buckets = groupIntoBuckets([row({ id: "driven", idle: true, actor: "human" })], {
      registry,
    })
    expect(buckets.working.map((r) => r.id)).toEqual(["driven"])
    expect(buckets["wants-you"]).toHaveLength(0)
  })

  it("flags a recently-touched log with no registry entry as possibly foreign-driven", () => {
    const registry = new Registry()
    const now = 1_000_000
    const buckets = groupIntoBuckets([row({ id: "foreign", logMtime: now - 1_000 })], {
      registry,
      now,
    })
    const entry = Object.values(buckets)
      .flat()
      .find((r) => r.id === "foreign")
    expect(entry?.foreignDriverPossible).toBe(true)
  })

  it("does not flag a worktree the registry itself is driving as foreign", () => {
    const registry = new Registry()
    registry.register("driven", fakeChild)
    const now = 1_000_000
    const buckets = groupIntoBuckets([row({ id: "driven", logMtime: now - 1_000, idle: true })], {
      registry,
      now,
    })
    const entry = buckets.working.find((r) => r.id === "driven")
    expect(entry?.foreignDriverPossible).toBe(false)
  })

  it("without a registry, every row's foreignDriverPossible is false", () => {
    const buckets = groupIntoBuckets([row({ id: "a" })])
    const entry = Object.values(buckets)
      .flat()
      .find((r) => r.id === "a")
    expect(entry?.foreignDriverPossible).toBe(false)
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

  it("sorts by the parsed instant, not the ISO string, across differing UTC offsets", () => {
    // `2026-09-07T01:00:00+02:00` is 2026-09-06T23:00Z — the OLDER instant.
    // `2026-09-06T23:30:00-05:00` is 2026-09-07T04:30Z — the newer one.
    // Lexically the first string sorts greater than the second, the exact
    // reverse of their real order — a naive string compare would put the
    // longest-waiting worktree last in Wants you instead of first.
    const trulyOlder = row({
      id: "truly-older",
      rest: "2026-09-07T01:00:00+02:00",
      actor: "human",
      idle: false,
    })
    const trulyNewer = row({
      id: "truly-newer",
      rest: "2026-09-06T23:30:00-05:00",
      actor: "human",
      idle: false,
    })
    const wantsYou = groupIntoBuckets([trulyNewer, trulyOlder])["wants-you"]
    expect(wantsYou.map((r) => r.id)).toEqual(["truly-older", "truly-newer"])
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
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it("keeps one broken worktree from failing the whole fleet request", async () => {
    // A real root with two genuinely discoverable worktrees — `roots: []`
    // (the prior version of this test) makes `discoverWorktrees` find
    // nothing, so `readBeat` never runs at all and the throwing branch below
    // is dead code the test never exercises.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-fleet-")))
    dirs.push(root)
    const goodPath = join(root, "good")
    const throwingPath = join(root, "throws")
    mkdirSync(join(goodPath, ".git"), { recursive: true })
    mkdirSync(join(throwingPath, ".git"), { recursive: true })

    const result = await readFleet({
      roots: [root],
      readBeat: async (w: WorktreeRef): Promise<BeatRead> => {
        if (w.path === throwingPath) throw new Error("boom")
        return row({ id: w.id, path: w.path, idle: true })
      },
    })

    const all = Object.values(result.buckets).flat()
    expect(all).toHaveLength(2)
    const good = all.find((r) => r.path === goodPath)
    const broken = all.find((r) => r.path === throwingPath)
    expect(good?.status).toBe("ok")
    expect(broken?.status).toBe("broken")
    if (broken?.status === "broken") expect(broken.detail).toBe("boom")
  })

  it("a fleet payload for 30 worktrees stays under 32 KB", async () => {
    const worktrees = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, path: `/repos/w${i}` }))
    const readBeat = async (w: WorktreeRef) => row({ id: w.id, path: w.path })
    const buckets = groupIntoBuckets(await Promise.all(worktrees.map(readBeat)))
    const size = Buffer.byteLength(JSON.stringify(buckets), "utf8")
    expect(size).toBeLessThan(32 * 1024)
  })
})
