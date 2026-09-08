/**
 * Coverage for `BeatCache`/`isSupportedVersion`: every dependency
 * (`run`/`readLocalGtdVersion`/`headSha`/`statMtime`) is a scripted fake — no
 * real subprocess, no real filesystem — so call counts can be asserted
 * exactly (T3's "spawns zero subprocesses" claims).
 */

import { execSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BeatCache,
  isSupportedVersion,
  liveHeadSha,
  liveRunInWorktree,
  liveStatMtime,
  readLocalGtdVersionAt,
  type BeatDeps,
  type SpawnOutcome,
} from "./Beat.js"

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
  readonly readLocalGtdVersion: ReturnType<typeof vi.fn<BeatDeps["readLocalGtdVersion"]>>
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

  const readLocalGtdVersion = vi.fn(async () => overrides.version)

  return {
    run,
    headSha,
    statMtime,
    readLocalGtdVersion,
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

/**
 * A single `BeatDeps` bag whose `run`/`headSha`/`statMtime` branch on the
 * `cwd`/`path` argument — for proving cross-entry isolation INSIDE one
 * `BeatCache` (two separate caches over two separate fake dep sets, as the
 * earlier version of these tests did, can't invalidate each other by
 * construction, so they never exercise the shared `entries` map at all).
 */
const makeSharedDeps = (perPath: {
  readonly [path: string]: {
    readonly beatOutcome?: SpawnOutcome
    readonly headSha?: string | undefined
  }
}): BeatDeps => {
  const run = vi.fn(async (cwd: string, command: string): Promise<SpawnOutcome> => {
    if (command === "gtd next --json") return perPath[cwd]?.beatOutcome ?? ok(beatJson())
    const canned = GIT_META[command]
    return canned !== undefined ? ok(canned) : failed(`unscripted command: ${command}`)
  })
  const headSha = vi.fn(async (path: string) => perPath[path]?.headSha ?? "a".repeat(40))
  const statMtime = vi.fn(async (path: string) => {
    if (path.endsWith("TODO.md")) return 1
    if (path.endsWith("gtd-loop.log")) return 1
    return undefined
  })
  const readLocalGtdVersion = vi.fn(async () => undefined)
  return { run, headSha, statMtime, readLocalGtdVersion }
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
  it("never carries content or system fields, only the projected five plus identity plus logMtime/file", async () => {
    const deps = makeDeps()
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("ok")
    // `logMtime`/`file`/`mode` (package 05) are the additions beyond the
    // original projected five plus identity — `mode` is absent here since
    // `beatJson`'s default fixture doesn't set one; a fixture that does is
    // covered by the dedicated `mode`/`file` test below.
    expect(Object.keys(result).sort()).toEqual(
      [
        "actor",
        "branch",
        "file",
        "id",
        "idle",
        "kind",
        "label",
        "logMtime",
        "path",
        "repo",
        "rest",
        "status",
      ].sort(),
    )
  })

  it("carries the beat-reported file and mode verbatim, for the phone to open the right steering screen", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ file: ".gtd/PLAN.md", mode: "qa" })) })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.file).toBe(".gtd/PLAN.md")
      expect(result.mode).toBe("qa")
    }
  })

  it("omits file/mode entirely when the beat reports neither", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ file: undefined, log: undefined })) })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.file).toBeUndefined()
      expect(result.mode).toBeUndefined()
    }
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

  it("valid JSON with no recognizable kind puts the row in Broken, not a blank ok row", async () => {
    // A $PATH `gtd` the version check couldn't see (a linked/workspace
    // install) can still parse cleanly to some unrelated envelope — an
    // unchecked cast would render a blank-labeled row with an `undefined`
    // kind/actor instead of landing in Broken.
    const deps = makeDeps({ beatOutcome: ok(JSON.stringify({ hello: "world" })) })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("broken")
  })

  it("valid JSON with an unrecognized kind puts the row in Broken", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ kind: "not-a-real-kind" })) })
    const cache = new BeatCache(deps, 8)
    const result = await cache.read({ id: "abc123", path: "/repos/gtd" })
    expect(result.status).toBe("broken")
  })

  it("valid JSON with a missing or empty actor puts the row in Broken", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ actor: "" })) })
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
    // ONE cache, one shared deps bag keyed by path — two separate caches (the
    // earlier shape of this test) can't demonstrate cross-entry isolation:
    // they don't share anything to isolate in the first place.
    const goodPath = "/repos/good"
    const badPath = "/repos/bad"
    const deps = makeSharedDeps({ [badPath]: { beatOutcome: failed("boom") } })
    const cache = new BeatCache(deps, 8)
    const good = await cache.read({ id: "good", path: goodPath })
    const bad = await cache.read({ id: "bad", path: badPath })
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

  it("a Broken outcome is never memoized — the next request re-attempts even with headSha unchanged", async () => {
    // The failure this guards: a worktree refuses with a dirty tree, the
    // user fixes it (`git checkout .`), but HEAD never moved — a memoized
    // Broken result (its key only ever pins `headSha`, since nothing parsed
    // to key `file`/`log` on) would then read as unchanged FOREVER, serving
    // the stale refusal for the rest of the process's life.
    const deps = makeDeps({ beatOutcome: failed("gtd: refused, dirty tree\n") })
    const cache = new BeatCache(deps, 8)
    const worktree = { id: "abc123", path: "/repos/gtd" }

    const first = await cache.read(worktree)
    deps.run.mockClear()
    const second = await cache.read(worktree)

    expect(first.status).toBe("broken")
    expect(second.status).toBe("broken")
    expect(deps.run).toHaveBeenCalled()
  })

  it("an unreadable HEAD (headSha undefined) never counts as a stable cache hit", async () => {
    // `liveHeadSha` returns `undefined` on any read failure specifically so
    // this axis reads as "always changed" — `undefined === undefined` must
    // never be treated as "unchanged", or a worktree whose `.git` this
    // process can't parse could never invalidate by any means.
    const deps = makeDeps()
    deps.headSha.mockResolvedValue(undefined)
    const cache = new BeatCache(deps, 8)
    const worktree = { id: "abc123", path: "/repos/gtd" }

    await cache.read(worktree)
    deps.run.mockClear()
    await cache.read(worktree)

    expect(deps.run).toHaveBeenCalled()
  })

  it("a new commit invalidates that worktree's entry and no other's", async () => {
    // ONE cache over both worktrees — two separate caches (the earlier shape
    // of this test) cannot invalidate each other by construction, so the
    // claim in the test's own name was never actually exercised.
    let shaA = "a".repeat(40)
    const wtA = { id: "a", path: "/repos/a" }
    const wtB = { id: "b", path: "/repos/b" }
    const perPath = {
      [wtA.path]: {
        get headSha() {
          return shaA
        },
      },
      [wtB.path]: { headSha: "b".repeat(40) },
    }
    const deps = makeSharedDeps(perPath)
    const cache = new BeatCache(deps, 8)

    await cache.read(wtA)
    await cache.read(wtB)
    vi.mocked(deps.run).mockClear()

    shaA = "c".repeat(40)
    await cache.read(wtA)
    await cache.read(wtB)

    const runPaths = vi.mocked(deps.run).mock.calls.map(([cwd]) => cwd)
    expect(runPaths).toContain(wtA.path)
    expect(runPaths).not.toContain(wtB.path)
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

  it("resolves a RELATIVE log path (an ordinary clone's .git/gtd-loop.log) against the worktree, not the server's own cwd", async () => {
    // `beatJson()`'s default `log` is already absolute, which masks this:
    // an ordinary clone (no `gitdir:` pointer) reports the relative
    // `.git/gtd-loop.log`, and joining it against the wrong base means
    // touching that worktree's real log never invalidates its entry.
    const worktree = { id: "abc123", path: "/repos/plain-clone" }
    const deps = makeDeps({
      beatOutcome: ok(beatJson({ log: ".git/gtd-loop.log" })),
    })
    let mtime = 1
    deps.statMtime.mockImplementation(async (path: string) => {
      if (path.endsWith("TODO.md")) return 1
      if (path.endsWith("gtd-loop.log")) return mtime
      return undefined
    })

    const cache = new BeatCache(deps, 8)
    await cache.read(worktree)
    const statPaths = deps.statMtime.mock.calls.map(([path]) => path)
    expect(statPaths).toContain(join(worktree.path, ".git/gtd-loop.log"))
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
    // Every `run` call counts here, not only `gtd next --json` — T3's own
    // wording is "never more than that many CHILD PROCESSES alive at once",
    // and `coldRead` spawns three `git` reads per cold read in addition to
    // the beat itself. A version of this test that only tracked the beat
    // command would pass even if those three ran concurrently per slot
    // (up to 3x the configured cap in real child processes).
    deps.run.mockImplementation(async (_cwd: string, command: string) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      if (command !== "gtd next --json") {
        const canned = GIT_META[command]
        return canned !== undefined ? ok(canned) : failed("unscripted")
      }
      return ok(beatJson())
    })
    const cache = new BeatCache(deps, 4)
    const worktrees = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, path: `/repos/w${i}` }))
    await Promise.all(worktrees.map((w) => cache.read(w)))
    expect(maxActive).toBeLessThanOrEqual(4)
  })

  it("never exceeds the cap even when a second overlapping request arrives mid-load (a phone refresh during a cold load)", async () => {
    // A coarse, realistic version of the race below: two batches of reads
    // staggered across real macrotasks so they genuinely interleave, rather
    // than one synchronous `Promise.all` burst (the test above), where every
    // call is already queued before any of them finish and the race below
    // can never trigger.
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
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 4))
      active--
      return ok(beatJson())
    })
    const cache = new BeatCache(deps, 4)

    const batchOf = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}${i}`,
        path: `/repos/${prefix}${i}`,
      }))

    const firstBatch = Promise.all(batchOf("first-", 20).map((w) => cache.read(w)))
    await new Promise((resolve) => setTimeout(resolve, 3))
    const secondBatch = Promise.all(batchOf("second-", 20).map((w) => cache.read(w)))

    await Promise.all([firstBatch, secondBatch])
    expect(maxActive).toBeLessThanOrEqual(4)
  })

  it("never exceeds the cap at the exact instant a slot is handed off to a queued waiter", async () => {
    // Deterministic reproduction of the handoff race itself: the old
    // `withSlot` did `this.active--` and resumed the next queued waiter in
    // two SEPARATE steps — the waiter's own `this.active++` only ran after
    // its `await` settled, a microtask later. So for one microtask tick,
    // `activeSlots` genuinely reads 0 while B is on its way back up — a
    // fresh `cache.read()` landing in exactly that tick sees a free slot,
    // takes it, and B's own `active++` then pushes the count one past the
    // cap. Rather than guess how many microtask hops away that tick is
    // (it depends on `coldRead`'s exact shape), this WATCHES `activeSlots`
    // tick by tick and fires the new read the instant it sees the dip —
    // reactive, so it lands on the real gap regardless of hop count.
    const makeDeferred = (): { promise: Promise<void>; resolve: () => void } => {
      let resolve!: () => void
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      return { promise, resolve }
    }

    const held = makeDeferred()
    const A = { id: "a", path: "/repos/a" }
    const B = { id: "b", path: "/repos/b" }
    const D = { id: "d", path: "/repos/d" }

    const deps = makeDeps()
    deps.run.mockImplementation(async (cwd: string, command: string) => {
      if (command !== "gtd next --json") {
        const canned = GIT_META[command]
        return canned !== undefined ? ok(canned) : failed("unscripted")
      }
      if (cwd === A.path) await held.promise
      return ok(beatJson())
    })
    const cache = new BeatCache(deps, 1)
    let maxActiveSlots = cache.activeSlots

    const pA = cache.read(A) // takes the one slot
    const pB = cache.read(B) // queues behind A
    maxActiveSlots = Math.max(maxActiveSlots, cache.activeSlots)

    // Let A's coldRead actually reach `deps.run` and block on `held`.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
      maxActiveSlots = Math.max(maxActiveSlots, cache.activeSlots)
    }
    expect(cache.activeSlots).toBe(1) // sanity: A is genuinely the one holding the slot

    held.resolve() // start A's handoff to B

    let pD: Promise<unknown> | undefined
    let sawTheGap = false
    // Keep sampling for a good while AFTER firing `pD` too: taking the freed
    // slot (`this.active++`) happens synchronously the instant we call
    // `cache.read(D)`, but B's OWN resumption — already scheduled by A's
    // `finally` before we ever got here — runs as a LATER microtask. The
    // overshoot (both D's grab AND B's resumption incrementing the count)
    // only becomes observable a few ticks after D fires, not at the moment
    // it fires — so this must not stop sampling right when the gap is seen.
    for (let i = 0; i < 50; i++) {
      await Promise.resolve()
      if (pD === undefined && cache.activeSlots === 0) {
        sawTheGap = true
        pD = cache.read(D) // fire the instant a slot looks free
      }
      maxActiveSlots = Math.max(maxActiveSlots, cache.activeSlots)
    }
    expect(sawTheGap).toBe(true) // sanity: the handoff gap was actually observed, not skipped past
    expect(pD).toBeDefined()

    await Promise.all([pA, pB, pD])
    maxActiveSlots = Math.max(maxActiveSlots, cache.activeSlots)
    expect(maxActiveSlots).toBeLessThanOrEqual(1)
  })
})

describe("BeatCache.read [real git] — the spawned read never mutates the worktree (T2)", () => {
  const dirs: string[] = []

  const gitExecIn = (dir: string, ...args: string[]): string =>
    execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim()

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it("leaves HEAD, the ref set, and the working tree byte-identical across one live read", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-beat-mutation-")))
    dirs.push(root)
    gitExecIn(root, "init", "-q")
    gitExecIn(root, "config", "user.email", "test@test.com")
    gitExecIn(root, "config", "user.name", "Test")
    writeFileSync(join(root, "README.md"), "hello\n")
    gitExecIn(root, "add", "README.md")
    gitExecIn(root, "commit", "-q", "-m", "init")
    // An untracked file too — `git status --porcelain` must stay identical
    // even though nothing about it is committed, proving the read never
    // even touches the index, let alone the tree.
    writeFileSync(join(root, "untracked.txt"), "scratch\n")

    const before = {
      head: gitExecIn(root, "rev-parse", "HEAD"),
      refs: gitExecIn(root, "show-ref"),
      status: gitExecIn(root, "status", "--porcelain"),
    }

    // The REAL deps every field of — `gtd next --json` included — spawns a
    // genuine subprocess with `root` as cwd; whether that particular command
    // resolves (`gtd` need not even be on `$PATH` for this repo's checkout)
    // is irrelevant to what's being proven: NONE of the commands `coldRead`
    // issues — the `gtd` attempt, both `git rev-parse` reads, and `git log`
    // — may commit, write, or move a ref, success or failure alike.
    const deps: BeatDeps = {
      run: liveRunInWorktree,
      readLocalGtdVersion: readLocalGtdVersionAt,
      headSha: liveHeadSha,
      statMtime: liveStatMtime,
    }
    const cache = new BeatCache(deps, 1)
    await cache.read({ id: "real", path: root })

    const after = {
      head: gitExecIn(root, "rev-parse", "HEAD"),
      refs: gitExecIn(root, "show-ref"),
      status: gitExecIn(root, "status", "--porcelain"),
    }

    expect(after).toEqual(before)
  })
})
