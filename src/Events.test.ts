import { execFileSync } from "node:child_process"
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
  gatherEvents,
  getPackages,
  parsePlanPhase,
} from "./Events.js"
import { GitService } from "./Git.js"

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
    const committed = "# Review\n\n<!-- base: abc123 -->\n\n- [ ] item one\n\nNo extra feedback.\n"
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

function git(dir: string, ...args: string[]) {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" })
}

const runGatherEvents = () =>
  Effect.runPromise(
    gatherEvents().pipe(Effect.provide(GitService.Live), Effect.provide(NodeContext.layer)),
  )

describe("gatherEvents — commitIntent and reviewDirty inference", { timeout: 30_000 }, () => {
  let gitRepoDir: string
  let savedCwd: string

  beforeEach(() => {
    savedCwd = process.cwd()
    gitRepoDir = mkdtempSync(join(tmpdir(), "gtd-events-git-"))
    git(gitRepoDir, "init", "-q")
    git(gitRepoDir, "config", "user.name", "Test")
    git(gitRepoDir, "config", "user.email", "test@test.com")
    git(gitRepoDir, "config", "commit.gpgsign", "false")
    writeFileSync(join(gitRepoDir, "README.md"), "# test\n")
    git(gitRepoDir, "add", "-A")
    git(gitRepoDir, "commit", "-q", "-m", "chore: init")
    process.chdir(gitRepoDir)
  })

  afterEach(() => {
    process.chdir(savedCwd)
    rmSync(gitRepoDir, { recursive: true, force: true })
  })

  it("fresh untracked REVIEW.md → commitIntent=human-review, reviewDirty=new, reviewBaseHash parsed", async () => {
    const baseHash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    writeFileSync(
      join(gitRepoDir, "REVIEW.md"),
      `# Review\n\n<!-- base: ${baseHash} -->\n\n- [ ] item\n`,
    )
    const events = await runGatherEvents()
    const resolve = events.find((e) => e.type === "RESOLVE")!
    if (resolve.type !== "RESOLVE") throw new Error("no RESOLVE")
    const p = resolve.payload
    expect(p.commitIntent).toBe("human-review")
    expect(p.reviewDirty).toBe("new")
    expect(p.reviewBaseHash).toBe(baseHash)
  })

  it("human-edited (tracked M) REVIEW.md → no commitIntent, reviewDirty=modified", async () => {
    const baseHash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    writeFileSync(
      join(gitRepoDir, "REVIEW.md"),
      `# Review\n\n<!-- base: ${baseHash} -->\n\n- [ ] item\n`,
    )
    git(gitRepoDir, "add", "REVIEW.md")
    git(gitRepoDir, "commit", "-q", "-m", "review(gtd): create review for abc1234")
    // Human edits REVIEW.md (tracked file, now modified)
    writeFileSync(
      join(gitRepoDir, "REVIEW.md"),
      `# Review\n\n<!-- base: ${baseHash} -->\n\n- [x] item\n\nFeedback here.\n`,
    )
    const events = await runGatherEvents()
    const resolve = events.find((e) => e.type === "RESOLVE")!
    if (resolve.type !== "RESOLVE") throw new Error("no RESOLVE")
    const p = resolve.payload
    expect(p.commitIntent).toBeUndefined()
    expect(p.reviewDirty).toBe("modified")
    expect(p.reviewBaseHash).toBe(baseHash)
  })

  it("TODO.md deleted + packages present → commitIntent=decompose, packageCount=N", async () => {
    writeFileSync(join(gitRepoDir, "TODO.md"), "# plan\n")
    git(gitRepoDir, "add", "TODO.md")
    git(gitRepoDir, "commit", "-q", "-m", "plan(gtd): ready complete")
    // Simulate post-decompose state: TODO.md deleted, packages created
    git(gitRepoDir, "rm", "TODO.md")
    mkdirSync(join(gitRepoDir, ".gtd", "01-foo"), { recursive: true })
    writeFileSync(join(gitRepoDir, ".gtd", "01-foo", "COMMIT_MSG.md"), "feat: foo\n")
    mkdirSync(join(gitRepoDir, ".gtd", "02-bar"), { recursive: true })
    writeFileSync(join(gitRepoDir, ".gtd", "02-bar", "COMMIT_MSG.md"), "feat: bar\n")
    const events = await runGatherEvents()
    const resolve = events.find((e) => e.type === "RESOLVE")!
    if (resolve.type !== "RESOLVE") throw new Error("no RESOLVE")
    const p = resolve.payload
    expect(p.commitIntent).toBe("decompose")
    expect(p.packageCount).toBe(2)
  })

  it("dirty source + lowest package has COMMIT_MSG.md → commitIntent=execute, packageCommitMsg", async () => {
    mkdirSync(join(gitRepoDir, ".gtd", "01-work"), { recursive: true })
    writeFileSync(join(gitRepoDir, ".gtd", "01-work", "COMMIT_MSG.md"), "feat: implement thing\n")
    writeFileSync(join(gitRepoDir, "src.ts"), "export const x = 1\n")
    const events = await runGatherEvents()
    const resolve = events.find((e) => e.type === "RESOLVE")!
    if (resolve.type !== "RESOLVE") throw new Error("no RESOLVE")
    const p = resolve.payload
    expect(p.commitIntent).toBe("execute")
    expect(p.packageCommitMsg).toBe("feat: implement thing\n")
  })

  it("dirty source + NO packages → no commitIntent (fix-tests/generic is machine's job)", async () => {
    writeFileSync(join(gitRepoDir, "src.ts"), "export const x = 1\n")
    const events = await runGatherEvents()
    const resolve = events.find((e) => e.type === "RESOLVE")!
    if (resolve.type !== "RESOLVE") throw new Error("no RESOLVE")
    const p = resolve.payload
    expect(p.commitIntent).toBeUndefined()
  })

  it("<!-- base --> parsed even when reviewBasePresent path would not fire (HEAD is review commit)", async () => {
    const baseHash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    // Commit REVIEW.md so HEAD is the review commit (frontier guard returns none)
    writeFileSync(
      join(gitRepoDir, "REVIEW.md"),
      `# Review\n\n<!-- base: ${baseHash} -->\n\n- [ ] item\n`,
    )
    git(gitRepoDir, "add", "REVIEW.md")
    git(gitRepoDir, "commit", "-q", "-m", "review(gtd): create review for abc1234")
    const events = await runGatherEvents()
    const resolve = events.find((e) => e.type === "RESOLVE")!
    if (resolve.type !== "RESOLVE") throw new Error("no RESOLVE")
    // reviewBaseHash should be set even when reviewBasePresent=false (frontier guard)
    expect(resolve.payload.reviewBaseHash).toBe(baseHash)
  })
})

describe("parsePlanPhase", () => {
  it('grilling subject → "grilling"', () => {
    expect(parsePlanPhase("plan(gtd): grilling")).toBe("grilling")
  })

  it('ready complete subject → "complete"', () => {
    expect(parsePlanPhase("plan(gtd): ready complete")).toBe("complete")
  })

  it("decompose subject → null", () => {
    expect(parsePlanPhase("plan(gtd): decompose TODO.md into 3 work packages")).toBe(null)
  })

  it("unrelated subject → null", () => {
    expect(parsePlanPhase("docs(plan): record TODO.md")).toBe(null)
  })

  it("empty string → null", () => {
    expect(parsePlanPhase("")).toBe(null)
  })
})
