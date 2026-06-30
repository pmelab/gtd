import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { gatherEvents, getPackages, isCheckboxOnlyDiff, perform, seedTodo } from "./Events.js"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import type { ConfigOperations } from "./Config.js"
import { TestRunner } from "./TestRunner.js"
import type { CommitEvent, EdgeAction, GtdEvent, ResolvePayload } from "./Machine.js"

// ── Repo harness ─────────────────────────────────────────────────────────────
// Each test runs against a fresh real git repo, cwd'd in so gatherEvents/perform
// resolve their relative paths (".gtd", "TODO.md", …) against it.

let repoDir: string
let savedCwd: string

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim()

const commitFile = (msg: string, file: string, content: string): void => {
  writeFileSync(join(repoDir, file), content)
  git("add", "-A")
  git("commit", "-q", "-m", msg)
}

/** Init a repo with a `chore: init` baseline on `main`; optionally branch to `feature`. */
const initRepo = (branch: boolean): void => {
  repoDir = mkdtempSync(join(tmpdir(), "gtd-events-"))
  git("init", "-q")
  git("config", "user.name", "Test")
  git("config", "user.email", "test@test.com")
  git("config", "commit.gpgsign", "false")
  writeFileSync(join(repoDir, "README.md"), "# test\n")
  git("add", "-A")
  git("commit", "-q", "-m", "chore: init")
  git("branch", "-M", "main")
  if (branch) git("checkout", "-q", "-b", "feature")
  savedCwd = process.cwd()
  process.chdir(repoDir)
}

const cleanup = (): void => {
  process.chdir(savedCwd)
  rmSync(repoDir, { recursive: true, force: true })
}

// ── Effect runners ───────────────────────────────────────────────────────────

const fakeConfig = (o: Partial<ConfigOperations> = {}): ConfigOperations => ({
  testCommand: "echo test",
  resolveModel: () => "claude-opus-4-8",
  agenticReview: true,
  fixAttemptCap: 3,
  reviewThreshold: 3,
  ...o,
})

const runGather = (cfg: Partial<ConfigOperations> = {}): Promise<ReadonlyArray<GtdEvent>> =>
  Effect.runPromise(
    gatherEvents().pipe(
      Effect.provide(GitService.Live),
      Effect.provide(NodeContext.layer),
      Effect.provide(Layer.succeed(ConfigService, fakeConfig(cfg))),
    ),
  )

const runGetPackages = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return yield* getPackages(fs)
    }).pipe(Effect.provide(NodeContext.layer)),
  )

const runPerform = (
  action: EdgeAction,
  testResult: { exitCode: number; output: string } = { exitCode: 0, output: "" },
): Promise<void> =>
  Effect.runPromise(
    perform(action).pipe(
      Effect.provide(GitService.Live),
      Effect.provide(NodeContext.layer),
      Effect.provide(Layer.succeed(TestRunner, { run: () => Effect.succeed(testResult) })),
    ),
  )

const resolveOf = (events: ReadonlyArray<GtdEvent>): ResolvePayload => {
  const last = events[events.length - 1]
  if (last === undefined || last.type !== "RESOLVE")
    throw new Error("expected a trailing RESOLVE event")
  return last.payload
}

const commitsOf = (events: ReadonlyArray<GtdEvent>): ReadonlyArray<CommitEvent> =>
  events.filter((e): e is CommitEvent => e.type === "COMMIT")

// ── seedTodo (pure) ──────────────────────────────────────────────────────────

describe("seedTodo", () => {
  it("fences the captured diff under a heading and carries no bare marker", () => {
    const out = seedTodo("- old line\n+ new line\n")
    expect(out).toContain("## Captured input")
    expect(out).toContain("```diff")
    expect(out).toContain("- old line")
    expect(out).toContain("+ new line")
    expect(out).not.toContain("<!-- user answers here -->")
  })
})

// ── isCheckboxOnlyDiff (pure) ────────────────────────────────────────────────

describe("isCheckboxOnlyDiff", () => {
  it("pure tick diff (- [ ] → - [x]) → true", () => {
    const diff = [
      "--- a/REVIEW.md",
      "+++ b/REVIEW.md",
      "@@ -1,3 +1,3 @@",
      " # Review",
      " ",
      "-  - [ ] item one",
      "+  - [x] item one",
    ].join("\n")
    expect(isCheckboxOnlyDiff(diff)).toBe(true)
  })

  it("un-tick diff (- [x] → - [ ]) → true", () => {
    const diff = [
      "--- a/REVIEW.md",
      "+++ b/REVIEW.md",
      "@@ -1,3 +1,3 @@",
      " # Review",
      " ",
      "-  - [x] item one",
      "+  - [ ] item one",
    ].join("\n")
    expect(isCheckboxOnlyDiff(diff)).toBe(true)
  })

  it("diff that also changes text → false", () => {
    const diff = [
      "--- a/REVIEW.md",
      "+++ b/REVIEW.md",
      "@@ -1,4 +1,5 @@",
      " # Review",
      " ",
      "-  - [ ] item one",
      "+  - [x] item one",
      "+  <!-- this is a comment -->",
    ].join("\n")
    expect(isCheckboxOnlyDiff(diff)).toBe(false)
  })

  it("diff adding a new non-checkbox line → false", () => {
    const diff = [
      "--- a/REVIEW.md",
      "+++ b/REVIEW.md",
      "@@ -1,3 +1,4 @@",
      " # Review",
      " ",
      " - [ ] item one",
      "+  new annotation here",
    ].join("\n")
    expect(isCheckboxOnlyDiff(diff)).toBe(false)
  })

  it("empty diff → false", () => {
    expect(isCheckboxOnlyDiff("")).toBe(false)
  })
})

// ── getPackages ──────────────────────────────────────────────────────────────

describe("getPackages — new {name,tasks,taskContents} shape (no COMMIT_MSG handling)", () => {
  beforeEach(() => initRepo(false))
  afterEach(cleanup)

  it("reads task contents sorted to match tasks; no hasCommitMsg field", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeFileSync(join(repoDir, ".gtd", "01-foo", "02-second.md"), "# Second\nbody two\n")
    writeFileSync(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\nbody one\n")

    const packages = await runGetPackages()

    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.name).toBe("01-foo")
    expect(pkg.tasks).toEqual(["01-task.md", "02-second.md"])
    expect(pkg.taskContents).toEqual([
      { name: "01-task.md", content: "# Task\nbody one\n" },
      { name: "02-second.md", content: "# Second\nbody two\n" },
    ])
    expect("hasCommitMsg" in pkg).toBe(false)
  })

  it("treats COMMIT_MSG.md as an ordinary task file (exclusion dropped)", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeFileSync(join(repoDir, ".gtd", "01-foo", "COMMIT_MSG.md"), "feat: x\n")
    writeFileSync(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\n")

    const packages = await runGetPackages()
    expect(packages[0]!.tasks).toEqual(["01-task.md", "COMMIT_MSG.md"])
  })

  it("no .gtd dir → empty list", async () => {
    expect(await runGetPackages()).toEqual([])
  })

  it("package with no task files → empty arrays", async () => {
    mkdirSync(join(repoDir, ".gtd", "02-empty"), { recursive: true })
    const packages = await runGetPackages()
    expect(packages).toHaveLength(1)
    expect(packages[0]!.tasks).toEqual([])
    expect(packages[0]!.taskContents).toEqual([])
  })
})

// ── gatherEvents: COMMIT[] flags ─────────────────────────────────────────────

describe("gatherEvents — COMMIT flags from the flat gtd: taxonomy", { timeout: 30_000 }, () => {
  beforeEach(() => initRepo(true))
  afterEach(cleanup)

  it("emits COMMIT[] (oldest→newest) followed by exactly one trailing RESOLVE", async () => {
    commitFile("gtd: planning", "a.ts", "//a\n")
    const events = await runGather()
    expect(events[events.length - 1]!.type).toBe("RESOLVE")
    expect(events.slice(0, -1).every((e) => e.type === "COMMIT")).toBe(true)
    expect(events.filter((e) => e.type === "RESOLVE")).toHaveLength(1)
  })

  it("sets isErrors / isFeedback / isPackageStart / isWorkflowCommit per subject", async () => {
    commitFile("gtd: planning", "a.ts", "//a\n")
    commitFile("gtd: building", "b.ts", "//b\n")
    commitFile("gtd: errors", "c.ts", "//c\n")
    commitFile("gtd: feedback", "d.ts", "//d\n")
    commitFile("gtd: package done", "e.ts", "//e\n")
    commitFile("feat: real work", "f.ts", "//f\n")

    const commits = commitsOf(await runGather())
    expect(commits).toHaveLength(6)
    expect(commits[0]).toMatchObject({
      isPackageStart: true,
      isWorkflowCommit: true,
      isErrors: false,
      isFeedback: false,
    })
    expect(commits[1]).toMatchObject({
      isWorkflowCommit: true,
      isPackageStart: false,
      isErrors: false,
      isFeedback: false,
    })
    expect(commits[2]).toMatchObject({ isErrors: true, isWorkflowCommit: true, isFeedback: false })
    expect(commits[3]).toMatchObject({ isFeedback: true, isWorkflowCommit: true, isErrors: false })
    expect(commits[4]).toMatchObject({ isPackageStart: true, isWorkflowCommit: true })
    expect(commits[5]).toMatchObject({
      isWorkflowCommit: false,
      isErrors: false,
      isFeedback: false,
      isPackageStart: false,
    })
  })

  it("sets removedErrors only on the commit whose diff deletes ERRORS.md", async () => {
    commitFile("gtd: errors", "ERRORS.md", "boom\n") // adds ERRORS.md
    git("rm", "ERRORS.md")
    git("commit", "-q", "-m", "gtd: building") // deletes ERRORS.md (human-resume shape)
    commitFile("feat: after", "x.ts", "//x\n")

    const commits = commitsOf(await runGather())
    expect(commits).toHaveLength(3)
    expect(commits[0]).toMatchObject({ isErrors: true, removedErrors: false })
    expect(commits[1]).toMatchObject({
      isErrors: false,
      removedErrors: true,
      isWorkflowCommit: true,
    })
    expect(commits[2]).toMatchObject({ removedErrors: false })
  })
})

// ── gatherEvents: RESOLVE payload ────────────────────────────────────────────

describe("gatherEvents — RESOLVE payload", { timeout: 30_000 }, () => {
  beforeEach(() => initRepo(true))
  afterEach(cleanup)

  it("steering presence + gtdModified + codeDirty + workingTreeClean", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeFileSync(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\n")
    writeFileSync(join(repoDir, "src.ts"), "export const x = 1\n")
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")

    const p = resolveOf(await runGather())
    expect(p.todoExists).toBe(true)
    expect(p.gtdDirExists).toBe(true)
    expect(p.gtdModified).toBe(true)
    expect(p.codeDirty).toBe(true)
    expect(p.workingTreeClean).toBe(false)
    expect(p.reviewPresent).toBe(false)
    expect(p.feedbackPresent).toBe(false)
    expect(p.errorsPresent).toBe(false)
    expect(p.diff).toContain("src.ts")
  })

  it("codeDirty is false when only steering / .gtd files are dirty", async () => {
    mkdirSync(join(repoDir, ".gtd"), { recursive: true })
    writeFileSync(join(repoDir, ".gtd", "note.md"), "x\n")
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n")

    const p = resolveOf(await runGather())
    expect(p.codeDirty).toBe(false)
    expect(p.gtdModified).toBe(true)
  })

  it("todoMarkerPresent: true for a marker anywhere in TODO.md", async () => {
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n\nintro\n<!-- user answers here -->\nmore\n")
    expect(resolveOf(await runGather()).todoMarkerPresent).toBe(true)
  })

  it("todoMarkerPresent: false when the only marker sits inside a code fence", async () => {
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n\n```\n<!-- user answers here -->\n```\n")
    expect(resolveOf(await runGather()).todoMarkerPresent).toBe(false)
  })

  it("todoMarkerPresent: false when TODO.md is absent", async () => {
    expect(resolveOf(await runGather()).todoMarkerPresent).toBe(false)
  })

  it("a seedTodo TODO.md whose diff embeds the marker is NOT detected (fence-stripped)", async () => {
    writeFileSync(join(repoDir, "TODO.md"), seedTodo("+ <!-- user answers here -->\n"))
    expect(resolveOf(await runGather()).todoMarkerPresent).toBe(false)
  })

  it("feedbackEmpty is whitespace-tolerant; untracked FEEDBACK is not committed", async () => {
    writeFileSync(join(repoDir, "FEEDBACK.md"), "   \n\n  ")
    const p = resolveOf(await runGather())
    expect(p.feedbackPresent).toBe(true)
    expect(p.feedbackEmpty).toBe(true)
    expect(p.feedbackCommitted).toBe(false)
  })

  it("content-bearing committed FEEDBACK → feedbackEmpty false, feedbackCommitted true", async () => {
    commitFile("gtd: errors", "FEEDBACK.md", "# Feedback\n\nfix this\n")
    const p = resolveOf(await runGather())
    expect(p.feedbackPresent).toBe(true)
    expect(p.feedbackEmpty).toBe(false)
    expect(p.feedbackCommitted).toBe(true)
    expect(p.feedbackContent).toContain("fix this")
  })

  it("feedbackContent carries the FEEDBACK.md text (inlined into the Fixing prompt) and is empty when absent", async () => {
    expect(resolveOf(await runGather()).feedbackContent).toBe("")
    writeFileSync(join(repoDir, "FEEDBACK.md"), "review finding: rename foo\n")
    expect(resolveOf(await runGather()).feedbackContent).toContain("review finding: rename foo")
  })

  it("uncommitted REVIEW → present, not committed, not dirty (Await Review)", async () => {
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n")
    const p = resolveOf(await runGather())
    expect(p.reviewPresent).toBe(true)
    expect(p.reviewCommitted).toBe(false)
    expect(p.reviewDirty).toBe(false)
  })

  it("committed REVIEW + clean tree → reviewCommitted (Done)", async () => {
    commitFile("gtd: awaiting review", "REVIEW.md", "# Review\n")
    const p = resolveOf(await runGather())
    expect(p.reviewCommitted).toBe(true)
    expect(p.reviewDirty).toBe(false)
  })

  it("committed REVIEW + edited REVIEW → reviewDirty (Accept Review)", async () => {
    commitFile("gtd: awaiting review", "REVIEW.md", "# Review\n")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n\nhuman feedback\n")
    const p = resolveOf(await runGather())
    expect(p.reviewCommitted).toBe(false)
    expect(p.reviewDirty).toBe(true)
  })

  it("committed REVIEW + other pending file → reviewDirty (Accept Review)", async () => {
    commitFile("gtd: awaiting review", "REVIEW.md", "# Review\n")
    writeFileSync(join(repoDir, "code.ts"), "human edit\n")
    expect(resolveOf(await runGather()).reviewDirty).toBe(true)
  })

  it("committed REVIEW + checkbox-only edit → reviewCheckboxOnly true, reviewDirty true", async () => {
    commitFile("gtd: awaiting review", "REVIEW.md", "# Review\n\n- [ ] item one\n- [ ] item two\n")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n\n- [x] item one\n- [ ] item two\n")
    const p = resolveOf(await runGather())
    expect(p.reviewDirty).toBe(true)
    expect(p.reviewCheckboxOnly).toBe(true)
  })

  it("committed REVIEW + textual annotation → reviewCheckboxOnly false, reviewDirty true", async () => {
    commitFile("gtd: awaiting review", "REVIEW.md", "# Review\n\n- [ ] item one\n")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n\n- [x] item one\n\nhuman comment here\n")
    const p = resolveOf(await runGather())
    expect(p.reviewDirty).toBe(true)
    expect(p.reviewCheckboxOnly).toBe(false)
  })

  it("pendingErrorsDeletion reflects a working-tree ERRORS.md deletion", async () => {
    commitFile("gtd: errors", "ERRORS.md", "boom\n")
    rmSync(join(repoDir, "ERRORS.md")) // human removes the committed ERRORS.md
    const p = resolveOf(await runGather())
    expect(p.errorsPresent).toBe(false)
    expect(p.pendingErrorsDeletion).toBe(true)
  })

  it("lastCommitSubject + packages passthrough", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeFileSync(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\nbody\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: planning")
    const p = resolveOf(await runGather())
    expect(p.lastCommitSubject).toBe("gtd: planning")
    expect(p.workingTreeClean).toBe(true)
    expect(p.packages).toHaveLength(1)
    expect(p.packages[0]!.name).toBe("01-foo")
    expect(p.packages[0]!.tasks).toEqual(["01-task.md"])
  })

  it("config passthrough: agenticReviewEnabled / fixAttemptCap / reviewThreshold", async () => {
    const p = resolveOf(
      await runGather({ agenticReview: false, fixAttemptCap: 5, reviewThreshold: 2 }),
    )
    expect(p.agenticReviewEnabled).toBe(false)
    expect(p.fixAttemptCap).toBe(5)
    expect(p.reviewThreshold).toBe(2)
  })

  it("config defaults flow through when unset", async () => {
    const p = resolveOf(await runGather())
    expect(p.agenticReviewEnabled).toBe(true)
    expect(p.fixAttemptCap).toBe(3)
    expect(p.reviewThreshold).toBe(3)
  })
})

// ── gatherEvents: review base ────────────────────────────────────────────────

describe("gatherEvents — review base (reviewBase / refDiff)", { timeout: 30_000 }, () => {
  afterEach(cleanup)

  it("feature branch → merge-base with the default branch; refDiff non-empty", async () => {
    initRepo(true)
    commitFile("feat: work", "work.ts", "export const w = 1\n")
    const mergeBase = git("rev-parse", "main")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(mergeBase)
    expect(p.refDiff).toContain("work.ts")
  })

  it("default branch → last REVIEW.md deletion as the base", async () => {
    initRepo(false)
    commitFile("feat: a", "a.ts", "//a\n")
    commitFile("gtd: awaiting review", "REVIEW.md", "# Review\n")
    git("rm", "REVIEW.md")
    git("commit", "-q", "-m", "gtd: done")
    const deletionSha = git("rev-parse", "HEAD")
    commitFile("feat: more", "b.ts", "//b\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(deletionSha)
    expect(p.refDiff).toContain("b.ts")
  })

  it("base whose diff to HEAD is empty → reviewBase/refDiff unset (Idle)", async () => {
    initRepo(false)
    commitFile("feat: a", "a.ts", "//a\n")
    commitFile("gtd: awaiting review", "REVIEW.md", "# Review\n")
    git("rm", "REVIEW.md")
    git("commit", "-q", "-m", "gtd: done") // HEAD itself is the REVIEW.md deletion
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBeUndefined()
    expect(p.refDiff).toBeUndefined()
  })
})

// ── gatherEvents: COMMIT-stream base folds ───────────────────────────────────

describe("gatherEvents — COMMIT-stream base folds (issue-7)", { timeout: 30_000 }, () => {
  afterEach(cleanup)

  it("trunk regression: gtd: errors commits after gtd: planning fold into testFixCount == 2, not 0", async () => {
    initRepo(false)
    commitFile("gtd: planning", "TODO.md", "# Plan\n")
    commitFile("gtd: errors", "ERRORS.md", "error 1\n")
    commitFile("gtd: errors", "ERRORS.md", "error 2\n")
    const events = await runGather()
    const errorCommits = commitsOf(events).filter((e) => e.isErrors)
    expect(errorCommits).toHaveLength(2)
  })

  it("feature-branch control: only post-branch-point gtd: errors commits are included", async () => {
    initRepo(true)
    commitFile("gtd: planning", "TODO.md", "# Plan\n")
    commitFile("gtd: errors", "ERRORS.md", "error 1\n")
    commitFile("gtd: errors", "ERRORS.md", "error 2\n")
    const events = await runGather()
    const errorCommits = commitsOf(events).filter((e) => e.isErrors)
    expect(errorCommits).toHaveLength(2)
  })
})

// ── perform: EdgeAction execution ────────────────────────────────────────────

describe("perform — EdgeAction execution", { timeout: 30_000 }, () => {
  beforeEach(() => initRepo(false))
  afterEach(cleanup)

  it("transportReset mixed-resets HEAD, keeping the work in the tree", async () => {
    writeFileSync(join(repoDir, "extra.ts"), "export const e = 1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: transport")
    await runPerform({ kind: "transportReset" })
    expect(git("log", "-1", "--format=%s")).toBe("chore: init")
    expect(git("status", "--porcelain")).toContain("extra.ts")
  })

  it("seedNewFeature (boundary + dirty): commits gtd: new task, reverts it, seeds TODO.md", async () => {
    writeFileSync(join(repoDir, "feature.ts"), "export const raw = 1\n")
    await runPerform({ kind: "seedNewFeature" })
    expect(git("log", "-1", "--format=%s")).toBe("gtd: new task")
    expect(existsSync(join(repoDir, "TODO.md"))).toBe(true)
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("Captured input")
    expect(existsSync(join(repoDir, "feature.ts"))).toBe(false) // reverted to baseline
  })

  it("seedNewFeature (HEAD gtd: new task + clean): regenerates the seed without a new commit", async () => {
    writeFileSync(join(repoDir, "feature.ts"), "export const raw = 1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: new task")
    const countBefore = git("rev-list", "--count", "HEAD")
    await runPerform({ kind: "seedNewFeature" })
    expect(git("rev-list", "--count", "HEAD")).toBe(countBefore) // no extra commit
    expect(git("log", "-1", "--format=%s")).toBe("gtd: new task")
    expect(existsSync(join(repoDir, "TODO.md"))).toBe(true)
    expect(existsSync(join(repoDir, "feature.ts"))).toBe(false)
  })

  it("seedAcceptReview: discards code edits, seeds TODO.md from the changeset, removes REVIEW.md", async () => {
    writeFileSync(join(repoDir, "code.ts"), "v1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "feat: base")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: awaiting review")
    // Human edits code + annotates REVIEW.md:
    writeFileSync(join(repoDir, "code.ts"), "v2 human edit\n")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n\nHUMAN FEEDBACK\n")

    await runPerform({ kind: "seedAcceptReview" })

    expect(existsSync(join(repoDir, "REVIEW.md"))).toBe(false)
    expect(existsSync(join(repoDir, "TODO.md"))).toBe(true)
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("HUMAN FEEDBACK")
    expect(readFileSync(join(repoDir, "code.ts"), "utf8")).toBe("v1\n") // edits discarded
  })

  it("runTest green: commits gtd: building, writes no FEEDBACK/ERRORS", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeFileSync(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\n")
    writeFileSync(join(repoDir, "impl.ts"), "export const i = 1\n")
    await runPerform(
      { kind: "runTest", errorCount: 0, capReached: false },
      { exitCode: 0, output: "pass" },
    )
    expect(git("log", "-1", "--format=%s")).toBe("gtd: building")
    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(false)
    expect(existsSync(join(repoDir, "ERRORS.md"))).toBe(false)
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("runTest red under cap: writes FEEDBACK.md and commits gtd: errors", async () => {
    writeFileSync(join(repoDir, "impl.ts"), "export const i = 1\n")
    await runPerform(
      { kind: "runTest", errorCount: 1, capReached: false },
      { exitCode: 1, output: "FAIL: boom\n" },
    )
    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(true)
    expect(readFileSync(join(repoDir, "FEEDBACK.md"), "utf8")).toContain("FAIL: boom")
    expect(existsSync(join(repoDir, "ERRORS.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: errors")
  })

  it("runTest red at cap: writes ERRORS.md (not FEEDBACK.md) and commits gtd: errors", async () => {
    writeFileSync(join(repoDir, "impl.ts"), "export const i = 1\n")
    await runPerform(
      { kind: "runTest", errorCount: 3, capReached: true },
      { exitCode: 1, output: "FAIL: persistent\n" },
    )
    expect(existsSync(join(repoDir, "ERRORS.md"))).toBe(true)
    expect(readFileSync(join(repoDir, "ERRORS.md"), "utf8")).toContain("FAIL: persistent")
    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: errors")
  })

  it("runTest no-op fixer (clean tree, green): commits an empty gtd: building to advance HEAD off gtd: fixing", async () => {
    git("commit", "-q", "--allow-empty", "-m", "gtd: fixing") // clean tree, HEAD gtd: fixing
    const countBefore = Number(git("rev-list", "--count", "HEAD"))
    await runPerform(
      { kind: "runTest", errorCount: 0, capReached: false },
      { exitCode: 0, output: "" },
    )
    // Without this advance HEAD stays `gtd: fixing`, the next resolve re-detects
    // Testing, and the driver loops to MAX_EDGE_HOPS. The empty commit moves HEAD
    // to `gtd: building` so the next resolve reaches Agentic Review.
    expect(Number(git("rev-list", "--count", "HEAD"))).toBe(countBefore + 1)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: building")
    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(false)
    expect(existsSync(join(repoDir, "ERRORS.md"))).toBe(false)
  })

  it("commitPending: commits the whole pending tree under the given prefix", async () => {
    writeFileSync(join(repoDir, "src.ts"), "code\n")
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")
    await runPerform({ kind: "commitPending", prefix: "gtd: grilling" })
    expect(git("log", "-1", "--format=%s")).toBe("gtd: grilling")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("commitPending removeFeedback (Fixing, committed FEEDBACK): deletes FEEDBACK.md, lands its removal in gtd: fixing", async () => {
    // Testing wrote FEEDBACK.md as `gtd: errors`; Fixing consumes it as `gtd: fixing`.
    commitFile("gtd: errors", "FEEDBACK.md", "AssertionError: boom\n")
    // The fixer's pending code change rides along into the same commit.
    writeFileSync(join(repoDir, "impl.ts"), "export const fixed = 1\n")
    await runPerform({ kind: "commitPending", prefix: "gtd: fixing", removeFeedback: true })
    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: fixing")
    expect(git("status", "--porcelain").trim()).toBe("")
    // The commit records the FEEDBACK.md deletion (provenance preserved).
    expect(git("show", "--name-status", "--format=", "HEAD")).toContain("D\tFEEDBACK.md")
  })

  it("commitPending removeFeedback (Fixing, uncommitted FEEDBACK): removes the untracked FEEDBACK.md under gtd: feedback", async () => {
    // Agentic Review wrote an uncommitted FEEDBACK.md; Fixing consumes it as `gtd: feedback`.
    writeFileSync(join(repoDir, "FEEDBACK.md"), "Finding: trim whitespace.\n")
    await runPerform({ kind: "commitPending", prefix: "gtd: feedback", removeFeedback: true })
    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: feedback")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("commitPending removeTodo: deletes TODO.md and lands its removal in the commit", async () => {
    // Committed TODO.md exists; a pending .gtd change rides along.
    commitFile("gtd: planning", "TODO.md", "# Plan\n")
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeFileSync(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\n")
    await runPerform({ kind: "commitPending", prefix: "gtd: planning", removeTodo: true })
    expect(existsSync(join(repoDir, "TODO.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: planning")
    expect(git("status", "--porcelain").trim()).toBe("")
    expect(git("show", "--name-status", "--format=", "HEAD")).toContain("D\tTODO.md")
  })

  it("closePackage (empty FEEDBACK): removes FEEDBACK + last package + empty .gtd, commits gtd: package done", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeFileSync(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: building")
    writeFileSync(join(repoDir, "FEEDBACK.md"), "") // empty, untracked

    await runPerform({ kind: "closePackage" })

    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(false)
    expect(existsSync(join(repoDir, ".gtd", "01-foo"))).toBe(false)
    expect(existsSync(join(repoDir, ".gtd"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: package done")
  })

  it("closePackage (force-approve, no FEEDBACK): removes first package, keeps the rest", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    mkdirSync(join(repoDir, ".gtd", "02-bar"), { recursive: true })
    writeFileSync(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# A\n")
    writeFileSync(join(repoDir, ".gtd", "02-bar", "01-task.md"), "# B\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: building")

    await runPerform({ kind: "closePackage" }) // no FEEDBACK.md present — tolerated

    expect(existsSync(join(repoDir, ".gtd", "01-foo"))).toBe(false)
    expect(existsSync(join(repoDir, ".gtd", "02-bar"))).toBe(true)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: package done")
  })

  it("commitReview: commits REVIEW.md as gtd: awaiting review", async () => {
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n")
    await runPerform({ kind: "commitReview" })
    expect(git("log", "-1", "--format=%s")).toBe("gtd: awaiting review")
    expect(git("ls-files", "REVIEW.md").trim()).toBe("REVIEW.md")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("done: removes REVIEW.md and commits gtd: done", async () => {
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: awaiting review")
    await runPerform({ kind: "done" })
    expect(existsSync(join(repoDir, "REVIEW.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: done")
    expect(git("ls-files", "REVIEW.md").trim()).toBe("")
  })
})
