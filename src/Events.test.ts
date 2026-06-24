import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  computeReviewHasRealFeedback,
  computeReviewHasUncheckedBoxes,
  getPackages,
  readCommitIntent,
} from "./Events.js"

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

describe("COMMIT event isTestFix flag — Gtd-Test-Fix trailer detection", () => {
  const isTestFix = (message: string) => /^Gtd-Test-Fix:/m.test(message)

  it("trailer on its own body line → true", () => {
    const msg = "feat: add thing\n\nSome body text.\n\nGtd-Test-Fix: 1\n"
    expect(isTestFix(msg)).toBe(true)
  })

  it("bare fix(gtd): subject with no trailer → false", () => {
    const msg = "fix(gtd): repair broken test\n"
    expect(isTestFix(msg)).toBe(false)
  })

  it("trailer embedded mid-line (not at line start) → false", () => {
    const msg = "feat: thing\n\nSee Gtd-Test-Fix: info here\n"
    expect(isTestFix(msg)).toBe(false)
  })
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

describe("readCommitIntent — commit-intent sentinel (READ-ONLY)", () => {
  it("execute marker → 'execute'", async () => {
    writeFileSync(join(repoDir, ".gtd-commit-intent"), "execute\n")
    const intent = await withFs((fs) => readCommitIntent(fs))
    expect(intent).toBe("execute")
  })

  it("decompose marker → 'decompose'", async () => {
    writeFileSync(join(repoDir, ".gtd-commit-intent"), "decompose")
    const intent = await withFs((fs) => readCommitIntent(fs))
    expect(intent).toBe("decompose")
  })

  it("no marker → undefined (Part A code-changes path)", async () => {
    const intent = await withFs((fs) => readCommitIntent(fs))
    expect(intent).toBeUndefined()
  })

  it("unrecognized marker content → undefined", async () => {
    writeFileSync(join(repoDir, ".gtd-commit-intent"), "bogus-intent\n")
    const intent = await withFs((fs) => readCommitIntent(fs))
    expect(intent).toBeUndefined()
  })

  it("all seven intent kinds round-trip", async () => {
    for (const kind of [
      "execute",
      "decompose",
      "new-todo",
      "modified-todo",
      "execute-simple",
      "human-review",
      "fix-tests",
    ]) {
      writeFileSync(join(repoDir, ".gtd-commit-intent"), kind)
      const intent = await withFs((fs) => readCommitIntent(fs))
      expect(intent).toBe(kind)
    }
  })
})

const runEffect = <A>(eff: Effect.Effect<A, Error>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeContext.layer)))

describe("computeReviewHasUncheckedBoxes", () => {
  it("returns true when there is at least one unchecked box", () => {
    const content = "# Review\n\n- [ ] something to check\n- [x] already done\n"
    expect(computeReviewHasUncheckedBoxes(content)).toBe(true)
  })

  it("returns false when all boxes are checked", () => {
    const content = "# Review\n\n- [x] done\n- [x] also done\n"
    expect(computeReviewHasUncheckedBoxes(content)).toBe(false)
  })

  it("returns false when there are no checkboxes at all", () => {
    const content = "# Review\n\nSome prose feedback without any checkboxes.\n"
    expect(computeReviewHasUncheckedBoxes(content)).toBe(false)
  })
})

describe("computeReviewHasRealFeedback", () => {
  it("forward-ticks only (committed unchecked → working checked, otherwise identical) → false", async () => {
    const committed = "# Review\n\n<!-- base: abc123 -->\n\n- [ ] item one\n- [ ] item two\n"
    const working = "# Review\n\n<!-- base: abc123 -->\n\n- [x] item one\n- [x] item two\n"
    const result = await runEffect(
      computeReviewHasRealFeedback({
        otherDirtyPathsExist: false,
        committedContent: committed,
        workingContent: working,
      }),
    )
    expect(result).toBe(false)
  })

  it("prose edit in REVIEW.md → true", async () => {
    const committed =
      "# Review\n\n<!-- base: abc123 -->\n\n- [ ] item one\n\nNo extra feedback.\n"
    const working =
      "# Review\n\n<!-- base: abc123 -->\n\n- [x] item one\n\nActually here is real feedback that changes things significantly.\n"
    const result = await runEffect(
      computeReviewHasRealFeedback({
        otherDirtyPathsExist: false,
        committedContent: committed,
        workingContent: working,
      }),
    )
    expect(result).toBe(true)
  })

  it("otherDirtyPathsExist=true → true (short-circuit)", async () => {
    const result = await runEffect(
      computeReviewHasRealFeedback({
        otherDirtyPathsExist: true,
        committedContent: "anything",
        workingContent: "anything",
      }),
    )
    expect(result).toBe(true)
  })
})
