import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getPackages } from "./Events.js"

const run = <A>(eff: Effect.Effect<A, Error, FileSystem.FileSystem>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeContext.layer)))

const withFs = <A>(f: (fs: FileSystem.FileSystem) => Effect.Effect<A, Error>) =>
  run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return yield* f(fs)
    }),
  )

let repoDir: string
let originalCwd: string

beforeEach(() => {
  originalCwd = process.cwd()
  repoDir = mkdtempSync(join(tmpdir(), "gtd-events-test-"))
  process.chdir(repoDir)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(repoDir, { recursive: true, force: true })
})

describe("getPackages — inlined task contents + commit-msg flag", () => {
  it("reads raw task content sorted to match tasks and sets hasCommitMsg", async () => {
    const pkgDir = join(repoDir, ".gtd", "01-foo")
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, "02-second.md"), "# Second\nbody two\n")
    writeFileSync(join(pkgDir, "01-task.md"), "# Task\nbody one\n")
    writeFileSync(join(pkgDir, "COMMIT_MSG.md"), "feat: thing\n")

    const packages = await withFs((fs) => getPackages(fs))

    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.name).toBe("01-foo")
    expect(pkg.tasks).toEqual(["01-task.md", "02-second.md"])
    expect(pkg.taskContents).toEqual([
      { name: "01-task.md", content: "# Task\nbody one\n" },
      { name: "02-second.md", content: "# Second\nbody two\n" },
    ])
    expect(pkg.hasCommitMsg).toBe(true)
  })

  it("package with no task files → empty arrays, no error, flag reflects COMMIT_MSG.md", async () => {
    const pkgDir = join(repoDir, ".gtd", "02-empty")
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, "COMMIT_MSG.md"), "chore: empty\n")

    const packages = await withFs((fs) => getPackages(fs))

    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.tasks).toEqual([])
    expect(pkg.taskContents).toEqual([])
    expect(pkg.hasCommitMsg).toBe(true)
  })

  it("no .gtd dir → empty package list", async () => {
    const packages = await withFs((fs) => getPackages(fs))
    expect(packages).toEqual([])
  })
})
