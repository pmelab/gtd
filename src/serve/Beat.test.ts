/**
 * Coverage for `BeatCache`/`isSupportedVersion`: every dependency
 * (`run`/`readPackageVersion`/`headSha`/`statMtime`) is a scripted fake — no
 * real subprocess, no real filesystem — so call counts can be asserted
 * exactly (T3's "spawns zero subprocesses" claims).
 */

import { describe, expect, it, vi } from "vitest"
import { BeatCache, isSupportedVersion, type BeatDeps, type SpawnOutcome } from "./Beat.js"

const ok = (stdout: string, stderr = ""): SpawnOutcome => ({ status: 0, stdout, stderr })
const failed = (stderr: string, status = 1): SpawnOutcome => ({ status, stdout: "", stderr })
const spawnFailed = (message: string): SpawnOutcome => ({
  status: null,
  stdout: "",
  stderr: "",
  spawnError: message,
})

const GIT_META: Record<string, string> = {
  "git rev-parse --path-format=absolute --git-common-dir": "/repos/gtd/.git\n",
  "git rev-parse --abbrev-ref HEAD": "main\n",
  "git log -1 --format=%cI HEAD": "2026-08-01T10:00:00+00:00\n",
}

const beatJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    kind: "prompt",
    idle: false,
    actor: "human",
    label: "do the thing",
    state: "doing",
    file: ".gtd/TODO.md",
    log: "/repos/gtd/.git/gtd-loop.log",
    ...over,
  })

interface FakeDeps {
  readonly run: ReturnType<typeof vi.fn<BeatDeps["run"]>>
  readonly headSha: ReturnType<typeof vi.fn<BeatDeps["headSha"]>>
  readonly statMtime: ReturnType<typeof vi.fn<BeatDeps["statMtime"]>>
  readonly readPackageVersion: ReturnType<typeof vi.fn<BeatDeps["readPackageVersion"]>>
  readonly runCalls: string[]
  readonly headShaCalls: number
  readonly statCalls: string[]
}

const makeDeps = (
  overrides: {
    readonly beatOutcome?: SpawnOutcome
    readonly version?: string | undefined
    readonly headSha?: string | undefined
    readonly fileMtime?: number | undefined
    readonly logMtime?: number | undefined
  } = {},
): FakeDeps => {
  const runCalls: string[] = []
  const statCalls: string[] = []
  let headShaCalls = 0

  const run = vi.fn(async (_cwd: string, command: string): Promise<SpawnOutcome> => {
    runCalls.push(command)
    if (command === "gtd next --json") return overrides.beatOutcome ?? ok(beatJson())
    const canned = GIT_META[command]
    return canned !== undefined ? ok(canned) : failed(`unscripted command: ${command}`)
  })

  const headSha = vi.fn(async () => {
    headShaCalls++
    return overrides.headSha ?? "a".repeat(40)
  })

  const statMtime = vi.fn(async (path: string) => {
    statCalls.push(path)
    if (path.endsWith("TODO.md")) return overrides.fileMtime ?? 1
    if (path.endsWith("gtd-loop.log")) return overrides.logMtime ?? 1
    return undefined
  })

  const readPackageVersion = vi.fn(async () => overrides.version)

  return {
    run,
    headSha,
    statMtime,
    readPackageVersion,
    get runCalls() {
      return runCalls
    },
    get headShaCalls() {
      return headShaCalls
    },
    get statCalls() {
      return statCalls
    },
  }
}

describe("isSupportedVersion", () => {
  it("accepts a version whose major matches", () => {
    expect(isSupportedVersion("10.5.0", 10)).toBe(true)
  })

  it("rejects a version whose major differs", () => {
    expect(isSupportedVersion("11.0.0", 10)).toBe(false)
  })
})

describe("BeatCache.read — ok rows", () => {
  it("never carries content or system fields, only the projected five plus identity", async () => {
    const deps = makeDeps()
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("ok")
    expect(Object.keys(result).sort()).toEqual(
      ["actor", "branch", "id", "idle", "kind", "label", "path", "repo", "rest", "status"].sort(),
    )
  })

  it("sets rest to HEAD's committer date", async () => {
    const deps = makeDeps()
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("ok")
    if (result.status === "ok") expect(result.rest).toBe("2026-08-01T10:00:00+00:00")
  })

  it("falls back to the state name when the beat has no label", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ label: undefined, state: "reviewing" })) })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("ok")
    if (result.status === "ok") expect(result.label).toBe("reviewing")
  })
})

describe("BeatCache.read — the error taxonomy (T5)", () => {
  it("a worktree with no gtd config renders as a normal message row, not Broken", async () => {
    const deps = makeDeps({
      beatOutcome: {
        status: 0,
        stdout: beatJson({ kind: "message" }),
        stderr: "workflow warning: no vars declared\n",
      },
    })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("ok")
    if (result.status === "ok") expect(result.kind).toBe("message")
  })

  it("a non-zero exit puts the row in Broken with stderr shown verbatim", async () => {
    const deps = makeDeps({ beatOutcome: failed("gtd: refused, dirty tree\n") })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("broken")
    if (result.status === "broken") expect(result.detail).toBe("gtd: refused, dirty tree\n")
  })

  it("a spawn failure puts the row in Broken", async () => {
    const deps = makeDeps({ beatOutcome: spawnFailed("spawn bash ENOENT") })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("broken")
    if (result.status === "broken") expect(result.detail).toBe("spawn bash ENOENT")
  })

  it("output that is not valid JSON puts the row in Broken", async () => {
    const deps = makeDeps({ beatOutcome: ok("not json at all") })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("broken")
  })

  it("a version outside the supported range puts the row in Broken and names the version found", async () => {
    const deps = makeDeps({ version: "999.0.0" })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("broken")
    if (result.status === "broken") expect(result.detail).toContain("999.0.0")
    expect(deps.runCalls).not.toContain("gtd next --json")
  })

  it("one Broken worktree does not affect another read from the same cache", async () => {
    const cache = new BeatCache(makeDeps(), 8)
    const brokenDeps = makeDeps({ beatOutcome: failed("boom") })
    const brokenCache = new BeatCache(brokenDeps, 8)
    const good = await cache.read({ id: "good", path: "/repos/gtd" })
    const bad = await brokenCache.read({ id: "bad", path: "/repos/other" })
    expect(good.status).toBe("ok")
    expect(bad.status).toBe("broken")
  })
})

describe("BeatCache.read — the memo (T3)", () => {
  it("a second request with all three key parts unchanged spawns zero subprocesses", async () => {
    const deps = makeDeps()
    const cache = new BeatCache(deps, 8)
    const worktree = { id: "abc123", path: "/repos/gtd" }
    await cache.read(worktree)
    deps.run.mockClear()
    await cache.read(worktree)
    expect(deps.run).not.toHaveBeenCalled()
  })

  it("a new commit invalidates that worktree's entry and no other's", async () => {
    let sha = "a".repeat(40)
    const depsA = makeDeps()
    depsA.headSha.mockImplementation(async () => sha)
    const depsB = makeDeps()
    const cacheA = new BeatCache(depsA, 8)
    const cacheB = new BeatCache(depsB, 8)
    const wtA = { id: "a", path: "/repos/a" }
    const wtB = { id: "b", path: "/repos/b" }

    await cacheA.read(wtA)
    await cacheB.read(wtB)
    depsA.run.mockClear()
    depsB.run.mockClear()

    sha = "b".repeat(40)
    await cacheA.read(wtA)
    await cacheB.read(wtB)

    expect(depsA.run).toHaveBeenCalled()
    expect(depsB.run).not.toHaveBeenCalled()
  })

  it("touching the resting state's steering file invalidates the entry", async () => {
    let mtime = 1
    const deps = makeDeps()
    deps.statMtime.mockImplementation(async (path: string) => {
      if (path.endsWith("TODO.md")) return mtime
      if (path.endsWith("gtd-loop.log")) return 1
      return undefined
    })
    const cache = new BeatCache(deps, 8)
    const worktree = { id: "abc123", path: "/repos/gtd" }
    await cache.read(worktree)
    deps.run.mockClear()

    mtime = 2
    await cache.read(worktree)
    expect(deps.run).toHaveBeenCalled()
  })

  it("touching the loop log invalidates the entry", async () => {
    let mtime = 1
    const deps = makeDeps()
    deps.statMtime.mockImplementation(async (path: string) => {
      if (path.endsWith("TODO.md")) return 1
      if (path.endsWith("gtd-loop.log")) return mtime
      return undefined
    })
    const cache = new BeatCache(deps, 8)
    const worktree = { id: "abc123", path: "/repos/gtd" }
    await cache.read(worktree)
    deps.run.mockClear()

    mtime = 2
    await cache.read(worktree)
    expect(deps.run).toHaveBeenCalled()
  })

  it("a warm fleet load of 30 worktrees completes in under 100ms", async () => {
    const deps = makeDeps()
    const cache = new BeatCache(deps, 8)
    const worktrees = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, path: `/repos/w${i}` }))
    await Promise.all(worktrees.map((w) => cache.read(w)))
    deps.run.mockClear()

    const start = performance.now()
    await Promise.all(worktrees.map((w) => cache.read(w)))
    expect(performance.now() - start).toBeLessThan(100)
    expect(deps.run).not.toHaveBeenCalled()
  })

  it("caps cold reads at a fixed concurrency, never exceeding it at once", async () => {
    let active = 0
    let maxActive = 0
    const deps = makeDeps()
    deps.run.mockImplementation(async (_cwd: string, command: string) => {
      if (command !== "gtd next --json") {
        const canned = GIT_META[command]
        return canned !== undefined ? ok(canned) : failed("unscripted")
      }
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return ok(beatJson())
    })
    const cache = new BeatCache(deps, 4)
    const worktrees = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, path: `/repos/w${i}` }))
    await Promise.all(worktrees.map((w) => cache.read(w)))
    expect(maxActive).toBeLessThanOrEqual(4)
  })
})
