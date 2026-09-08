/**
 * Coverage for `readStep`/`isSupportedVersion`: every dependency
 * (`run`/`readLocalGtdVersion`/`headSha`) is a scripted fake — no real
 * subprocess, no real filesystem.
 */

import { execSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  isSupportedVersion,
  liveHeadSha,
  liveRunInWorktree,
  readLocalGtdVersionAt,
  readStep,
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
    ...over,
  })

interface FakeDeps {
  readonly run: ReturnType<typeof vi.fn<BeatDeps["run"]>>
  readonly headSha: ReturnType<typeof vi.fn<BeatDeps["headSha"]>>
  readonly readLocalGtdVersion: ReturnType<typeof vi.fn<BeatDeps["readLocalGtdVersion"]>>
  readonly runCalls: string[]
}

const makeDeps = (
  overrides: {
    readonly beatOutcome?: SpawnOutcome
    readonly version?: string | undefined
    readonly headSha?: string | undefined
  } = {},
): FakeDeps => {
  const runCalls: string[] = []

  const run = vi.fn(async (_cwd: string, command: string): Promise<SpawnOutcome> => {
    runCalls.push(command)
    if (command === "gtd next --json") return overrides.beatOutcome ?? ok(beatJson())
    const canned = GIT_META[command]
    return canned !== undefined ? ok(canned) : failed(`unscripted command: ${command}`)
  })

  const headSha = vi.fn(async () => overrides.headSha ?? "a".repeat(40))
  const readLocalGtdVersion = vi.fn(async () => overrides.version)

  return {
    run,
    headSha,
    readLocalGtdVersion,
    get runCalls() {
      return runCalls
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

describe("readStep — ok rows", () => {
  it("never carries content or system fields, only the projected fields plus file", async () => {
    const deps = makeDeps()
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("ok")
    expect(Object.keys(result).sort()).toEqual(
      ["actor", "branch", "file", "idle", "kind", "label", "path", "repo", "rest", "status"].sort(),
    )
  })

  it("carries the beat-reported file and mode verbatim, for the phone to open the right steering screen", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ file: ".gtd/PLAN.md", mode: "qa" })) })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.file).toBe(".gtd/PLAN.md")
      expect(result.mode).toBe("qa")
    }
  })

  it("omits file/mode entirely when the beat reports neither", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ file: undefined })) })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.file).toBeUndefined()
      expect(result.mode).toBeUndefined()
    }
  })

  it("sets rest to HEAD's committer date", async () => {
    const deps = makeDeps()
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("ok")
    if (result.status === "ok") expect(result.rest).toBe("2026-08-01T10:00:00+00:00")
  })

  it("falls back to the state name when the beat has no label", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ label: undefined, state: "reviewing" })) })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("ok")
    if (result.status === "ok") expect(result.label).toBe("reviewing")
  })
})

describe("readStep — the error taxonomy", () => {
  it("a worktree with no gtd config renders as a normal message row, not Broken", async () => {
    const deps = makeDeps({
      beatOutcome: {
        status: 0,
        stdout: beatJson({ kind: "message" }),
        stderr: "workflow warning: no vars declared\n",
      },
    })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("ok")
    if (result.status === "ok") expect(result.kind).toBe("message")
  })

  it("a non-zero exit puts the row in Broken with stderr shown verbatim", async () => {
    const deps = makeDeps({ beatOutcome: failed("gtd: refused, dirty tree\n") })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("broken")
    if (result.status === "broken") expect(result.detail).toBe("gtd: refused, dirty tree\n")
  })

  it("a spawn failure puts the row in Broken", async () => {
    const deps = makeDeps({ beatOutcome: spawnFailed("spawn bash ENOENT") })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("broken")
    if (result.status === "broken") expect(result.detail).toBe("spawn bash ENOENT")
  })

  it("output that is not valid JSON puts the row in Broken", async () => {
    const deps = makeDeps({ beatOutcome: ok("not json at all") })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("broken")
  })

  it("valid JSON with no recognizable kind puts the row in Broken, not a blank ok row", async () => {
    const deps = makeDeps({ beatOutcome: ok(JSON.stringify({ hello: "world" })) })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("broken")
  })

  it("valid JSON with an unrecognized kind puts the row in Broken", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ kind: "not-a-real-kind" })) })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("broken")
  })

  it("valid JSON with a missing or empty actor puts the row in Broken", async () => {
    const deps = makeDeps({ beatOutcome: ok(beatJson({ actor: "" })) })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("broken")
  })

  it("a version outside the supported range puts the row in Broken and names the version found", async () => {
    const deps = makeDeps({ version: "999.0.0" })
    const result = await readStep({ path: "/repos/gtd" }, deps)
    expect(result.status).toBe("broken")
    if (result.status === "broken") expect(result.detail).toContain("999.0.0")
    expect(deps.runCalls).not.toContain("gtd next --json")
  })
})

describe("readStep [real git] — the spawned read never mutates the worktree", () => {
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
    // is irrelevant to what's being proven: NONE of the commands `readStep`
    // issues — the `gtd` attempt, both `git rev-parse` reads, and `git log`
    // — may commit, write, or move a ref, success or failure alike.
    const deps: BeatDeps = {
      run: liveRunInWorktree,
      readLocalGtdVersion: readLocalGtdVersionAt,
      headSha: liveHeadSha,
    }
    await readStep({ path: root }, deps)

    const after = {
      head: gitExecIn(root, "rev-parse", "HEAD"),
      refs: gitExecIn(root, "show-ref"),
      status: gitExecIn(root, "status", "--porcelain"),
    }

    expect(after).toEqual(before)
  })
})

describe("importing this module with no @pmelab/gtd package.json above it", () => {
  afterEach(() => {
    vi.doUnmock("node:fs")
    vi.resetModules()
  })

  it("loads instead of throwing, even when the package.json walk would find nothing anywhere", async () => {
    // A real "no package.json above it" directory can't be simulated by
    // where THIS test file lives (it's always inside this checkout) — so the
    // walk itself is made to fail instead: `existsSync` reports false at
    // every level, exactly what a truly detached directory tree would see.
    // `vi.resetModules()` forces Beat.js's module-scope code to run fresh
    // under that mock, rather than reusing an already-imported (and already
    // fs-untouched) instance from an earlier test in this file.
    vi.resetModules()
    vi.doMock("node:fs", () => ({
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("readFileSync should never run — existsSync already reported false")
      },
    }))

    await expect(import("./Beat.js")).resolves.toBeDefined()
  })

  it("the mocked walk actually fails when the lazy version check IS exercised — proving the import above passed because the walk never ran, not because the mock is a no-op", async () => {
    vi.resetModules()
    vi.doMock("node:fs", () => ({
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("readFileSync should never run — existsSync already reported false")
      },
    }))

    const fresh = await import("./Beat.js")
    expect(() => fresh.isSupportedVersion("10.5.0")).toThrow(
      "no @pmelab/gtd package.json found above src/ui/Beat.ts",
    )
  })
})
