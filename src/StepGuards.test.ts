import { describe, expect, it } from "vitest"
import { Effect, Exit, Layer } from "effect"
import { enforceStepGuards, stepGuards, type GuardContext } from "./StepGuards.js"
import { RepoFiles, type RepoFilesOps } from "./RepoFiles.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { gitTestLayer } from "./testing/Layers.js"
import type { ResolvedRest } from "./Edge.js"
import type { PendingChange, StateDef, WorkflowDefinition } from "./PatternMachine.js"
import type { TemplateContext } from "./PatternTemplates.js"

const templateContext: TemplateContext = {
  startCommit: "",
  currentCommit: "",
  previousCommit: "",
  state: "",
  actor: "",
  reviewBase: "",
  processBase: "",
  processCost: 0,
  processCostByModel: [],
  read: () => {
    throw new Error("template context read must not be called in these tests")
  },
  vars: {},
  edges: [],
}

const rest = (
  state: string,
  stateDef: StateDef,
  def?: Partial<WorkflowDefinition>,
): ResolvedRest => ({
  def: { states: { [state]: stateDef }, entries: { default: state, manual: [] }, ...def },
  state,
  stateDef,
  actor: "human",
})

const ctx = (overrides: Partial<GuardContext> & Pick<GuardContext, "rest">): GuardContext => ({
  file: ".gtd/FILE.md",
  changes: [],
  fileDeleted: false,
  hasCodeChange: false,
  template: templateContext,
  head: Effect.succeed(undefined),
  worktree: Effect.succeed(undefined),
  ...overrides,
})

const guard = (name: string) => {
  const found = stepGuards.find((g) => g.name === name)
  if (found === undefined) throw new Error(`no guard named "${name}"`)
  return found
}

const checkOf = async (name: string, context: GuardContext): Promise<string | undefined> =>
  Effect.runPromise(guard(name).check(context) as Effect.Effect<string | undefined, never, never>)

describe("review-doc guard", () => {
  const reviewState = rest("await-review", {
    actor: "human",
    prompt: "review",
    file: ".gtd/REVIEW.md",
    mode: "review",
  })

  it("applies only to a human-actor state with mode: review", () => {
    expect(guard("review-doc").appliesTo(reviewState)).toBe(true)
    expect(
      guard("review-doc").appliesTo(rest("await-review", { actor: "human", prompt: "x" })),
    ).toBe(false)
    expect(
      guard("review-doc").appliesTo(
        rest("deciding", { actor: "check", prompt: "x", mode: "review" }),
      ),
    ).toBe(false)
  })

  it("refuses a deleted review doc", async () => {
    const refusal = await checkOf(
      "review-doc",
      ctx({ rest: reviewState, fileDeleted: true, file: ".gtd/REVIEW.md" }),
    )
    expect(refusal).toContain("was deleted")
  })

  it("allows a sign-off with boxes still unticked — a tick only records that the hunk was read", async () => {
    const refusal = await checkOf(
      "review-doc",
      ctx({
        rest: reviewState,
        head: Effect.succeed("## C\n- [ ] ./a.ts#1\n- [ ] ./b.ts#1\n"),
        worktree: Effect.succeed("## C\n- [ ] ./a.ts#1\n- [ ] ./b.ts#1\n"),
      }),
    )
    expect(refusal).toBeUndefined()
  })
})

describe("feedback-progress guard", () => {
  const feedbackState = rest("feedback-building", {
    actor: "agent",
    prompt: "address feedback",
    file: ".gtd/REVIEW_FEEDBACK.md",
    requireProgress: true,
  })
  const del: PendingChange = { path: ".gtd/REVIEW_FEEDBACK.md", status: "D" }

  it("applies only to a requireProgress state", () => {
    expect(guard("feedback-progress").appliesTo(feedbackState)).toBe(true)
    expect(
      guard("feedback-progress").appliesTo(rest("drafting", { actor: "agent", prompt: "x" })),
    ).toBe(false)
  })

  it("refuses deleting the instructions file with no code change (the original bug)", async () => {
    const refusal = await checkOf(
      "feedback-progress",
      ctx({
        rest: feedbackState,
        fileDeleted: true,
        changes: [del],
        head: Effect.succeed("1. ./a.ts#1 — rename the export\n"),
      }),
    )
    expect(refusal).toContain("without addressing its instructions")
  })

  it("allows deleting the file when a code change accompanies it (real work done)", async () => {
    const refusal = await checkOf(
      "feedback-progress",
      ctx({
        rest: feedbackState,
        fileDeleted: true,
        hasCodeChange: true,
        changes: [del, { path: "src/a.ts", status: "M" }],
        head: Effect.succeed("1. ./a.ts#1 — rename the export\n"),
      }),
    )
    expect(refusal).toBeUndefined()
  })

  it("allows a NOTHING ACTIONABLE sentinel to be deleted with no code change", async () => {
    const refusal = await checkOf(
      "feedback-progress",
      ctx({
        rest: feedbackState,
        fileDeleted: true,
        changes: [del],
        head: Effect.succeed("NOTHING ACTIONABLE — the human left only an approving remark.\n"),
      }),
    )
    expect(refusal).toBeUndefined()
  })

  it("allows a turn that does not delete the instructions file", async () => {
    const refusal = await checkOf(
      "feedback-progress",
      ctx({
        rest: feedbackState,
        fileDeleted: false,
        changes: [{ path: "src/a.ts", status: "M" }],
      }),
    )
    expect(refusal).toBeUndefined()
  })

  it("treats other .gtd/ churn alongside the delete as no code change (still refused)", async () => {
    const refusal = await checkOf(
      "feedback-progress",
      ctx({
        rest: feedbackState,
        fileDeleted: true,
        changes: [del, { path: ".gtd/REVIEW_RAW.md", status: "D" }],
        head: Effect.succeed("1. ./a.ts#1 — rename the export\n"),
      }),
    )
    expect(refusal).toContain("without addressing its instructions")
  })
})

describe("answer-completeness guard", () => {
  const answerState = rest("product-answer", {
    actor: "human",
    message: "answer",
    file: ".gtd/REQUIREMENTS.md",
    mode: "qa",
    answerGate: true,
  })
  const doc = (options: readonly string[]): string =>
    ["Build a thing.", "", "## Open Questions", "", "### Which API?", "", ...options, ""].join("\n")

  it("applies only to an answerGate state with mode: qa", () => {
    expect(guard("answer-completeness").appliesTo(answerState)).toBe(true)
    expect(
      guard("answer-completeness").appliesTo(
        rest("product-answer", { actor: "human", message: "x", answerGate: true }),
      ),
    ).toBe(false)
    expect(
      guard("answer-completeness").appliesTo(
        rest("drafting", { actor: "human", message: "x", mode: "qa" }),
      ),
    ).toBe(false)
  })

  it("allows when there are no open questions (agent surfaced none / accept-all)", async () => {
    const refusal = await checkOf(
      "answer-completeness",
      ctx({ rest: answerState, worktree: Effect.succeed("Build a thing. Plan: do it.\n") }),
    )
    expect(refusal).toBeUndefined()
  })

  it("allows when the whole Open Questions section was deleted", async () => {
    const refusal = await checkOf(
      "answer-completeness",
      ctx({
        rest: answerState,
        worktree: Effect.succeed(
          "Build a thing.\n\n## Answered Questions\n\n### Which API?\n\nUse tRPC.\n",
        ),
      }),
    )
    expect(refusal).toBeUndefined()
  })

  it("refuses when an open question has no ticked option", async () => {
    const refusal = await checkOf(
      "answer-completeness",
      ctx({
        rest: answerState,
        worktree: Effect.succeed(doc(["- [ ] REST", "- [ ] GraphQL", "- [ ] _your answer_"])),
      }),
    )
    expect(refusal).toContain("1 open question(s)")
    expect(refusal).toContain(".gtd/FILE.md:5: Which API?")
  })

  it("allows when every open question has exactly one tick", async () => {
    const refusal = await checkOf(
      "answer-completeness",
      ctx({
        rest: answerState,
        worktree: Effect.succeed(doc(["- [ ] REST", "- [x] GraphQL", "- [ ] _your answer_"])),
      }),
    )
    expect(refusal).toBeUndefined()
  })

  it("refuses a ticked-but-empty free-text slot", async () => {
    const refusal = await checkOf(
      "answer-completeness",
      ctx({
        rest: answerState,
        worktree: Effect.succeed(doc(["- [ ] REST", "- [ ] GraphQL", "- [x] _your answer_"])),
      }),
    )
    expect(refusal).toBeDefined()
  })

  it("allows a ticked free-text slot with text", async () => {
    const refusal = await checkOf(
      "answer-completeness",
      ctx({
        rest: answerState,
        worktree: Effect.succeed(doc(["- [ ] REST", "- [ ] GraphQL", "- [x] use tRPC"])),
      }),
    )
    expect(refusal).toBeUndefined()
  })

  it("refuses when two options are ticked (ambiguous)", async () => {
    const refusal = await checkOf(
      "answer-completeness",
      ctx({
        rest: answerState,
        worktree: Effect.succeed(doc(["- [x] REST", "- [x] GraphQL", "- [ ] _your answer_"])),
      }),
    )
    expect(refusal).toBeDefined()
  })

  it("refuses an open question that has no checkbox options at all", async () => {
    const refusal = await checkOf(
      "answer-completeness",
      ctx({ rest: answerState, worktree: Effect.succeed(doc(["some prose, no boxes"])) }),
    )
    expect(refusal).toBeDefined()
  })
})

describe("require-revert guard", () => {
  const reUnwindState = rest("re-unwind", {
    actor: "check",
    script: "revert",
    file: ".gtd/REVIEW.md",
    requireRevert: true,
  })

  // `check`'s declared type is the shared `GuardRequirements`
  // (`RepoFiles | GitService`) even though its body only reaches for
  // `GitService` — an unused `RepoFiles` stub satisfies the type.
  const unusedRepoFiles = Layer.succeed(RepoFiles, {
    working: () => undefined,
    committed: () => Effect.succeed(undefined),
  } satisfies RepoFilesOps)

  const runCheck = (context: GuardContext, repo: InMemRepo) =>
    Effect.runPromiseExit(
      guard("require-revert")
        .check(context)
        .pipe(Effect.provide(Layer.merge(gitTestLayer(repo), unusedRepoFiles))),
    )

  it("applies only to a requireRevert state", () => {
    expect(guard("require-revert").appliesTo(reUnwindState)).toBe(true)
    expect(
      guard("require-revert").appliesTo(rest("drafting", { actor: "agent", prompt: "write" })),
    ).toBe(false)
  })

  it("refuses when residue remains — a failed apply that reverted nothing", async () => {
    const repo = new InMemRepo()
    repo.writeFile("src/thing.ts", "export const thing = 1\n")
    repo.commitAllWithPrefix("gtd(check): build.review.reviewing")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("src/thing.ts", "export const thing = 1\n// TODO: also export doubled\n")
    repo.commitAllWithPrefix("gtd(human): build.review.await-review -> build.review.deciding")
    const rb = repo.resolveRef("HEAD")!
    // The failed apply leaves the tree clean, byte-for-byte the human's
    // hand-edit — indistinguishable from a legitimate note-only round.

    const exit = await runCheck(
      ctx({
        rest: reUnwindState,
        file: reUnwindState.stateDef.file!,
        template: { ...templateContext, reviewBase: rb, startCommit: base },
      }),
      repo,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toContain("src/thing.ts")
      expect(exit.value).toContain(`git checkout ${rb}~1`)
    }
  })

  it("joins a two-path residue with a comma in the prose but a quoted pathspec in the recovery command — the pathspec quotes every path", async () => {
    const repo = new InMemRepo()
    repo.writeFile("src/a.ts", "export const a = 1\n")
    repo.writeFile("src/b.ts", "export const b = 1\n")
    repo.commitAllWithPrefix("gtd(check): build.review.reviewing")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("src/a.ts", "export const a = 1\n// TODO: a\n")
    repo.writeFile("src/b.ts", "export const b = 1\n// TODO: b\n")
    repo.commitAllWithPrefix("gtd(human): build.review.await-review -> build.review.deciding")
    const rb = repo.resolveRef("HEAD")!
    // Neither failed apply reverted — both paths are still residue.

    const exit = await runCheck(
      ctx({
        rest: reUnwindState,
        file: reUnwindState.stateDef.file!,
        template: { ...templateContext, reviewBase: rb, startCommit: base },
      }),
      repo,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toContain("src/a.ts, src/b.ts")
      expect(exit.value).toContain(`git checkout ${rb}~1 -- 'src/a.ts' 'src/b.ts'`)
    }
  })

  it("quotes residue paths containing whitespace or shell metacharacters in the recovery command", async () => {
    const repo = new InMemRepo()
    repo.writeFile("src/my file.ts", "export const a = 1\n")
    repo.writeFile("src/a;b.ts", "export const b = 1\n")
    repo.commitAllWithPrefix("gtd(check): build.review.reviewing")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("src/my file.ts", "export const a = 1\n// TODO: a\n")
    repo.writeFile("src/a;b.ts", "export const b = 1\n// TODO: b\n")
    repo.commitAllWithPrefix("gtd(human): build.review.await-review -> build.review.deciding")
    const rb = repo.resolveRef("HEAD")!
    // Neither failed apply reverted — both paths are still residue.

    const exit = await runCheck(
      ctx({
        rest: reUnwindState,
        file: reUnwindState.stateDef.file!,
        template: { ...templateContext, reviewBase: rb, startCommit: base },
      }),
      repo,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toContain("src/a;b.ts, src/my file.ts")
      expect(exit.value).toContain(`git checkout ${rb}~1 -- 'src/a;b.ts' 'src/my file.ts'`)
    }
  })

  it("allows after a successful revert — the human's paths match `base`", async () => {
    const repo = new InMemRepo()
    repo.writeFile("src/thing.ts", "export const thing = 1\n")
    repo.commitAllWithPrefix("gtd(check): build.review.reviewing")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("src/thing.ts", "export const thing = 1\n// TODO: also export doubled\n")
    repo.commitAllWithPrefix("gtd(human): build.review.await-review -> build.review.deciding")
    const rb = repo.resolveRef("HEAD")!
    // The script's `git apply -R` (or a hand-revert) actually took.
    repo.writeFile("src/thing.ts", "export const thing = 1\n")

    const exit = await runCheck(
      ctx({
        rest: reUnwindState,
        file: reUnwindState.stateDef.file!,
        template: { ...templateContext, reviewBase: rb, startCommit: base },
      }),
      repo,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toBeUndefined()
  })

  it("allows a note-only round — the human's commit touched only the review file", async () => {
    const repo = new InMemRepo()
    repo.writeFile("src/thing.ts", "export const thing = 1\n")
    repo.writeFile(".gtd/REVIEW.md", "- [ ] ./src/thing.ts#1\n")
    repo.commitAllWithPrefix("gtd(check): build.review.reviewing")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile(".gtd/REVIEW.md", "- [x] ./src/thing.ts#1 — looks great\n")
    repo.commitAllWithPrefix("gtd(human): build.review.await-review -> build.review.deciding")
    const rb = repo.resolveRef("HEAD")!

    const exit = await runCheck(
      ctx({
        rest: reUnwindState,
        file: reUnwindState.stateDef.file!,
        template: { ...templateContext, reviewBase: rb, startCommit: base },
      }),
      repo,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toBeUndefined()
  })

  it("allows when the human's commit touched nothing", async () => {
    const repo = new InMemRepo()
    repo.writeFile("src/thing.ts", "export const thing = 1\n")
    repo.commitAllWithPrefix("gtd(check): build.review.reviewing")
    const base = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(human): build.review.await-review -> build.review.deciding")
    const rb = repo.resolveRef("HEAD")!

    const exit = await runCheck(
      ctx({
        rest: reUnwindState,
        file: reUnwindState.stateDef.file!,
        template: { ...templateContext, reviewBase: rb, startCommit: base },
      }),
      repo,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toBeUndefined()
  })

  it("refuses on an unidentifiable reviewBase (blank, or equal to startCommit)", async () => {
    const repo = new InMemRepo()
    const blank = await runCheck(
      ctx({
        rest: reUnwindState,
        template: { ...templateContext, reviewBase: "", startCommit: "" },
      }),
      repo,
    )
    expect(Exit.isSuccess(blank)).toBe(true)
    if (Exit.isSuccess(blank)) expect(blank.value).toContain("no identifiable review round")

    const noRound = await runCheck(
      ctx({
        rest: reUnwindState,
        template: { ...templateContext, reviewBase: "abc123", startCommit: "abc123" },
      }),
      repo,
    )
    expect(Exit.isSuccess(noRound)).toBe(true)
    if (Exit.isSuccess(noRound)) expect(noRound.value).toContain("no identifiable review round")
  })
})

const repoFilesFrom = (
  files: Record<string, string>,
  committedByRef: Record<string, Record<string, string>> = {},
): RepoFilesOps => ({
  working: (path) => files[path],
  // Keyed by the REF the guard asked for — always "HEAD" in practice, now
  // that a guard's pre-turn read is always the real HEAD.
  committed: (path, ref = "HEAD") => Effect.succeed(committedByRef[ref]?.[path]),
})

// `enforceStepGuards`'s declared requirement is the shared `GuardRequirements`
// even when the resting state applies no `requireRevert` guard — an unused
// `GitService` layer satisfies the type for tests that never reach for git.
const unusedGitService = gitTestLayer(new InMemRepo())

describe("enforceStepGuards", () => {
  const answerState = rest("product-answer", {
    actor: "human",
    message: "answer",
    file: ".gtd/REQUIREMENTS.md",
    mode: "qa",
    answerGate: true,
  })
  const unansweredDoc = [
    "Build a thing.",
    "",
    "## Open Questions",
    "",
    "### Which API?",
    "",
    "- [ ] REST",
    "- [ ] GraphQL",
    "- [ ] _your answer_",
    "",
  ].join("\n")

  it("no-ops when the state declares no `file:`", async () => {
    const noFile = rest("idle", { actor: "human", message: "go" })
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: noFile,
        file: noFile.stateDef.file,
        context: templateContext,
        changes: [],
        kind: "commit",
        attempt: false,
      }).pipe(
        Effect.provide(Layer.merge(unusedGitService, Layer.succeed(RepoFiles, repoFilesFrom({})))),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("no-ops when no guard applies to the resting state", async () => {
    const noGuard = rest("drafting", { actor: "agent", prompt: "write", file: ".gtd/TODO.md" })
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: noGuard,
        file: noGuard.stateDef.file,
        context: templateContext,
        changes: [],
        kind: "commit",
        attempt: false,
      }).pipe(
        Effect.provide(Layer.merge(unusedGitService, Layer.succeed(RepoFiles, repoFilesFrom({})))),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("fails with the `gtd land: ` prefix on a refusal, requiring only RepoFiles", async () => {
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: answerState,
        file: answerState.stateDef.file,
        context: templateContext,
        changes: [],
        kind: "commit",
        attempt: false,
      }).pipe(
        Effect.provide(
          Layer.merge(
            unusedGitService,
            Layer.succeed(RepoFiles, repoFilesFrom({ ".gtd/REQUIREMENTS.md": unansweredDoc })),
          ),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).toContain("gtd land:")
    }
  })

  it("runs guards in registry order — review-doc, feedback-progress, answer-completeness, require-revert", () => {
    expect(stepGuards.map((g) => g.name)).toEqual([
      "review-doc",
      "feedback-progress",
      "answer-completeness",
      "require-revert",
    ])
  })

  // Pins the review-doc guard's `appliesTo` end to end through
  // `enforceStepGuards`: with `reviewWindow` gone, an `await-review`-shaped
  // state (human actor, mode: review, no reviewWindow field at all) must
  // still be selected — an inert `appliesTo` would pass every happy-path
  // assertion above while silently letting this deletion through.
  it("refuses deleting .gtd/REVIEW.md at await-review through enforceStepGuards", async () => {
    const reviewState = rest("await-review", {
      actor: "human",
      message: "review",
      file: ".gtd/REVIEW.md",
      mode: "review",
    })
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: reviewState,
        file: reviewState.stateDef.file,
        context: templateContext,
        changes: [{ path: ".gtd/REVIEW.md", status: "D" }],
        kind: "commit",
        attempt: false,
      }).pipe(
        Effect.provide(
          Layer.merge(
            unusedGitService,
            Layer.succeed(RepoFiles, repoFilesFrom({}, { HEAD: { ".gtd/REVIEW.md": "doc" } })),
          ),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("was deleted")
    }
  })

  // Pins `feedbackProgressGuard`'s `NOTHING ACTIONABLE` read through
  // `enforceStepGuards`'s real wiring: a wrong ref here would read an empty
  // file (or the wrong content) and let every deletion through silently.
  it("allows a NOTHING ACTIONABLE sentinel deletion through enforceStepGuards, reading it at real HEAD", async () => {
    const feedbackState = rest("feedback-building", {
      actor: "agent",
      prompt: "address feedback",
      file: ".gtd/REVIEW_FEEDBACK.md",
      requireProgress: true,
    })
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: feedbackState,
        file: feedbackState.stateDef.file,
        context: templateContext,
        changes: [{ path: ".gtd/REVIEW_FEEDBACK.md", status: "D" }],
        kind: "commit",
        attempt: false,
      }).pipe(
        Effect.provide(
          Layer.merge(
            unusedGitService,
            Layer.succeed(
              RepoFiles,
              repoFilesFrom(
                {},
                {
                  HEAD: {
                    ".gtd/REVIEW_FEEDBACK.md":
                      "NOTHING ACTIONABLE — the human left only an approving remark.\n",
                  },
                },
              ),
            ),
          ),
        ),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("reads the CURRENT working tree as-is — no in-process formatting happens here", async () => {
    // A step script's own `format:` command (run by an external driver) is
    // never invoked by `enforceStepGuards` — it only samples whatever is on
    // disk right now.
    const answeredDoc = [
      "Build a thing.",
      "",
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      "- [x] GraphQL",
      "- [ ] _your answer_",
      "",
    ].join("\n")
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: answerState,
        file: answerState.stateDef.file,
        context: templateContext,
        changes: [],
        kind: "commit",
        attempt: false,
      }).pipe(
        Effect.provide(
          Layer.merge(
            unusedGitService,
            Layer.succeed(RepoFiles, repoFilesFrom({ ".gtd/REQUIREMENTS.md": answeredDoc })),
          ),
        ),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })
})
