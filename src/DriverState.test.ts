import { chmodSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { DriverState } from "./DriverState.js"
import { Cwd } from "./Cwd.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-driver-state-test-"))
  execFileSync("git", ["init", "-q"], { cwd: tmpDir })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const gitAbsoluteGitDir = (cwd: string): string =>
  execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd, encoding: "utf8" }).trim()

const runAt = <A>(root: string, eff: Effect.Effect<A, Error, DriverState>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(DriverState.Live), Effect.provide(Cwd.layer(root))))

describe("DriverState.Live: git-dir resolution", () => {
  it("resolves to <root>/.git for a plain repo", async () => {
    const path = await runAt(
      tmpDir,
      Effect.gen(function* () {
        const state = yield* DriverState
        return yield* state.path("gtd-loop-memory")
      }),
    )
    expect(realpathSync(dirname(path))).toBe(realpathSync(gitAbsoluteGitDir(tmpDir)))
  })

  it("resolves to the linked worktree's own private git dir", async () => {
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "initial"], { cwd: tmpDir })
    const worktreeDir = `${tmpDir}-linked`
    execFileSync("git", ["worktree", "add", "-q", worktreeDir], { cwd: tmpDir })
    try {
      const path = await runAt(
        worktreeDir,
        Effect.gen(function* () {
          const state = yield* DriverState
          return yield* state.path("gtd-loop-memory")
        }),
      )
      expect(realpathSync(dirname(path))).toBe(realpathSync(gitAbsoluteGitDir(worktreeDir)))
      expect(realpathSync(dirname(path))).not.toBe(realpathSync(gitAbsoluteGitDir(tmpDir)))
    } finally {
      rmSync(worktreeDir, { recursive: true, force: true })
    }
  })
})

describe("DriverState.Live: read/write", () => {
  it("reads an absent file as undefined", async () => {
    const content = await runAt(
      tmpDir,
      Effect.gen(function* () {
        const state = yield* DriverState
        return yield* state.read("gtd-loop-memory")
      }),
    )
    expect(content).toBeUndefined()
  })

  it("round-trips a write through a read", async () => {
    const content = await runAt(
      tmpDir,
      Effect.gen(function* () {
        const state = yield* DriverState
        yield* state.write("gtd-loop-memory", "scope#abc1234 session-1 fresh\n")
        return yield* state.read("gtd-loop-memory")
      }),
    )
    expect(content).toBe("scope#abc1234 session-1 fresh\n")
  })

  it("leaves no *.tmp leftovers behind after a write", async () => {
    await runAt(
      tmpDir,
      Effect.gen(function* () {
        const state = yield* DriverState
        yield* state.write("gtd-loop-memory", "row\n")
      }),
    )
    const gitDir = gitAbsoluteGitDir(tmpDir)
    const leftovers = readdirSync(gitDir).filter((name) => name.includes(".tmp"))
    expect(leftovers).toEqual([])
  })

  it("swallows a write failure into a read-only git dir", async () => {
    const gitDir = gitAbsoluteGitDir(tmpDir)
    chmodSync(gitDir, 0o500)
    try {
      await expect(
        runAt(
          tmpDir,
          Effect.gen(function* () {
            const state = yield* DriverState
            yield* state.write("gtd-loop-memory", "row\n")
          }),
        ),
      ).resolves.toBeUndefined()
    } finally {
      chmodSync(gitDir, 0o700)
    }
  })
})
