import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  appendCapturedInput,
  gatherEvents,
  getPackages,
  isCheckboxOnlyDiff,
  perform,
  seedTodo,
} from "./Events.js"
import { formatFile } from "./Format.js"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import type { ConfigOperations } from "./Config.js"
import { TestRunner } from "./TestRunner.js"
import { foldCounters } from "./Machine.js"
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
  squash: true,
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

  it("embeds the three-way interpretation rules (code = suggestions incl. tests, comments = positional, steering text = global)", () => {
    const out = seedTodo("+ x\n")
    expect(out).toContain("Interpret the captured diff")
    expect(out).toContain("suggestions, not finished work")
    expect(out).toContain("including test coverage")
    expect(out).toContain("positional feedback")
    expect(out).toContain("global feedback")
    expect(out).toContain("approval noise")
  })
})

// ── appendCapturedInput (pure) ───────────────────────────────────────────────

describe("appendCapturedInput", () => {
  const todo = "# Plan\n\nBuild it.\n"

  it("appends a fenced grilling capture section with the interpretation rules", () => {
    const out = appendCapturedInput(todo, "+ sketch\n")
    expect(out.startsWith("# Plan")).toBe(true)
    expect(out).toContain("## Captured input (grilling)")
    expect(out).toContain("```diff\n+ sketch\n```")
    expect(out).toContain("Interpret the captured diff")
  })

  it("is idempotent — the exact diff body already present returns the TODO unchanged", () => {
    const once = appendCapturedInput(todo, "+ sketch\n")
    expect(appendCapturedInput(once, "+ sketch\n")).toBe(once)
  })

  it("includes the interpretation rules at most once across appends", () => {
    const once = appendCapturedInput(todo, "+ first\n")
    const twice = appendCapturedInput(once, "+ second\n")
    expect(twice).toContain("+ first")
    expect(twice).toContain("+ second")
    expect(twice.split("Interpret the captured diff").length - 1).toBe(1)
  })

  // Accepted behavior (TODO.md plan): the idempotence check matches the raw
  // diff body anywhere in the TODO, so prose that happens to contain the exact
  // same text as a new capture suppresses the append. Pathological in
  // practice; documented rather than special-cased.
  it("skips the append when the TODO already contains the diff body as prose (accepted)", () => {
    const prose = "# Plan\n\nSee this snippet:\n\n+ sketch\n"
    expect(appendCapturedInput(prose, "+ sketch\n")).toBe(prose)
  })
})

// ── capture fencing vs the answers gate ──────────────────────────────────────
// Regression guards for two fixed bugs (see the commit history / TODO.md
// § Bugs found): (1) stripCode's unclosed-fence fallback used a bare `$` under
// the `m` flag, stopping the strip at the first fenced line and leaking deep
// markers to the answers gate; (2) seedTodo/appendCapturedInput used a fixed
// three-backtick fence that the `gtd format` round-trip (prettier) closed
// early on a space-indented ``` diff-context line, spilling the captured diff
// — markers included — out of the fence. The fence is now sized past any
// backtick run (fenceFor) and the strip is anchored to end-of-input.

describe("capture fencing vs the answers gate", { timeout: 30_000 }, () => {
  afterEach(cleanup)

  const runFormat = (path: string): Promise<void> =>
    Effect.runPromise(
      formatFile(path).pipe(Effect.provide(NodeContext.layer)) as Effect.Effect<void, never, never>,
    )

  // A markdown file with its own code fences, captured as a diff: the fence
  // lines arrive prefixed (" " context, "+" added) — never at line start.
  const capturedMarkdownDiff = [
    "diff --git a/doc.md b/doc.md",
    "--- a/doc.md",
    "+++ b/doc.md",
    "@@ -1,3 +1,4 @@",
    " some text",
    " ```",
    "+<!-- user answers here -->",
    " more text",
  ].join("\n")

  it("a raw seed containing a deep fenced marker keeps the gate inert", async () => {
    initRepo(false)
    writeFileSync(join(repoDir, "TODO.md"), seedTodo(capturedMarkdownDiff))
    const p = resolveOf(await runGather())
    expect(p.todoMarkerPresent).toBe(false)
  })

  it("the seed survives a gtd-format round-trip without arming the marker gate", async () => {
    initRepo(false)
    writeFileSync(join(repoDir, "TODO.md"), seedTodo(capturedMarkdownDiff))
    await runFormat(join(repoDir, "TODO.md"))
    const p = resolveOf(await runGather())
    expect(p.todoMarkerPresent).toBe(false)
  })

  it("an appended grilling capture survives a gtd-format round-trip", async () => {
    initRepo(false)
    writeFileSync(join(repoDir, "TODO.md"), appendCapturedInput("# Plan\n", capturedMarkdownDiff))
    await runFormat(join(repoDir, "TODO.md"))
    const p = resolveOf(await runGather())
    expect(p.todoMarkerPresent).toBe(false)
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

  it("todoCommitted: tracked at HEAD → true (even with pending edits)", async () => {
    commitFile("gtd: grilling", "TODO.md", "# Plan\n")
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n\nedited\n")
    const p = resolveOf(await runGather())
    expect(p.todoExists).toBe(true)
    expect(p.todoCommitted).toBe(true)
  })

  it("todoCommitted: freshly written (untracked) TODO.md → false (seed round)", async () => {
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")
    const p = resolveOf(await runGather())
    expect(p.todoExists).toBe(true)
    expect(p.todoCommitted).toBe(false)
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

  // Rule 1: within-process, first review — base = first `gtd: grilling` of the
  // current task cycle; refDiff spans the whole task since grilling started,
  // minus the workflow files (TODO.md's add/delete churn is filtered out).
  it("within-process first review → base is the first gtd: grilling commit; refDiff spans whole task", async () => {
    initRepo(false)
    commitFile("gtd: grilling", "TODO.md", "# Plan\n")
    const grillingHash = git("rev-parse", "HEAD")
    git("rm", "-q", "TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    commitFile("feat: add widget", "widget.ts", "export const widget = 1\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(grillingHash)
    expect(p.refDiff).toContain("widget.ts")
    expect(p.refDiff).not.toContain("TODO.md")
  })

  // Rule 2: within-process, incremental — `gtd: awaiting review` already present;
  // base = last `gtd: awaiting review` hash; refDiff spans only post-review
  // changes, minus the workflow files (REVIEW.md's removal is filtered out).
  it("within-process incremental review → base is the last gtd: awaiting review commit; refDiff spans only post-review changes", async () => {
    initRepo(false)
    commitFile("gtd: grilling", "TODO.md", "# Plan\n")
    git("rm", "-q", "TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    commitFile("feat: first batch", "first.ts", "export const first = 1\n")
    commitFile("gtd: awaiting review", "REVIEW.md", "# Review\n")
    const lastAwaiting = git("rev-parse", "HEAD")
    // Accept Review seeds + Grilling commits REVIEW.md's removal (feedback path).
    git("rm", "-q", "REVIEW.md")
    git("commit", "-q", "-m", "gtd: grilling")
    commitFile("feat: second batch", "second.ts", "export const second = 2\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(lastAwaiting)
    expect(p.refDiff).toContain("second.ts")
    expect(p.refDiff).not.toContain("first.ts")
    expect(p.refDiff).not.toContain("REVIEW.md")
  })

  // Only workflow-file churn since the base → the filtered diff is empty, so
  // reviewBase/refDiff stay unset and the machine settles Idle.
  it("only workflow-file churn since base → reviewBase/refDiff unset (Idle)", async () => {
    initRepo(false)
    commitFile("gtd: grilling", "TODO.md", "# Plan\n")
    git("rm", "-q", "TODO.md")
    git("commit", "-q", "-m", "gtd: planning")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBeUndefined()
    expect(p.refDiff).toBeUndefined()
  })

  // Rule 3: outside a process, on a feature branch — base = merge-base(default, HEAD);
  // refDiff spans the whole branch.
  it("outside-process feature branch → base is the merge-base; refDiff spans whole branch", async () => {
    initRepo(true)
    commitFile("feat: branch work", "branch.ts", "export const branch = 1\n")
    const mergeBase = git("rev-parse", "main")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBe(mergeBase)
    expect(p.refDiff).toContain("branch.ts")
  })

  // Rule 4: outside a process, on the default branch — skip review; reviewBase/refDiff unset.
  it("outside-process default branch → reviewBase/refDiff unset (Idle)", async () => {
    initRepo(false)
    commitFile("feat: trunk work", "trunk.ts", "export const trunk = 1\n")
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBeUndefined()
    expect(p.refDiff).toBeUndefined()
  })

  // Edge: diff to HEAD is empty even with a valid base → reviewBase/refDiff unset (Idle).
  it("valid base but empty diff to HEAD → reviewBase/refDiff unset (Idle)", async () => {
    initRepo(true)
    // No commits added after branching — diff from merge-base to HEAD is empty.
    const p = resolveOf(await runGather())
    expect(p.reviewBase).toBeUndefined()
    expect(p.refDiff).toBeUndefined()
  })
})

// ── gatherEvents: review re-trigger gate ─────────────────────────────────────
// `hasCommitsAfterLastDone` — the loop fix. The gate decides *whether* a review
// fires (machine rule 7); the base rules above decide *what* a fired review
// covers. When the gate is closed the edge skips computing the (potentially
// whole-branch-sized) diff entirely — reviewBase/refDiff stay unset.

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
      // A closed gate forces Idle, so the whole-branch diff is skipped entirely.
      expect(p.reviewBase).toBeUndefined()
      expect(p.refDiff).toBeUndefined()
    })

    it("commits after the last gtd: done → gate reopens; base stays the merge-base (whole branch)", async () => {
      initRepo(true)
      commitFile("feat: first slice", "first.ts", "export const first = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")
      commitFile("feat: second slice", "second.ts", "export const second = 2\n")
      const mergeBase = git("rev-parse", "main")
      const p = resolveOf(await runGather())
      expect(p.hasCommitsAfterLastDone).toBe(true)
      // No "since last done" scoping: the approved first slice is re-covered.
      expect(p.reviewBase).toBe(mergeBase)
      expect(p.refDiff).toContain("first.ts")
      expect(p.refDiff).toContain("second.ts")
    })

    it("empty repo → gate open (degenerate default)", async () => {
      repoDir = mkdtempSync(join(tmpdir(), "gtd-events-"))
      git("init", "-q")
      git("config", "user.name", "Test")
      git("config", "user.email", "test@test.com")
      git("config", "commit.gpgsign", "false")
      savedCwd = process.cwd()
      process.chdir(repoDir)
      const p = resolveOf(await runGather())
      expect(p.hasCommitsAfterLastDone).toBe(true)
    })
  },
)

// ── gatherEvents: squash payload ─────────────────────────────────────────────
// `squashEnabled`, `squashBase`, `squashDiff` — populated only when HEAD is
// `gtd: done` and squash is enabled in config.

describe(
  "gatherEvents — squash payload (squashBase / squashDiff / squashEnabled)",
  { timeout: 30_000 },
  () => {
    afterEach(cleanup)

    // Scenario 1: standard cycle ending at HEAD gtd: done with squash enabled.
    // squashBase = parent of first gtd: grilling; squashDiff non-empty.
    it("HEAD gtd: done after full cycle, squash enabled → squashEnabled true, squashBase = parent of gtd: grilling, squashDiff non-empty", async () => {
      initRepo(true)
      commitFile("gtd: grilling", "TODO.md", "# Plan\n")
      const grillingHash = git("rev-parse", "HEAD")
      const grillingParent = git("rev-parse", "HEAD~1")
      git("rm", "-q", "TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: work", "work.ts", "export const work = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather({ squash: true }))
      expect(p.squashEnabled).toBe(true)
      expect(p.squashBase).toBe(grillingParent)
      expect(p.squashDiff).toBeDefined()
      expect(p.squashDiff!.length).toBeGreaterThan(0)
      // squashBase is parent of grilling, not the grilling commit itself
      expect(p.squashBase).not.toBe(grillingHash)
    })

    // Scenario 2: interleaved non-gtd commit between gtd commits.
    // squashBase = parent of first gtd: grilling; diff includes the interleaved commit's files.
    it("interleaved non-gtd commit between gtd commits → squashBase = parent of gtd: grilling, diff includes interleaved files", async () => {
      initRepo(true)
      commitFile("gtd: grilling", "TODO.md", "# Plan\n")
      const grillingParent = git("rev-parse", "HEAD~1")
      git("rm", "-q", "TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: first work", "first.ts", "export const first = 1\n")
      commitFile("chore: interleaved", "chore.ts", "// chore\n")
      commitFile("feat: second work", "second.ts", "export const second = 2\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather({ squash: true }))
      expect(p.squashBase).toBe(grillingParent)
      expect(p.squashDiff).toContain("first.ts")
      expect(p.squashDiff).toContain("chore.ts")
      expect(p.squashDiff).toContain("second.ts")
    })

    // Scenario 3: second process (prior gtd: done, then second cycle gtd: grilling … gtd: done).
    // squashBase = parent of SECOND cycle's gtd: grilling, not the first.
    it("second process on branch → squashBase = parent of second cycle's gtd: grilling", async () => {
      initRepo(true)
      // First cycle
      commitFile("gtd: grilling", "TODO.md", "# Plan 1\n")
      git("rm", "-q", "TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: first feature", "first.ts", "export const first = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")
      // Second cycle
      commitFile("gtd: grilling", "TODO.md", "# Plan 2\n")
      const secondGrillingParent = git("rev-parse", "HEAD~1")
      git("rm", "-q", "TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: second feature", "second.ts", "export const second = 2\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather({ squash: true }))
      expect(p.squashBase).toBe(secondGrillingParent)
      // second.ts is in the squash diff but first.ts is not (prior cycle)
      expect(p.squashDiff).toContain("second.ts")
      expect(p.squashDiff).not.toContain("first.ts")
    })

    // Scenario 4: squash: false in config → squashEnabled false, squashBase unset.
    it("squash: false in config → squashEnabled false, squashBase unset", async () => {
      initRepo(true)
      commitFile("gtd: grilling", "TODO.md", "# Plan\n")
      git("rm", "-q", "TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: work", "work.ts", "export const work = 1\n")
      git("commit", "--allow-empty", "-q", "-m", "gtd: done")

      const p = resolveOf(await runGather({ squash: false }))
      expect(p.squashEnabled).toBe(false)
      expect(p.squashBase).toBeUndefined()
      expect(p.squashDiff).toBeUndefined()
    })

    // Scenario 5: HEAD NOT gtd: done → squashBase unset.
    it("HEAD NOT gtd: done → squashBase unset", async () => {
      initRepo(true)
      commitFile("gtd: grilling", "TODO.md", "# Plan\n")
      git("rm", "-q", "TODO.md")
      git("commit", "-q", "-m", "gtd: planning")
      commitFile("feat: work", "work.ts", "export const work = 1\n")
      // HEAD is feat: work, not gtd: done

      const p = resolveOf(await runGather({ squash: true }))
      expect(p.squashBase).toBeUndefined()
      expect(p.squashDiff).toBeUndefined()
    })

    // Scenario 6: already-squashed (plain feat: HEAD, no gtd: done) → squashBase unset.
    it("already-squashed (plain feat: HEAD, no gtd: done) → squashBase unset", async () => {
      initRepo(true)
      commitFile("feat: squashed work", "work.ts", "export const work = 1\n")
      // No gtd: done, no gtd: grilling, no workflow

      const p = resolveOf(await runGather({ squash: true }))
      expect(p.squashBase).toBeUndefined()
      expect(p.squashDiff).toBeUndefined()
    })
  },
)

// ── gatherEvents: COMMIT-stream base folds ───────────────────────────────────

describe("gatherEvents — COMMIT-stream base folds (issue-7)", { timeout: 30_000 }, () => {
  afterEach(cleanup)

  it("trunk regression: gtd: errors commits after gtd: planning fold into testFixCount == 2, not 0", async () => {
    initRepo(false)
    commitFile("gtd: planning", "TODO.md", "# Plan\n")
    commitFile("gtd: errors", "ERRORS.md", "error 1\n")
    commitFile("gtd: errors", "ERRORS.md", "error 2\n")
    const events = await runGather()
    expect(foldCounters(events).testFixCount).toBe(2)
  })

  it("feature-branch control: only post-branch-point gtd: errors commits are included", async () => {
    // Set up main with a gtd: errors commit BEFORE the branch point
    initRepo(false)
    commitFile("gtd: errors", "ERRORS.md", "pre-branch error\n")
    // Now branch to feature
    git("checkout", "-q", "-b", "feature")
    // Add workflow commits on feature branch
    commitFile("gtd: planning", "TODO.md", "# Plan\n")
    commitFile("gtd: errors", "ERRORS.md", "error 1\n")
    commitFile("gtd: errors", "ERRORS.md", "error 2\n")
    const events = await runGather()
    // Only the 2 post-branch errors should be counted, not the pre-branch one
    expect(foldCounters(events).testFixCount).toBe(2)
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

  it("seedNewFeature (no baseline commit): commits gtd: new task and captures change in TODO.md", async () => {
    // Inline setup: repo with NO chore: init baseline — HEAD~1 does not exist.
    cleanup()
    repoDir = mkdtempSync(join(tmpdir(), "gtd-events-nobase-"))
    savedCwd = process.cwd()
    execFileSync("git", ["init", "-q"], { cwd: repoDir })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir })
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir })
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repoDir })
    process.chdir(repoDir)

    writeFileSync(join(repoDir, "feature.ts"), "export const raw = 1\n")
    await runPerform({ kind: "seedNewFeature" })
    expect(git("log", "-1", "--format=%s")).toBe("gtd: new task")
    expect(existsSync(join(repoDir, "TODO.md"))).toBe(true)
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("export const raw = 1")
    expect(existsSync(join(repoDir, "feature.ts"))).toBe(false) // reverted to baseline
  })

  it("seedAcceptReview: captures the changeset as gtd: review feedback, reverts it, seeds TODO.md, removes REVIEW.md", async () => {
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

    // The changeset is durably captured (commit-then-revert, like New Feature).
    expect(git("log", "-1", "--format=%s")).toBe("gtd: review feedback")
    expect(existsSync(join(repoDir, "REVIEW.md"))).toBe(false)
    expect(existsSync(join(repoDir, "TODO.md"))).toBe(true)
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("HUMAN FEEDBACK")
    expect(readFileSync(join(repoDir, "code.ts"), "utf8")).toBe("v1\n") // edits discarded
  })

  // The leak regression: a plain `git checkout -- .` discards only tracked
  // edits, so a reviewer-added NEW file used to survive and get committed
  // verbatim by the next grilling round while also being re-planned in TODO.md.
  // Commit-then-revert drops it by construction and preserves it in history.
  it("seedAcceptReview: drops untracked reviewer-added files (captured, not leaked)", async () => {
    writeFileSync(join(repoDir, "code.ts"), "v1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "feat: base")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: awaiting review")
    writeFileSync(join(repoDir, "newfile.ts"), "export const subtract = 1\n")

    await runPerform({ kind: "seedAcceptReview" })

    expect(existsSync(join(repoDir, "newfile.ts"))).toBe(false) // dropped from the tree
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("export const subtract = 1")
    // …and preserved in the capture commit.
    expect(git("show", "HEAD:newfile.ts")).toBe("export const subtract = 1")
  })

  // Regen: HEAD already carries the capture commit (checkout/pull or crash lost
  // the uncommitted seed) — re-derive the seed from the commit, no new commit.
  it("seedAcceptReview (HEAD gtd: review feedback + clean): regenerates the seed without a new commit", async () => {
    writeFileSync(join(repoDir, "code.ts"), "v1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "feat: base")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: awaiting review")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n\nHUMAN FEEDBACK\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: review feedback")
    const countBefore = git("rev-list", "--count", "HEAD")

    await runPerform({ kind: "seedAcceptReview" })

    expect(git("rev-list", "--count", "HEAD")).toBe(countBefore) // no extra commit
    expect(existsSync(join(repoDir, "REVIEW.md"))).toBe(false)
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("HUMAN FEEDBACK")
  })

  it("seedAcceptReview: binary reviewer file is preserved in the capture commit and dropped from the tree", async () => {
    writeFileSync(join(repoDir, "code.ts"), "v1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "feat: base")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: awaiting review")
    writeFileSync(join(repoDir, "logo.bin"), Buffer.from([0, 1, 2, 255, 254, 0, 10]))

    await runPerform({ kind: "seedAcceptReview" })

    expect(existsSync(join(repoDir, "logo.bin"))).toBe(false) // dropped from the tree
    // …but durably preserved in the capture commit.
    expect(() => git("cat-file", "-e", "HEAD:logo.bin")).not.toThrow()
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("Binary files")
  })

  // Accepted limitation (TODO.md plan): the grilling capture has no commit, so
  // binary content survives only as the diff's "Binary files differ" line.
  it("captureGrillingEdits: binary sketch is dropped with only a 'Binary files differ' record", async () => {
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: grilling")
    writeFileSync(join(repoDir, "logo.bin"), Buffer.from([0, 1, 2, 255, 254, 0, 10]))

    await runPerform({ kind: "captureGrillingEdits" })

    expect(existsSync(join(repoDir, "logo.bin"))).toBe(false)
    expect(() => git("cat-file", "-e", "HEAD:logo.bin")).toThrow() // content is gone
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("Binary files")
  })

  it("captureGrillingEdits: .gitignore'd files are neither captured nor deleted", async () => {
    writeFileSync(join(repoDir, ".gitignore"), "secret.env\n")
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: grilling")
    writeFileSync(join(repoDir, "secret.env"), "TOKEN=hunter2\n")
    writeFileSync(join(repoDir, "sketch.ts"), "export const sketch = 1\n")

    await runPerform({ kind: "captureGrillingEdits" })

    expect(existsSync(join(repoDir, "secret.env"))).toBe(true) // untouched
    const todo = readFileSync(join(repoDir, "TODO.md"), "utf8")
    expect(todo).not.toContain("secret.env")
    expect(todo).toContain("export const sketch = 1")
    expect(existsSync(join(repoDir, "sketch.ts"))).toBe(false)
  })

  it("captureGrillingEdits: an untracked nested directory is captured and removed recursively", async () => {
    mkdirSync(join(repoDir, "src"), { recursive: true })
    writeFileSync(join(repoDir, "src", "keep.ts"), "export const keep = 1\n")
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: grilling")
    mkdirSync(join(repoDir, "src", "new", "deep"), { recursive: true })
    writeFileSync(join(repoDir, "src", "new", "deep", "file.ts"), "export const deep = 1\n")

    await runPerform({ kind: "captureGrillingEdits" })

    expect(existsSync(join(repoDir, "src", "new"))).toBe(false) // whole dir gone
    expect(existsSync(join(repoDir, "src", "keep.ts"))).toBe(true)
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("export const deep = 1")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  it("seedAcceptReview: a staged git mv rename is captured and reverted to the original path", async () => {
    writeFileSync(join(repoDir, "code.ts"), "v1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "feat: base")
    writeFileSync(join(repoDir, "REVIEW.md"), "# Review\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: awaiting review")
    git("mv", "code.ts", "renamed.ts")

    await runPerform({ kind: "seedAcceptReview" })

    expect(existsSync(join(repoDir, "code.ts"))).toBe(true) // restored
    expect(readFileSync(join(repoDir, "code.ts"), "utf8")).toBe("v1\n")
    expect(existsSync(join(repoDir, "renamed.ts"))).toBe(false)
  })

  it("captureGrillingEdits: a staged git mv rename is captured and reverted", async () => {
    writeFileSync(join(repoDir, "code.ts"), "v1\n")
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: grilling")
    git("mv", "code.ts", "renamed.ts")

    await runPerform({ kind: "captureGrillingEdits" })

    expect(existsSync(join(repoDir, "code.ts"))).toBe(true)
    expect(existsSync(join(repoDir, "renamed.ts"))).toBe(false)
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("renamed.ts")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  // Regression guard (fixed data-loss bug): diffHead used to feed C-quoted
  // ls-files output back to `git add --intent-to-add`, whose failure was
  // silently swallowed — the capture came back empty and the file was then
  // deleted. Paths now round-trip via `-z` (NUL-separated, unquoted) and git
  // exit codes fail loudly.
  it("captureGrillingEdits: a unicode/space/emoji filename round-trips porcelain quoting", async () => {
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: grilling")
    const wild = "sketch émoji 🚀.ts"
    writeFileSync(join(repoDir, wild), "export const wild = 1\n")

    await runPerform({ kind: "captureGrillingEdits" })

    expect(existsSync(join(repoDir, wild))).toBe(false)
    expect(readFileSync(join(repoDir, "TODO.md"), "utf8")).toContain("export const wild = 1")
    expect(git("status", "--porcelain").trim()).toBe("")
  })

  // Crash window: the previous round appended the capture but the commit was
  // lost (or the user re-created the identical sketch). Re-running the capture
  // must not double-append the section.
  it("captureGrillingEdits: re-capturing an identical diff does not double-append", async () => {
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: grilling")
    writeFileSync(join(repoDir, "sketch.ts"), "export const sketch = 1\n")
    await runPerform({ kind: "captureGrillingEdits" })
    // Same sketch reappears (crash replay / user re-creates it).
    writeFileSync(join(repoDir, "sketch.ts"), "export const sketch = 1\n")
    await runPerform({ kind: "captureGrillingEdits" })

    const todo = readFileSync(join(repoDir, "TODO.md"), "utf8")
    expect(todo.split("export const sketch = 1").length - 1).toBe(1)
    expect(existsSync(join(repoDir, "sketch.ts"))).toBe(false)
  })

  it("captureGrillingEdits: folds code edits into TODO.md, drops them, commits gtd: grilling", async () => {
    writeFileSync(join(repoDir, "code.ts"), "v1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "feat: base")
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n\nBuild it.\n")
    git("add", "-A")
    git("commit", "-q", "-m", "gtd: grilling")
    // User sketches code (tracked edit + untracked file) and refines the plan:
    writeFileSync(join(repoDir, "code.ts"), "v2 sketch\n")
    writeFileSync(join(repoDir, "sketch.ts"), "export const sketch = 1\n")
    writeFileSync(join(repoDir, "TODO.md"), "# Plan\n\nBuild it with sketches.\n")

    await runPerform({ kind: "captureGrillingEdits" })

    expect(git("log", "-1", "--format=%s")).toBe("gtd: grilling")
    expect(git("status", "--porcelain").trim()).toBe("") // one commit, clean tree
    expect(readFileSync(join(repoDir, "code.ts"), "utf8")).toBe("v1\n") // reverted
    expect(existsSync(join(repoDir, "sketch.ts"))).toBe(false) // dropped
    const todo = readFileSync(join(repoDir, "TODO.md"), "utf8")
    expect(todo).toContain("Build it with sketches.") // user's plan edit preserved
    expect(todo).toContain("## Captured input (grilling)")
    expect(todo).toContain("v2 sketch")
    expect(todo).toContain("export const sketch = 1")
    expect(todo).toContain("Interpret the captured diff")
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

  it("runTest red under cap, empty output: FEEDBACK.md exists, non-empty, contains sentinel", async () => {
    writeFileSync(join(repoDir, "impl.ts"), "export const i = 1\n")
    await runPerform(
      { kind: "runTest", errorCount: 1, capReached: false },
      { exitCode: 1, output: "" },
    )
    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(true)
    const feedback = readFileSync(join(repoDir, "FEEDBACK.md"), "utf8")
    expect(/\S/.test(feedback)).toBe(true)
    expect(feedback).toContain("failed with no output")
    expect(existsSync(join(repoDir, "ERRORS.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: errors")
  })

  it("runTest red at cap, empty output: ERRORS.md exists, non-empty, contains sentinel; FEEDBACK.md absent", async () => {
    writeFileSync(join(repoDir, "impl.ts"), "export const i = 1\n")
    await runPerform(
      { kind: "runTest", errorCount: 3, capReached: true },
      { exitCode: 1, output: "" },
    )
    expect(existsSync(join(repoDir, "ERRORS.md"))).toBe(true)
    const errors = readFileSync(join(repoDir, "ERRORS.md"), "utf8")
    expect(/\S/.test(errors)).toBe(true)
    expect(errors).toContain("failed with no output")
    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(false)
    expect(git("log", "-1", "--format=%s")).toBe("gtd: errors")
  })

  it("runTest red under cap, whitespace-only output: FEEDBACK.md non-empty, contains sentinel", async () => {
    writeFileSync(join(repoDir, "impl.ts"), "export const i = 1\n")
    await runPerform(
      { kind: "runTest", errorCount: 1, capReached: false },
      { exitCode: 1, output: "   \n" },
    )
    expect(existsSync(join(repoDir, "FEEDBACK.md"))).toBe(true)
    const feedback = readFileSync(join(repoDir, "FEEDBACK.md"), "utf8")
    expect(/\S/.test(feedback)).toBe(true)
    expect(feedback).toContain("failed with no output")
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
