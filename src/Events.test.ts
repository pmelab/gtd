import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { gatherEvents, getPackages, isCheckboxOnlyDiff, perform, reviewAgainst } from "./Events.js"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import type { ConfigOperations } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { TestRunner } from "./TestRunner.js"
import { foldCounters } from "./Machine.js"
import type { CommitEvent, EdgeAction, GtdEvent, ResolvePayload } from "./Machine.js"
import { turnSubject } from "./Subjects.js"

// ── Repo harness ─────────────────────────────────────────────────────────────
// Each test runs against a fresh real git repo, cwd'd in so gatherEvents/perform
// resolve their relative paths (".gtd", ".gtd/TODO.md", …) against it.

let repoDir: string

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repoDir, encoding: "utf8", stdio: "pipe" }).trim()

// `git rm` of the last file under `.gtd/` deletes the directory too, so every
// write re-creates parent dirs.
const writeRepoFile = (absPath: string, content: string): void => {
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content)
}

const commitFile = (msg: string, file: string, content: string): void => {
  writeRepoFile(join(repoDir, file), content)
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
  writeRepoFile(join(repoDir, "README.md"), "# test\n")
  git("add", "-A")
  git("commit", "-q", "-m", "chore: init")
  git("branch", "-M", "main")
  if (branch) git("checkout", "-q", "-b", "feature")
  // Steering files live under `.gtd/`; pre-create the (git-invisible while
  // empty) directory so tests can write them directly.
  mkdirSync(join(repoDir, ".gtd"), { recursive: true })
}

const cleanup = (): void => {
  rmSync(repoDir, { recursive: true, force: true })
}

// ── Effect runners ───────────────────────────────────────────────────────────

const fakeConfig = (o: Partial<ConfigOperations> = {}): ConfigOperations => ({
  testCommand: "echo test",
  resolveModel: () => "claude-opus-4-8",
  agenticReview: true,
  squash: true,
  // Isolated from squash-specific tests below by default — learning has its
  // own describe block that opts back in via the `o` override.
  learning: false,
  decisionLog: true,
  fixAttemptCap: 3,
  reviewThreshold: 3,
  ...o,
})

const runGather = (
  invoker: "human" | "agent" | "none" = "none",
  cfg: Partial<ConfigOperations> = {},
): Promise<ReadonlyArray<GtdEvent>> =>
  Effect.runPromise(
    gatherEvents(invoker).pipe(
      Effect.provide(GitService.Live),
      Effect.provide(NodeContext.layer),
      Effect.provide(Layer.succeed(ConfigService, fakeConfig(cfg))),
      Effect.provide(Cwd.layer(repoDir)),
    ),
  )

const runGetPackages = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return yield* getPackages(fs, repoDir)
    }).pipe(Effect.provide(NodeContext.layer)),
  )

const runPerform = (
  action: EdgeAction,
  testResult: { exitCode: number; output: string } = { exitCode: 0, output: "" },
): Promise<{ stop: boolean }> =>
  Effect.runPromise(
    perform(action).pipe(
      Effect.provide(GitService.Live),
      Effect.provide(NodeContext.layer),
      Effect.provide(Layer.succeed(TestRunner, { run: () => Effect.succeed(testResult) })),
      Effect.provide(
        Layer.succeed(ConfigService, {
          testCommand: "npm run test",
          resolveModel: () => "stub",
          agenticReview: true,
          squash: true,
          learning: false,
          decisionLog: true,
          fixAttemptCap: 3,
          reviewThreshold: 3,
        }),
      ),
      Effect.provide(Cwd.layer(repoDir)),
    ),
  )

const runReviewAgainst = (target: string) =>
  Effect.runPromise(
    reviewAgainst(target).pipe(
      Effect.provide(GitService.Live),
      Effect.provide(NodeContext.layer),
      Effect.provide(Cwd.layer(repoDir)),
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

// ── isCheckboxOnlyDiff (pure, unchanged from v1) ─────────────────────────────

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

// ── getPackages (unchanged from v1) ──────────────────────────────────────────

describe("getPackages — {name,tasks,taskContents} shape", () => {
  beforeEach(() => initRepo(false))
  afterEach(cleanup)

  it("reads task contents sorted to match tasks", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeRepoFile(join(repoDir, ".gtd", "01-foo", "02-second.md"), "# Second\nbody two\n")
    writeRepoFile(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\nbody one\n")

    const packages = await runGetPackages()

    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.name).toBe("01-foo")
    expect(pkg.tasks).toEqual(["01-task.md", "02-second.md"])
    expect(pkg.taskContents).toEqual([
      { name: "01-task.md", content: "# Task\nbody one\n" },
      { name: "02-second.md", content: "# Second\nbody two\n" },
    ])
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

// ── gatherEvents: COMMIT[] flags from the v2 turn/routing grammar ───────────

describe("gatherEvents — COMMIT flags from the v2 grammar", { timeout: 30_000 }, () => {
  beforeEach(() => initRepo(true))
  afterEach(cleanup)

  it("emits COMMIT[] (oldest→newest) followed by exactly one trailing RESOLVE", async () => {
    commitFile("gtd: planning", "a.ts", "//a\n")
    const events = await runGather()
    expect(events[events.length - 1]!.type).toBe("RESOLVE")
    expect(events.slice(0, -1).every((e) => e.type === "COMMIT")).toBe(true)
    expect(events.filter((e) => e.type === "RESOLVE")).toHaveLength(1)
  })

  it("sets turnActor/turnGate for a turn commit, leaves them unset for routing/boundary", async () => {
    commitFile(turnSubject("human", "grilling"), "a.ts", "//a\n")
    commitFile("gtd: grilled", "b.ts", "//b\n")
    commitFile("feat: real work", "c.ts", "//c\n")

    const commits = commitsOf(await runGather())
    expect(commits).toHaveLength(3)
    expect(commits[0]).toMatchObject({ turnActor: "human", turnGate: "grilling" })
    expect(commits[1]!.turnActor).toBeUndefined()
    expect(commits[2]!.turnActor).toBeUndefined()
  })

  it("sets isErrors / isPackageStart / isWorkflowCommit per routing subject", async () => {
    commitFile("gtd: planning", "a.ts", "//a\n")
    commitFile(turnSubject("agent", "building"), "b.ts", "//b\n")
    commitFile("gtd: errors", "c.ts", "//c\n")
    commitFile("gtd: package done", "e.ts", "//e\n")
    commitFile("feat: real work", "f.ts", "//f\n")

    const commits = commitsOf(await runGather())
    expect(commits).toHaveLength(5)
    expect(commits[0]).toMatchObject({
      isPackageStart: true,
      isWorkflowCommit: true,
      isErrors: false,
    })
    expect(commits[1]).toMatchObject({ isWorkflowCommit: true, isPackageStart: false })
    expect(commits[2]).toMatchObject({ isErrors: true, isWorkflowCommit: true })
    expect(commits[3]).toMatchObject({ isPackageStart: true, isWorkflowCommit: true })
    expect(commits[4]).toMatchObject({
      isWorkflowCommit: false,
      isErrors: false,
      isPackageStart: false,
    })
  })

  it("v1 subjects (gtd: new task, bare gtd: reviewing, gtd: feedback) parse as inert boundary commits", async () => {
    commitFile("gtd: new task", "a.ts", "//a\n")
    commitFile("gtd: reviewing", "b.ts", "//b\n")
    commitFile("gtd: feedback", "c.ts", "//c\n")
    commitFile("gtd: grilling", "d.ts", "//d\n") // v1 bare grilling — not a v2 turn

    const commits = commitsOf(await runGather())
    expect(commits).toHaveLength(4)
    for (const c of commits) {
      expect(c.isWorkflowCommit).toBe(false)
      expect(c.turnActor).toBeUndefined()
    }
  })

  it("isFeedback: true only for a gtd(agent): agentic-review turn whose diff touched FEEDBACK.md", async () => {
    commitFile(turnSubject("agent", "agentic-review"), ".gtd/FEEDBACK.md", "finding: rename foo\n")
    commitFile(turnSubject("agent", "building"), "b.ts", "//b\n") // agentic-review gate but no FEEDBACK touch below
    commitFile("gtd: package done", "c.ts", "//c\n")

    const commits = commitsOf(await runGather())
    expect(commits[0]).toMatchObject({ isFeedback: true })
    expect(commits[1]).toMatchObject({ isFeedback: false })
    expect(commits[2]).toMatchObject({ isFeedback: false })
  })

  it("isFeedback also counts an empty (approval) agentic-review touching FEEDBACK.md (documented over-count)", async () => {
    // Findings round: writes FEEDBACK.md with content.
    commitFile(turnSubject("agent", "agentic-review"), ".gtd/FEEDBACK.md", "finding\n")
    // Approval round: agent empties FEEDBACK.md — still touches the path.
    writeRepoFile(join(repoDir, ".gtd/FEEDBACK.md"), "")
    git("add", "-A")
    git("commit", "-q", "-m", turnSubject("agent", "agentic-review"))

    const commits = commitsOf(await runGather())
    expect(commits[0]).toMatchObject({ isFeedback: true })
    expect(commits[1]).toMatchObject({ isFeedback: true })
  })

  it("sets removedErrors only on the commit whose diff deletes ERRORS.md", async () => {
    commitFile("gtd: errors", ".gtd/ERRORS.md", "boom\n") // adds ERRORS.md
    git("rm", ".gtd/ERRORS.md")
    git("commit", "-q", "-m", turnSubject("human", "escalate")) // deletes ERRORS.md (human resume)
    commitFile("feat: after", "x.ts", "//x\n")

    const commits = commitsOf(await runGather())
    expect(commits).toHaveLength(3)
    expect(commits[0]).toMatchObject({ isErrors: true, removedErrors: false })
    expect(commits[1]).toMatchObject({ removedErrors: true, isWorkflowCommit: true })
    expect(commits[2]).toMatchObject({ removedErrors: false })
  })

  it("sets isHealthCheck for gtd: health-check only", async () => {
    commitFile("gtd: health-check", ".gtd/HEALTH.md", "# Health\nfail\n")
    commitFile("gtd: health-fix", "x.ts", "//fix\n")
    commitFile("feat: regular", "y.ts", "//y\n")

    const commits = commitsOf(await runGather())
    expect(commits).toHaveLength(3)
    expect(commits[0]).toMatchObject({ isHealthCheck: true })
    expect(commits[1]).toMatchObject({ isHealthCheck: false })
    expect(commits[2]).toMatchObject({ isHealthCheck: false })
  })
})

// ── gatherEvents: RESOLVE payload ────────────────────────────────────────────

describe("gatherEvents — RESOLVE payload", { timeout: 30_000 }, () => {
  beforeEach(() => initRepo(true))
  afterEach(cleanup)

  it("invoker passes through to the payload", async () => {
    expect(resolveOf(await runGather("human")).invoker).toBe("human")
    expect(resolveOf(await runGather("agent")).invoker).toBe("agent")
    expect(resolveOf(await runGather("none")).invoker).toBe("none")
  })

  it("steering presence + gtdModified + codeDirty + workingTreeClean", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeRepoFile(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\n")
    writeRepoFile(join(repoDir, "src.ts"), "export const x = 1\n")
    writeRepoFile(join(repoDir, ".gtd/TODO.md"), "# Plan\n")

    const p = resolveOf(await runGather())
    expect(p.todoExists).toBe(true)
    expect(p.packagesPresent).toBe(true)
    expect(p.gtdModified).toBe(true)
    expect(p.codeDirty).toBe(true)
    expect(p.workingTreeClean).toBe(false)
    expect(p.reviewPresent).toBe(false)
    expect(p.feedbackPresent).toBe(false)
    expect(p.errorsPresent).toBe(false)
  })

  it("codeDirty is false when only steering / .gtd files are dirty", async () => {
    mkdirSync(join(repoDir, ".gtd"), { recursive: true })
    writeRepoFile(join(repoDir, ".gtd", "note.md"), "x\n")
    writeRepoFile(join(repoDir, ".gtd/TODO.md"), "# Plan\n")
    writeRepoFile(join(repoDir, ".gtd/REVIEW.md"), "# Review\n")

    const p = resolveOf(await runGather())
    expect(p.codeDirty).toBe(false)
    // Steering churn alone is NOT package modification — only numbered
    // package paths flip gtdModified.
    expect(p.gtdModified).toBe(false)
  })

  it("gtdModified is true only for numbered package paths under .gtd/", async () => {
    writeRepoFile(join(repoDir, ".gtd", "01-x", "01-task.md"), "# Task\n")
    writeRepoFile(join(repoDir, ".gtd/FEEDBACK.md"), "finding\n")

    const p = resolveOf(await runGather())
    expect(p.gtdModified).toBe(true)
    expect(p.codeDirty).toBe(false)
  })

  it("feedbackEmpty is whitespace-tolerant; untracked FEEDBACK is not committed", async () => {
    writeRepoFile(join(repoDir, ".gtd/FEEDBACK.md"), "   \n\n  ")
    const p = resolveOf(await runGather())
    expect(p.feedbackPresent).toBe(true)
    expect(p.feedbackEmpty).toBe(true)
    expect(p.feedbackCommitted).toBe(false)
  })

  it("content-bearing committed FEEDBACK → feedbackEmpty false, feedbackCommitted true", async () => {
    commitFile("gtd: errors", ".gtd/FEEDBACK.md", "# Feedback\n\nfix this\n")
    const p = resolveOf(await runGather())
    expect(p.feedbackPresent).toBe(true)
    expect(p.feedbackEmpty).toBe(false)
    expect(p.feedbackCommitted).toBe(true)
    expect(p.feedbackContent).toContain("fix this")
  })

  it("feedbackContent carries the FEEDBACK.md text and is empty when absent", async () => {
    expect(resolveOf(await runGather()).feedbackContent).toBe("")
    writeRepoFile(join(repoDir, ".gtd/FEEDBACK.md"), "review finding: rename foo\n")
    expect(resolveOf(await runGather()).feedbackContent).toContain("review finding: rename foo")
  })

  it("uncommitted REVIEW → present, not committed, not dirty (Await Review)", async () => {
    writeRepoFile(join(repoDir, ".gtd/REVIEW.md"), "# Review\n")
    const p = resolveOf(await runGather())
    expect(p.reviewPresent).toBe(true)
    expect(p.reviewCommitted).toBe(false)
    expect(p.reviewDirty).toBe(false)
  })

  it("committed REVIEW + clean tree → reviewCommitted (Done)", async () => {
    commitFile("gtd: awaiting review", ".gtd/REVIEW.md", "# Review\n")
    const p = resolveOf(await runGather())
    expect(p.reviewCommitted).toBe(true)
    expect(p.reviewDirty).toBe(false)
  })

  it("committed REVIEW + edited REVIEW → reviewDirty (human review turn)", async () => {
    commitFile("gtd: awaiting review", ".gtd/REVIEW.md", "# Review\n")
    writeRepoFile(join(repoDir, ".gtd/REVIEW.md"), "# Review\n\nhuman feedback\n")
    const p = resolveOf(await runGather())
    expect(p.reviewCommitted).toBe(false)
    expect(p.reviewDirty).toBe(true)
  })

  it("committed REVIEW + other pending file → reviewDirty", async () => {
    commitFile("gtd: awaiting review", ".gtd/REVIEW.md", "# Review\n")
    writeRepoFile(join(repoDir, "code.ts"), "human edit\n")
    expect(resolveOf(await runGather()).reviewDirty).toBe(true)
  })

  it("committed REVIEW + checkbox-only edit → reviewCheckboxOnly true, reviewDirty true", async () => {
    commitFile(
      "gtd: awaiting review",
      ".gtd/REVIEW.md",
      "# Review\n\n- [ ] item one\n- [ ] item two\n",
    )
    writeRepoFile(join(repoDir, ".gtd/REVIEW.md"), "# Review\n\n- [x] item one\n- [ ] item two\n")
    const p = resolveOf(await runGather())
    expect(p.reviewDirty).toBe(true)
    expect(p.reviewCheckboxOnly).toBe(true)
  })

  it("committed REVIEW + textual annotation → reviewCheckboxOnly false, reviewDirty true", async () => {
    commitFile("gtd: awaiting review", ".gtd/REVIEW.md", "# Review\n\n- [ ] item one\n")
    writeFileSync(
      join(repoDir, ".gtd/REVIEW.md"),
      "# Review\n\n- [x] item one\n\nhuman comment here\n",
    )
    const p = resolveOf(await runGather())
    expect(p.reviewDirty).toBe(true)
    expect(p.reviewCheckboxOnly).toBe(false)
  })

  it("todoCommitted: tracked at HEAD → true (even with pending edits)", async () => {
    commitFile(turnSubject("agent", "grilling"), ".gtd/TODO.md", "# Plan\n")
    writeRepoFile(join(repoDir, ".gtd/TODO.md"), "# Plan\n\nedited\n")
    const p = resolveOf(await runGather())
    expect(p.todoExists).toBe(true)
    expect(p.todoCommitted).toBe(true)
  })

  it("todoCommitted: freshly written (untracked) TODO.md → false", async () => {
    writeRepoFile(join(repoDir, ".gtd/TODO.md"), "# Plan\n")
    const p = resolveOf(await runGather())
    expect(p.todoExists).toBe(true)
    expect(p.todoCommitted).toBe(false)
  })

  it("architectureCommitted: tracked at HEAD → true (even with pending edits)", async () => {
    commitFile(turnSubject("agent", "architecting"), ".gtd/ARCHITECTURE.md", "# Architecture\n")
    writeRepoFile(join(repoDir, ".gtd/ARCHITECTURE.md"), "# Architecture\n\nedited\n")
    const p = resolveOf(await runGather())
    expect(p.architectureExists).toBe(true)
    expect(p.architectureCommitted).toBe(true)
  })

  it("architectureCommitted: freshly written (untracked) ARCHITECTURE.md → false", async () => {
    writeRepoFile(join(repoDir, ".gtd/ARCHITECTURE.md"), "# Architecture\n")
    const p = resolveOf(await runGather())
    expect(p.architectureExists).toBe(true)
    expect(p.architectureCommitted).toBe(false)
  })

  it("pendingErrorsDeletion reflects a working-tree ERRORS.md deletion", async () => {
    commitFile("gtd: errors", ".gtd/ERRORS.md", "boom\n")
    rmSync(join(repoDir, ".gtd/ERRORS.md")) // human removes the committed ERRORS.md
    const p = resolveOf(await runGather())
    expect(p.errorsPresent).toBe(false)
    expect(p.pendingErrorsDeletion).toBe(true)
  })

  it("lastCommitSubject + packages passthrough", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeRepoFile(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\nbody\n")
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
      await runGather("none", { agenticReview: false, fixAttemptCap: 5, reviewThreshold: 2 }),
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

  it("health absent → healthPresent false, healthContent empty, healthCommitted false", async () => {
    const p = resolveOf(await runGather())
    expect(p.healthPresent).toBe(false)
    expect(p.healthContent).toBe("")
    expect(p.healthCommitted).toBe(false)
  })

  it("present uncommitted HEALTH.md → healthPresent true, healthCommitted false, healthContent matches", async () => {
    writeRepoFile(join(repoDir, ".gtd/HEALTH.md"), "# Health\nfailing tests\n")
    const p = resolveOf(await runGather())
    expect(p.healthPresent).toBe(true)
    expect(p.healthCommitted).toBe(false)
    expect(p.healthContent).toContain("failing tests")
  })

  it("present committed HEALTH.md → healthPresent true, healthCommitted true, healthContent matches", async () => {
    commitFile("gtd: health-check", ".gtd/HEALTH.md", "# Health\ntest output\n")
    const p = resolveOf(await runGather())
    expect(p.healthPresent).toBe(true)
    expect(p.healthCommitted).toBe(true)
    expect(p.healthContent).toContain("test output")
  })

  it("HEALTH.md is excluded from codeDirty (steering file)", async () => {
    writeRepoFile(join(repoDir, ".gtd/HEALTH.md"), "# Health\nfail\n")
    const p = resolveOf(await runGather())
    expect(p.codeDirty).toBe(false)
  })

  it("squashMsgPresent reflects SQUASH_MSG.md presence (no content field on the payload)", async () => {
    expect(resolveOf(await runGather()).squashMsgPresent).toBe(false)
    writeRepoFile(join(repoDir, ".gtd/SQUASH_MSG.md"), "feat: x\n")
    const p = resolveOf(await runGather())
    expect(p.squashMsgPresent).toBe(true)
    expect("squashMsgContent" in p).toBe(false)
  })
})

// ── gatherEvents: headTurnDiff / headTurnIsEmpty ─────────────────────────────

describe("gatherEvents — headTurnDiff / headTurnIsEmpty", { timeout: 30_000 }, () => {
  beforeEach(() => initRepo(false))
  afterEach(cleanup)

  it("HEAD not a turn commit → headTurnDiff empty, headTurnIsEmpty false", async () => {
    commitFile("feat: plain", "a.ts", "//a\n")
    const p = resolveOf(await runGather())
    expect(p.headTurnDiff).toBe("")
    expect(p.headTurnIsEmpty).toBe(false)
  })

  it("HEAD is an empty turn commit → headTurnIsEmpty true, headTurnDiff empty", async () => {
    git("commit", "--allow-empty", "-q", "-m", turnSubject("human", "grilling"))
    const p = resolveOf(await runGather())
    expect(p.headTurnIsEmpty).toBe(true)
    expect(p.headTurnDiff).toBe("")
  })

  it("HEAD is a non-empty turn commit → headTurnIsEmpty false, headTurnDiff carries the change", async () => {
    commitFile(turnSubject("human", "grilling"), "notes.ts", "export const notes = 1\n")
    const p = resolveOf(await runGather())
    expect(p.headTurnIsEmpty).toBe(false)
    expect(p.headTurnDiff).toContain("notes.ts")
  })

  it("headTurnDiff includes TODO.md for a grilling turn — it IS the gate's content", async () => {
    writeRepoFile(join(repoDir, ".gtd/TODO.md"), "# Plan\ngo with tailwind css\n")
    writeRepoFile(join(repoDir, "code.ts"), "export const c = 1\n")
    git("add", "-A")
    git("commit", "-q", "-m", turnSubject("human", "grilling"))
    const p = resolveOf(await runGather())
    expect(p.headTurnDiff).toContain("code.ts")
    expect(p.headTurnDiff).toContain(".gtd/TODO.md")
    expect(p.headTurnDiff).toContain("tailwind")
  })

  it("headTurnDiff still excludes non-grilling steering-file churn (.gtd/) from a grilling turn's diff", async () => {
    writeRepoFile(join(repoDir, ".gtd/TODO.md"), "# Plan\n")
    mkdirSync(join(repoDir, ".gtd", "01-x"), { recursive: true })
    writeRepoFile(join(repoDir, ".gtd", "01-x", "01-task.md"), "# Task\n")
    git("add", "-A")
    git("commit", "-q", "-m", turnSubject("human", "grilling"))
    const p = resolveOf(await runGather())
    expect(p.headTurnDiff).toContain(".gtd/TODO.md")
    expect(p.headTurnDiff).not.toContain(".gtd/01-x")
  })

  it("headTurnDiff excludes TODO.md churn from a non-grilling turn (it's not that gate's content)", async () => {
    writeRepoFile(join(repoDir, ".gtd/TODO.md"), "# stray leftover\n")
    writeRepoFile(join(repoDir, "code.ts"), "export const c = 1\n")
    git("add", "-A")
    git("commit", "-q", "-m", turnSubject("agent", "building"))
    const p = resolveOf(await runGather())
    expect(p.headTurnDiff).toContain("code.ts")
    expect(p.headTurnDiff).not.toContain(".gtd/TODO.md")
  })

  it("headTurnDiff includes ARCHITECTURE.md for an architecting turn — it IS the gate's content", async () => {
    writeRepoFile(join(repoDir, ".gtd/ARCHITECTURE.md"), "# Architecture\ngo with a REST API\n")
    writeRepoFile(join(repoDir, "code.ts"), "export const c = 1\n")
    git("add", "-A")
    git("commit", "-q", "-m", turnSubject("human", "architecting"))
    const p = resolveOf(await runGather())
    expect(p.headTurnDiff).toContain("code.ts")
    expect(p.headTurnDiff).toContain(".gtd/ARCHITECTURE.md")
    expect(p.headTurnDiff).toContain("REST API")
  })
})

// ── gatherEvents: reviewAnchor ────────────────────────────────────────────────

describe("gatherEvents — reviewAnchor", { timeout: 30_000 }, () => {
  afterEach(cleanup)

  it("newest gtd: reviewing <hash> after the last gtd: done sets reviewAnchor", async () => {
    initRepo(false)
    commitFile("feat: work", "work.ts", "export const w = 1\n")
    const anchorHash = git("rev-parse", "HEAD~1") ?? git("rev-parse", "HEAD")
    git("commit", "--allow-empty", "-q", "-m", `gtd: reviewing ${anchorHash}`)
    const p = resolveOf(await runGather())
    expect(p.reviewAnchor).toBe(anchorHash)
  })

  it("no gtd: reviewing commit → reviewAnchor unset", async () => {
    initRepo(false)
    commitFile("feat: work", "work.ts", "export const w = 1\n")
    const p = resolveOf(await runGather())
    expect(p.reviewAnchor).toBeUndefined()
  })

  it("reviewAnchor supplies reviewBase directly, taking precedence over the grilling-turn rule", async () => {
    initRepo(false)
    commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
    git("rm", "-q", ".gtd/TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    commitFile("feat: normal work", "normal.ts", "export const n = 1\n")
    const anchorTarget = git("rev-parse", "HEAD~2")
    git("commit", "--allow-empty", "-q", "-m", `gtd: reviewing ${anchorTarget}`)
    commitFile("feat: after anchor", "after.ts", "export const a = 1\n")

    const p = resolveOf(await runGather())
    expect(p.reviewAnchor).toBe(anchorTarget)
    expect(p.reviewBase).toBe(anchorTarget)
    expect(p.refDiff).toContain("after.ts")
    expect(p.refDiff).toContain("normal.ts")
  })
})

// ── gatherEvents: review base (reviewBase / refDiff) ─────────────────────────

describe("gatherEvents — review base (reviewBase / refDiff)", { timeout: 30_000 }, () => {
  afterEach(cleanup)

  // Rule 1: within-process, first review — base = the first grilling TURN
  // commit of the current task cycle; refDiff spans the whole task since
  // grilling started, minus the workflow files.
  it("within-process first review → base is the first grilling turn commit; refDiff spans whole task", async () => {
    initRepo(false)
    commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
    const grillingHash = git("rev-parse", "HEAD")
    git("rm", "-q", ".gtd/TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    commitFile("feat: add widget", "widget.ts", "export const widget = 1\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(grillingHash)
    expect(p.refDiff).toContain("widget.ts")
    expect(p.refDiff).not.toContain(".gtd/TODO.md")
  })

  it("an agent grilling turn also counts as the cycle's first grilling turn", async () => {
    initRepo(false)
    commitFile(turnSubject("agent", "grilling"), ".gtd/TODO.md", "# Plan\n")
    const grillingHash = git("rev-parse", "HEAD")
    git("rm", "-q", ".gtd/TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    commitFile("feat: add widget", "widget.ts", "export const widget = 1\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(grillingHash)
  })

  it("escape hatch: a cycle starting directly at an architecting turn (no grilling at all) still yields the correct review base", async () => {
    initRepo(false)
    commitFile(turnSubject("human", "architecting"), ".gtd/ARCHITECTURE.md", "# Architecture\n")
    const architectingHash = git("rev-parse", "HEAD")
    git("rm", "-q", ".gtd/ARCHITECTURE.md")
    git("commit", "-q", "-m", "gtd: planning")
    commitFile("feat: add widget", "widget.ts", "export const widget = 1\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(architectingHash)
  })

  // Rule 2: within-process, incremental — `gtd: awaiting review` already
  // present; base = last `gtd: awaiting review` hash; refDiff spans only
  // post-review changes, minus the workflow files.
  it("within-process incremental review → base is the last gtd: awaiting review commit; refDiff spans only post-review changes", async () => {
    initRepo(false)
    commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
    git("rm", "-q", ".gtd/TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    commitFile("feat: first batch", "first.ts", "export const first = 1\n")
    commitFile("gtd: awaiting review", ".gtd/REVIEW.md", "# Review\n")
    const lastAwaiting = git("rev-parse", "HEAD")
    git("rm", "-q", ".gtd/REVIEW.md")
    git("commit", "-q", "-m", turnSubject("agent", "grilling"))
    commitFile("feat: second batch", "second.ts", "export const second = 2\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(lastAwaiting)
    expect(p.refDiff).toContain("second.ts")
    expect(p.refDiff).not.toContain("first.ts")
    expect(p.refDiff).not.toContain(".gtd/REVIEW.md")
  })

  it("within-process feature branch after gtd: done still yields a review base (Rule 1)", async () => {
    initRepo(true)
    git("commit", "--allow-empty", "-q", "-m", "gtd: done")
    commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
    const grilling = git("rev-parse", "HEAD")
    git("rm", "-q", ".gtd/TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    commitFile("feat: work", "work.ts", "export const work = 1\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(grilling)
    expect(p.refDiff).toContain("work.ts")
  })

  it("only workflow-file churn since base → reviewBase/refDiff unset (Idle)", async () => {
    initRepo(false)
    commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
    git("rm", "-q", ".gtd/TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBeUndefined()
    expect(p.refDiff).toBeUndefined()
  })

  it("outside-process feature branch → reviewBase/refDiff unset (Idle)", async () => {
    initRepo(true)
    commitFile("feat: branch work", "branch.ts", "export const branch = 1\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBeUndefined()
    expect(p.refDiff).toBeUndefined()
  })

  it("outside-process default branch → reviewBase/refDiff unset (Idle)", async () => {
    initRepo(false)
    commitFile("feat: trunk work", "trunk.ts", "export const trunk = 1\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBeUndefined()
    expect(p.refDiff).toBeUndefined()
  })

  it("valid base but empty diff to HEAD → reviewBase/refDiff unset (Idle)", async () => {
    initRepo(true)
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBeUndefined()
    expect(p.refDiff).toBeUndefined()
  })
})

// ── gatherEvents: review re-trigger gate ─────────────────────────────────────

describe(
  "gatherEvents — review re-trigger gate (hasCommitsAfterLastDone)",
  { timeout: 30_000 },
  () => {
    afterEach(cleanup)

    it("no gtd: done in history → gate open", async () => {
      initRepo(true)
      commitFile("feat: branch work", "branch.ts", "export const branch = 1\n")
      const p = resolveOf(await runGather())
      expect(p.hasCommitsAfterLastDone).toBe(true)
    })

    it("HEAD is the last gtd: done → gate closed; the unused diff is not computed", async () => {
      initRepo(true)
      commitFile("feat: branch work", "branch.ts", "export const branch = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")
      const p = resolveOf(await runGather())
      expect(p.hasCommitsAfterLastDone).toBe(false)
      expect(p.reviewBase).toBeUndefined()
      expect(p.refDiff).toBeUndefined()
    })

    it("commits after the last gtd: done → gate reopens; outside-process stays Idle", async () => {
      initRepo(true)
      commitFile("feat: first slice", "first.ts", "export const first = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")
      commitFile("feat: second slice", "second.ts", "export const second = 2\n")
      const p = resolveOf(await runGather())
      expect(p.hasCommitsAfterLastDone).toBe(true)
      expect(p.reviewBase).toBeUndefined()
      expect(p.refDiff).toBeUndefined()
    })

    it("empty repo → gate open (degenerate default)", async () => {
      repoDir = mkdtempSync(join(tmpdir(), "gtd-events-"))
      git("init", "-q")
      git("config", "user.name", "Test")
      git("config", "user.email", "test@test.com")
      git("config", "commit.gpgsign", "false")
      const p = resolveOf(await runGather())
      expect(p.hasCommitsAfterLastDone).toBe(true)
    })
  },
)

// ── gatherEvents: squash payload ─────────────────────────────────────────────

describe(
  "gatherEvents — squash payload (squashBase / squashDiff / squashEnabled)",
  { timeout: 30_000 },
  () => {
    afterEach(cleanup)

    it("HEAD gtd: done after full cycle, squash enabled → squashEnabled true, squashBase = parent of the grilling turn, squashDiff non-empty", async () => {
      initRepo(true)
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
      const grillingHash = git("rev-parse", "HEAD")
      const grillingParent = git("rev-parse", "HEAD~1")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: work", "work.ts", "export const work = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather("none", { squash: true }))
      expect(p.squashEnabled).toBe(true)
      expect(p.squashBase).toBe(grillingParent)
      expect(p.squashDiff).toBeDefined()
      expect(p.squashDiff!.length).toBeGreaterThan(0)
      expect(p.squashBase).not.toBe(grillingHash)
    })

    it("interleaved non-gtd commit between gtd commits → squashBase = parent of the grilling turn, diff includes interleaved files", async () => {
      initRepo(true)
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
      const grillingParent = git("rev-parse", "HEAD~1")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: first work", "first.ts", "export const first = 1\n")
      commitFile("chore: interleaved", "chore.ts", "// chore\n")
      commitFile("feat: second work", "second.ts", "export const second = 2\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather("none", { squash: true }))
      expect(p.squashBase).toBe(grillingParent)
      expect(p.squashDiff).toContain("first.ts")
      expect(p.squashDiff).toContain("chore.ts")
      expect(p.squashDiff).toContain("second.ts")
    })

    it("second process on branch → squashBase = parent of second cycle's grilling turn", async () => {
      initRepo(true)
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan 1\n")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: first feature", "first.ts", "export const first = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan 2\n")
      const secondGrillingParent = git("rev-parse", "HEAD~1")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: second feature", "second.ts", "export const second = 2\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather("none", { squash: true }))
      expect(p.squashBase).toBe(secondGrillingParent)
      expect(p.squashDiff).toContain("second.ts")
      expect(p.squashDiff).not.toContain("first.ts")
    })

    it("squash: false in config → squashEnabled false, squashBase unset", async () => {
      initRepo(true)
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: work", "work.ts", "export const work = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather("none", { squash: false }))
      expect(p.squashEnabled).toBe(false)
      expect(p.squashBase).toBeUndefined()
      expect(p.squashDiff).toBeUndefined()
    })

    it("HEAD NOT gtd: done → squashBase unset", async () => {
      initRepo(true)
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: work", "work.ts", "export const work = 1\n")

      const p = resolveOf(await runGather("none", { squash: true }))
      expect(p.squashBase).toBeUndefined()
      expect(p.squashDiff).toBeUndefined()
    })

    it("already-squashed (plain feat: HEAD, no gtd: done) → squashBase unset", async () => {
      initRepo(true)
      commitFile("feat: squashed work", "work.ts", "export const work = 1\n")

      const p = resolveOf(await runGather("none", { squash: true }))
      expect(p.squashBase).toBeUndefined()
      expect(p.squashDiff).toBeUndefined()
    })

    it("gtd: reviewing <hash> anchor nearest HEAD wins over an older grilling turn", async () => {
      initRepo(false)
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: first batch", "first.ts", "export const first = 1\n")
      const anchorTarget = git("rev-parse", "HEAD")
      git("commit", "--allow-empty", "-q", "-m", `gtd: reviewing ${anchorTarget}`)
      commitFile("feat: after anchor", "after.ts", "export const a = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather("none", { squash: true }))
      expect(p.squashBase).toBe(anchorTarget)
      expect(p.squashDiff).toContain("after.ts")
      expect(p.squashDiff).not.toContain("first.ts")
    })

    it("squashMsgPresent flag only — no squashMsgContent field on the payload", async () => {
      initRepo(true)
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: work", "work.ts", "export const work = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")
      writeRepoFile(
        join(repoDir, ".gtd/SQUASH_MSG.md"),
        "feat: add work\n\nDecision: keep it simple.\n",
      )

      const p = resolveOf(await runGather("none", { squash: true }))
      expect(p.squashMsgPresent).toBe(true)
    })

    it("SQUASH_MSG.md absent → squashMsgPresent false", async () => {
      initRepo(true)
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: work", "work.ts", "export const work = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather("none", { squash: true }))
      expect(p.squashMsgPresent).toBe(false)
    })

    it("SQUASH_MSG.md excluded from codeDirty (not treated as a code change)", async () => {
      initRepo(true)
      commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
      git("rm", "-q", ".gtd/TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: work", "work.ts", "export const work = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")
      writeRepoFile(join(repoDir, ".gtd/SQUASH_MSG.md"), "feat: add work\n")

      const p = resolveOf(await runGather("none", { squash: true }))
      expect(p.codeDirty).toBe(false)
    })
  },
)

// ── gatherEvents: COMMIT-stream base folds ───────────────────────────────────

describe("gatherEvents — COMMIT-stream base folds (issue-7)", { timeout: 30_000 }, () => {
  afterEach(cleanup)

  it("trunk regression: gtd: errors commits after gtd: planning fold into testFixCount == 2, not 0", async () => {
    initRepo(false)
    commitFile("gtd: planning", ".gtd/TODO.md", "# Plan\n")
    commitFile("gtd: errors", ".gtd/ERRORS.md", "error 1\n")
    commitFile("gtd: errors", ".gtd/ERRORS.md", "error 2\n")
    const events = await runGather()
    expect(foldCounters(events).testFixCount).toBe(2)
  })

  it("feature-branch control: only post-branch-point gtd: errors commits are included", async () => {
    initRepo(false)
    commitFile("gtd: errors", ".gtd/ERRORS.md", "pre-branch error\n")
    git("checkout", "-q", "-b", "feature")
    commitFile("gtd: planning", ".gtd/TODO.md", "# Plan\n")
    commitFile("gtd: errors", ".gtd/ERRORS.md", "error 1\n")
    commitFile("gtd: errors", ".gtd/ERRORS.md", "error 2\n")
    const events = await runGather()
    expect(foldCounters(events).testFixCount).toBe(2)
  })
})

// ── reviewAgainst (unchanged from v1) ────────────────────────────────────────

describe("reviewAgainst", { timeout: 30_000 }, () => {
  beforeEach(() => initRepo(false))
  afterEach(cleanup)

  it("resolves a review base + diff against an arbitrary ref", async () => {
    const baseHash = git("rev-parse", "HEAD")
    commitFile("feat: work", "work.ts", "export const work = 1\n")
    const result = await runReviewAgainst(baseHash)
    expect(result?.reviewBase).toBe(baseHash)
    expect(result?.refDiff).toContain("work.ts")
  })

  it("returns undefined when the filtered diff against target is empty", async () => {
    const baseHash = git("rev-parse", "HEAD")
    const result = await runReviewAgainst(baseHash)
    expect(result).toBeUndefined()
  })
})

// ── perform: EdgeAction execution ────────────────────────────────────────────

describe("perform — EdgeAction execution", { timeout: 30_000 }, () => {
  beforeEach(() => initRepo(false))
  afterEach(cleanup)

  it("captureTurn: commits gtd(<actor>): <gate> with --allow-empty on a clean tree", async () => {
    const countBefore = git("rev-list", "--count", "HEAD")
    const result = await runPerform({ kind: "captureTurn", actor: "human", gate: "grilling" })
    expect(result.stop).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe(turnSubject("human", "grilling"))
    expect(Number(git("rev-list", "--count", "HEAD"))).toBe(Number(countBefore) + 1)
  })

  it("captureTurn: commits pending changes under gtd(<actor>): <gate>", async () => {
    writeRepoFile(join(repoDir, "sketch.ts"), "export const s = 1\n")
    await runPerform({ kind: "captureTurn", actor: "agent", gate: "building" })
    expect(git("log", "-1", "--format=%s")).toBe(turnSubject("agent", "building"))
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("captureTurn: formats a pending TODO.md before committing", async () => {
    writeRepoFile(join(repoDir, ".gtd/TODO.md"), "#    Plan\nunformatted   \n")
    await runPerform({ kind: "captureTurn", actor: "human", gate: "grilling" })
    const formatted = readFileSync(join(repoDir, ".gtd/TODO.md"), "utf8")
    // Prettier's markdown formatter normalizes the heading/trailing whitespace.
    expect(formatted).not.toBe("#    Plan\nunformatted   \n")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("captureTurn: formats a pending ARCHITECTURE.md before committing", async () => {
    writeRepoFile(join(repoDir, ".gtd/ARCHITECTURE.md"), "#    Arch\nunformatted   \n")
    await runPerform({ kind: "captureTurn", actor: "human", gate: "architecting" })
    const formatted = readFileSync(join(repoDir, ".gtd/ARCHITECTURE.md"), "utf8")
    expect(formatted).not.toBe("#    Arch\nunformatted   \n")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("commitRouting: commits pending changes under the given subject with no removals", async () => {
    writeRepoFile(join(repoDir, "src.ts"), "code\n")
    await runPerform({ kind: "commitRouting", subject: "gtd: grilled" })
    expect(git("log", "-1", "--format=%s")).toBe("gtd: grilled")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("commitRouting removeArchitecture: deletes ARCHITECTURE.md and lands its removal in the commit", async () => {
    commitFile("gtd: grilled", ".gtd/ARCHITECTURE.md", "# Architecture\n")
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeRepoFile(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\n")
    await runPerform({ kind: "commitRouting", subject: "gtd: planning", removeArchitecture: true })
    expect(existsSync(join(repoDir, ".gtd/ARCHITECTURE.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: planning")
    expect(git("show", "--name-status", "--format=", "HEAD")).toContain("D\t.gtd/ARCHITECTURE.md")
  })

  it("commitRouting seedArchitectureFromTodo: seeds ARCHITECTURE.md from TODO.md's content and removes TODO.md", async () => {
    commitFile("gtd(human): grilling", ".gtd/TODO.md", "# Plan\n\ngo with tailwind css\n")
    await runPerform({
      kind: "commitRouting",
      subject: "gtd: architecting",
      seedArchitectureFromTodo: true,
    })
    expect(existsSync(join(repoDir, ".gtd/TODO.md"))).toBe(false)
    const architecture = readFileSync(join(repoDir, ".gtd/ARCHITECTURE.md"), "utf8")
    expect(architecture).toContain("go with tailwind css")
    expect(git("log", "-1", "--format=%s")).toBe("gtd: architecting")
    const nameStatus = git("show", "--name-status", "--format=", "HEAD")
    expect(nameStatus).toContain("D\t.gtd/TODO.md")
    expect(nameStatus).toContain(".gtd/ARCHITECTURE.md")
  })

  it("commitRouting removeReview: deletes REVIEW.md and lands its removal in the commit", async () => {
    commitFile("gtd: awaiting review", ".gtd/REVIEW.md", "# Review\n")
    await runPerform({ kind: "commitRouting", subject: "gtd: done", removeReview: true })
    expect(existsSync(join(repoDir, ".gtd/REVIEW.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: done")
    expect(git("show", "--name-status", "--format=", "HEAD")).toContain("D\t.gtd/REVIEW.md")
  })

  it("commitRouting removeFeedback: deletes FEEDBACK.md and lands its removal in the commit", async () => {
    commitFile("gtd: errors", ".gtd/FEEDBACK.md", "AssertionError: boom\n")
    await runPerform({ kind: "commitRouting", subject: "gtd: tests green", removeFeedback: true })
    expect(existsSync(join(repoDir, ".gtd/FEEDBACK.md"))).toBe(false)
    expect(git("show", "--name-status", "--format=", "HEAD")).toContain("D\t.gtd/FEEDBACK.md")
  })

  it("commitRouting removeHealth: deletes HEALTH.md and lands its removal in the commit", async () => {
    commitFile("gtd: health-check", ".gtd/HEALTH.md", "# Health\ntest output\n")
    writeRepoFile(join(repoDir, "impl.ts"), "export const fixed = 1\n")
    await runPerform({ kind: "commitRouting", subject: "gtd: health-fix", removeHealth: true })
    expect(existsSync(join(repoDir, ".gtd/HEALTH.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: health-fix")
    expect(git("show", "--name-status", "--format=", "HEAD")).toContain("D\t.gtd/HEALTH.md")
  })

  it("runTest green: removes any pending FEEDBACK.md, commits gtd: tests green", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeRepoFile(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\n")
    writeRepoFile(join(repoDir, "impl.ts"), "export const i = 1\n")
    git("add", "-A")
    git("commit", "-q", "-m", turnSubject("agent", "fixing"))
    writeRepoFile(join(repoDir, ".gtd/FEEDBACK.md"), "stale finding\n")
    await runPerform(
      { kind: "runTest", errorCount: 0, capReached: false },
      { exitCode: 0, output: "pass" },
    )
    expect(git("log", "-1", "--format=%s")).toBe("gtd: tests green")
    expect(existsSync(join(repoDir, ".gtd/FEEDBACK.md"))).toBe(false)
    expect(existsSync(join(repoDir, ".gtd/ERRORS.md"))).toBe(false)
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("runTest red under cap: writes FEEDBACK.md and commits gtd: errors", async () => {
    await runPerform(
      { kind: "runTest", errorCount: 1, capReached: false },
      { exitCode: 1, output: "FAIL: boom\n" },
    )
    expect(existsSync(join(repoDir, ".gtd/FEEDBACK.md"))).toBe(true)
    expect(readFileSync(join(repoDir, ".gtd/FEEDBACK.md"), "utf8")).toContain("FAIL: boom")
    expect(existsSync(join(repoDir, ".gtd/ERRORS.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: errors")
  })

  it("runTest red at cap: writes ERRORS.md (not FEEDBACK.md) and commits gtd: errors", async () => {
    await runPerform(
      { kind: "runTest", errorCount: 3, capReached: true },
      { exitCode: 1, output: "FAIL: persistent\n" },
    )
    expect(existsSync(join(repoDir, ".gtd/ERRORS.md"))).toBe(true)
    expect(readFileSync(join(repoDir, ".gtd/ERRORS.md"), "utf8")).toContain("FAIL: persistent")
    expect(existsSync(join(repoDir, ".gtd/FEEDBACK.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: errors")
  })

  it("runTest red under cap, empty output: FEEDBACK.md exists, non-empty, contains sentinel", async () => {
    await runPerform(
      { kind: "runTest", errorCount: 1, capReached: false },
      { exitCode: 1, output: "" },
    )
    expect(existsSync(join(repoDir, ".gtd/FEEDBACK.md"))).toBe(true)
    const feedback = readFileSync(join(repoDir, ".gtd/FEEDBACK.md"), "utf8")
    expect(/\S/.test(feedback)).toBe(true)
    expect(feedback).toContain("failed with exit code 1 and produced no output")
  })

  it("closePackage (empty FEEDBACK): removes FEEDBACK + last package + empty .gtd, commits gtd: package done", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    writeRepoFile(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# Task\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: tests green")
    writeRepoFile(join(repoDir, ".gtd/FEEDBACK.md"), "") // empty, untracked

    await runPerform({ kind: "closePackage" })

    expect(existsSync(join(repoDir, ".gtd/FEEDBACK.md"))).toBe(false)
    expect(existsSync(join(repoDir, ".gtd", "01-foo"))).toBe(false)
    expect(existsSync(join(repoDir, ".gtd"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: package done")
  })

  it("closePackage (force-approve, no FEEDBACK): removes first package, keeps the rest", async () => {
    mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
    mkdirSync(join(repoDir, ".gtd", "02-bar"), { recursive: true })
    writeRepoFile(join(repoDir, ".gtd", "01-foo", "01-task.md"), "# A\n")
    writeRepoFile(join(repoDir, ".gtd", "02-bar", "01-task.md"), "# B\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: tests green")

    await runPerform({ kind: "closePackage" }) // no FEEDBACK.md present — tolerated

    expect(existsSync(join(repoDir, ".gtd", "01-foo"))).toBe(false)
    expect(existsSync(join(repoDir, ".gtd", "02-bar"))).toBe(true)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: package done")
  })

  it("writeSquashTemplate: writes a conventional-commits template and commits gtd: squash template", async () => {
    await runPerform({ kind: "writeSquashTemplate" })
    expect(existsSync(join(repoDir, ".gtd/SQUASH_MSG.md"))).toBe(true)
    const content = readFileSync(join(repoDir, ".gtd/SQUASH_MSG.md"), "utf8")
    expect(content).toContain("replace this file's content")
    expect(git("log", "-1", "--format=%s")).toBe("gtd: squash template")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("squashCommit: reads SQUASH_MSG.md, removes it, soft-resets to squashBase, commits with the file's content as message", async () => {
    commitFile(turnSubject("human", "grilling"), ".gtd/TODO.md", "# Plan\n")
    git("rm", "-q", ".gtd/TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    commitFile("feat: work", "work.ts", "export const work = 1\n")
    git("commit", "--allow-empty", "-q", "-m", "gtd: done")
    const grillingHash = git(
      "log",
      "--format=%H",
      "--reverse",
      "--grep",
      turnSubject("human", "grilling"),
    )
      .split("\n")[0]!
      .trim()
    const squashBase = git("rev-parse", `${grillingHash}~1`).trim()

    writeRepoFile(join(repoDir, ".gtd/SQUASH_MSG.md"), "feat: add work\n\nbody\n")

    await runPerform({ kind: "squashCommit", squashBase })

    expect(existsSync(join(repoDir, ".gtd/SQUASH_MSG.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("feat: add work")
    expect(git("log", "-1", "--format=%b").trim()).toBe("body")
    expect(git("rev-parse", "HEAD~1").trim()).toBe(squashBase)
    expect(git("diff", "--name-only", `${squashBase}..HEAD`)).toContain("work.ts")
    expect(git("diff", "--name-only", `${squashBase}..HEAD`)).not.toContain(".gtd/SQUASH_MSG.md")
  })

  it("perform returns stop: false for all non-health-check actions", async () => {
    writeRepoFile(join(repoDir, "src.ts"), "code\n")
    const result = await runPerform({ kind: "commitRouting", subject: "gtd: grilled" })
    expect(result.stop).toBe(false)
  })

  it("runHealthCheck green, no learning/squash chain queued → no commit, stop: true", async () => {
    const countBefore = git("rev-list", "--count", "HEAD")
    const result = await runPerform(
      { kind: "runHealthCheck", errorCount: 0, capReached: false, chainAfterGreen: false },
      { exitCode: 0, output: "all good" },
    )
    expect(result.stop).toBe(true)
    expect(git("rev-list", "--count", "HEAD")).toBe(countBefore) // no new commit
    expect(existsSync(join(repoDir, ".gtd/HEALTH.md"))).toBe(false)
  })

  it("runHealthCheck green, chainAfterGreen → commits gtd: tests green, stop: false", async () => {
    const countBefore = Number(git("rev-list", "--count", "HEAD"))
    const result = await runPerform(
      { kind: "runHealthCheck", errorCount: 1, capReached: false, chainAfterGreen: true },
      { exitCode: 0, output: "all good" },
    )
    expect(result.stop).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: tests green")
    expect(Number(git("rev-list", "--count", "HEAD"))).toBe(countBefore + 1)
    expect(existsSync(join(repoDir, ".gtd/HEALTH.md"))).toBe(false)
    expect(existsSync(join(repoDir, ".gtd/SQUASH_MSG.md"))).toBe(false)
  })

  it("runHealthCheck red below cap → writes HEALTH.md, commits gtd: health-check, stop: false", async () => {
    const result = await runPerform(
      { kind: "runHealthCheck", errorCount: 1, capReached: false, chainAfterGreen: false },
      { exitCode: 1, output: "FAIL: test boom\n" },
    )
    expect(result.stop).toBe(false)
    expect(existsSync(join(repoDir, ".gtd/HEALTH.md"))).toBe(true)
    expect(readFileSync(join(repoDir, ".gtd/HEALTH.md"), "utf8")).toContain("FAIL: test boom")
    expect(existsSync(join(repoDir, ".gtd/ERRORS.md"))).toBe(false)
    // v2's always-clean invariant: write-and-commit in the same chain.
    expect(git("log", "-1", "--format=%s")).toBe("gtd: health-check")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("runHealthCheck red at cap → writes ERRORS.md, commits gtd: health-check, stop: false", async () => {
    const result = await runPerform(
      { kind: "runHealthCheck", errorCount: 3, capReached: true, chainAfterGreen: false },
      { exitCode: 1, output: "FAIL: persistent\n" },
    )
    expect(result.stop).toBe(false)
    expect(existsSync(join(repoDir, ".gtd/ERRORS.md"))).toBe(true)
    expect(readFileSync(join(repoDir, ".gtd/ERRORS.md"), "utf8")).toContain("FAIL: persistent")
    expect(existsSync(join(repoDir, ".gtd/HEALTH.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: health-check")
  })
})
