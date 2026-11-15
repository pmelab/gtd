import { describe, expect, it } from "vitest"
import { feed } from "../workspace/index.js"
import { testFeed } from "./TestFeed.js"

const issues = feed({
  project: "portal",
  every: "5m",
  mode: "queue",
  poll: async (ctx) => {
    const out = await ctx.exec(["gh", "issue", "list"])
    ctx.log(`found ${out.stdout.trim()}`)
    return out.stdout
      .trim()
      .split(",")
      .filter(Boolean)
      .map((n) => ({
        key: n,
        title: `Issue ${n}`,
        action: "start:feature",
        priority: Number(n),
        ...(n === "3" ? { blockedBy: ["1"] } : {}),
      }))
  },
  canStart: async (item, ctx) => (await ctx.exec(["ready", item.key])).status === 0,
})

describe("testFeed", () => {
  it("shows the inbox a poll leaves, with what gtd adds to each item", async () => {
    const run = testFeed(issues, {
      exec: () => ({ status: 0, stdout: "1,3\n", stderr: "" }),
      clock: () => new Date("2026-03-01T10:00:00Z"),
    })

    const { items, failure, logs } = await run.poll()

    expect(failure).toBeUndefined()
    expect(logs).toEqual(["found 1,3"])
    expect(items).toEqual([
      {
        feed: "feed",
        project: "portal",
        key: "3",
        title: "Issue 3",
        action: "start:feature",
        priority: 3,
        blockedBy: ["1"],
        data: null,
        state: "blocked",
        firstSeen: "2026-03-01T10:00:00.000Z",
      },
      {
        feed: "feed",
        project: "portal",
        key: "1",
        title: "Issue 1",
        action: "start:feature",
        priority: 1,
        blockedBy: [],
        data: null,
        state: "queued",
        firstSeen: "2026-03-01T10:00:00.000Z",
      },
    ])
  })

  it("drops a waiting item the next poll no longer returns and keeps when a key was first seen", async () => {
    let stdout = "1,2"
    let now = new Date("2026-03-01T10:00:00Z")
    const run = testFeed(issues, {
      exec: () => ({ status: 0, stdout, stderr: "" }),
      clock: () => now,
    })
    await run.poll()
    stdout = "2,4"
    now = new Date("2026-03-01T10:05:00Z")

    const { items } = await run.poll()

    expect(items.map((i) => [i.key, i.firstSeen])).toEqual([
      ["4", "2026-03-01T10:05:00.000Z"],
      ["2", "2026-03-01T10:00:00.000Z"],
    ])
  })

  it("keeps a dismissed item hidden while the feed returns it", async () => {
    const proposals = feed({ ...issues, mode: "propose" })
    const run = testFeed(proposals, { exec: () => ({ status: 0, stdout: "1,2", stderr: "" }) })
    await run.poll()

    run.dismiss("1")

    expect((await run.poll()).items.map((i) => i.key)).toEqual(["2"])
  })

  it("dismisses only proposed items", async () => {
    const run = testFeed(issues, { exec: () => ({ status: 0, stdout: "1", stderr: "" }) })
    await run.poll()

    expect(() => run.dismiss("1")).toThrow("testFeed: no proposed item 1")
  })

  it("reports a throwing poll as the feed failing and leaves the inbox as it was", async () => {
    let fail = false
    const run = testFeed(issues, {
      exec: () => {
        if (fail) throw new Error("gh: not logged in")
        return { status: 0, stdout: "1", stderr: "" }
      },
    })
    await run.poll()
    fail = true

    const { items, failure } = await run.poll()

    expect(failure).toBe("gh: not logged in")
    expect(items.map((i) => i.key)).toEqual(["1"])
  })

  it("reports a malformed item as the feed failing", async () => {
    const broken = feed({
      project: "portal",
      every: "1m",
      mode: "propose",
      poll: () => [{ key: "1", title: "", action: "start:x", priority: 0 }],
    })

    expect((await testFeed(broken).poll()).failure).toBe(
      "item 0: title: must be a non-empty string",
    )
  })

  it("runs canStart with the same ctx", async () => {
    const run = testFeed(issues, {
      exec: (argv) => ({ status: argv[1] === "1" ? 0 : 1, stdout: "", stderr: "" }),
    })
    const item = { key: "1", title: "Issue 1", action: "start:feature", priority: 1 }

    expect(await run.canStart(item)).toBe(true)
    expect(await run.canStart({ ...item, key: "2" })).toBe(false)
  })

  it("fails a poll that runs a command the test did not script", async () => {
    expect((await testFeed(issues).poll()).failure).toBe(
      "testFeed: no exec given for gh issue list",
    )
  })
})
