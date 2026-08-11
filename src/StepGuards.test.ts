import { describe, expect, it } from "vitest"
import { Effect, Exit, Layer } from "effect"
import { enforceStepGuards, stepGuards, type GuardContext } from "./StepGuards.js"
import { RepoFiles, type RepoFilesOps } from "./RepoFiles.js"
import type { ResolvedRest } from "./Edge.js"
import type { PendingChange, StateDef, WorkflowDefinition } from "./PatternMachine.js"
import type { TemplateContext } from "./PatternTemplates.js"

// ── Test fixtures ────────────────────────────────────────────────────────────

const templateContext: TemplateContext = {
  startCommit: "",
  currentCommit: "",
  previousCommit: "",
  state: "",
  actor: "",
  reviewBase: "",
  retainedBase: "",
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

// ── review-signoff ───────────────────────────────────────────────────────────

describe("review-signoff guard", () => {
  const reviewState = rest("await-review", {
    actor: "human",
    prompt: "review",
    file: ".gtd/REVIEW.md",
    mode: "review",
    reviewWindow: true,
  })
  const twoUnticked = "## C\n- [ ] ./a.ts#1\n- [ ] ./b.ts#1\n"
  const allTicked = "## C\n- [x] ./a.ts#1\n- [x] ./b.ts#1\n"

  it("applies only to a review-window state with mode: review", () => {
    expect(guard("review-signoff").appliesTo(reviewState)).toBe(true)
    expect(
      guard("review-signoff").appliesTo(
        rest("await-review", { actor: "human", prompt: "x", reviewWindow: true }),
      ),
    ).toBe(false)
    expect(
      guard("review-signoff").appliesTo(
        rest("drafting", { actor: "human", prompt: "x", mode: "review" }),
      ),
    ).toBe(false)
  })

  it("refuses a deleted review doc", async () => {
    const refusal = await checkOf(
      "review-signoff",
      ctx({ rest: reviewState, fileDeleted: true, file: ".gtd/REVIEW.md" }),
    )
    expect(refusal).toContain("was deleted")
  })

  it("allows a code edit (a comment) even with boxes unticked", async () => {
    const refusal = await checkOf(
      "review-signoff",
      ctx({
        rest: reviewState,
        hasCodeChange: true,
        head: Effect.succeed(twoUnticked),
        worktree: Effect.succeed(twoUnticked),
      }),
    )
    expect(refusal).toBeUndefined()
  })

  it("allows a note — the doc differs beyond a tick — even with a box left unticked", async () => {
    const refusal = await checkOf(
      "review-signoff",
      ctx({
        rest: reviewState,
        head: Effect.succeed(twoUnticked),
        worktree: Effect.succeed("## C\n- [x] ./a.ts#1\n- [ ] ./b.ts#1 — please rename\n"),
      }),
    )
    expect(refusal).toBeUndefined()
  })

  it("allows a clean sign-off: every box ticked, no note, no code", async () => {
    const refusal = await checkOf(
      "review-signoff",
      ctx({
        rest: reviewState,
        head: Effect.succeed(twoUnticked),
        worktree: Effect.succeed(allTicked),
      }),
    )
    expect(refusal).toBeUndefined()
  })

  it("refuses an unfinished review: only tick-flips, a box still unticked, no comment", async () => {
    const refusal = await checkOf(
      "review-signoff",
      ctx({
        rest: reviewState,
        head: Effect.succeed(twoUnticked),
        worktree: Effect.succeed("## C\n- [x] ./a.ts#1\n- [ ] ./b.ts#1\n"),
      }),
    )
    expect(refusal).toContain("1 review item(s) still unticked")
  })

  it("narrows unticked to `./`-prefixed hunk pointers inside `##` chunks (deliberate behavior change)", async () => {
    // An indented note-only `- [ ]` outside any recognized file-pointer shape
    // (no `./` prefix) must NOT block sign-off, unlike the old raw-regex count.
    const refusal = await checkOf(
      "review-signoff",
      ctx({
        rest: reviewState,
        head: Effect.succeed("## C\n- [ ] ./a.ts#1\n"),
        worktree: Effect.succeed("## C\n- [x] ./a.ts#1\n\nNotes:\n- [ ] not a file pointer\n"),
      }),
    )
    expect(refusal).toBeUndefined()
  })
})

// ── feedback-progress ────────────────────────────────────────────────────────

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

// ── answer-completeness ──────────────────────────────────────────────────────

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
    expect(refusal).toContain("Which API?")
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

// ── enforceStepGuards runner ─────────────────────────────────────────────────

const repoFilesFrom = (files: Record<string, string>): RepoFilesOps => ({
  working: (path) => files[path],
  committed: () => Effect.succeed(undefined),
})

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

  it("no-ops for a squash or no-op decision, even with an unanswered question", async () => {
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: answerState,
        file: answerState.stateDef.file,
        context: templateContext,
        changes: [],
        kind: "squash",
        attempt: false,
      }).pipe(
        Effect.provide(
          Layer.succeed(RepoFiles, repoFilesFrom({ ".gtd/REQUIREMENTS.md": unansweredDoc })),
        ),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

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
      }).pipe(Effect.provide(Layer.succeed(RepoFiles, repoFilesFrom({})))),
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
      }).pipe(Effect.provide(Layer.succeed(RepoFiles, repoFilesFrom({})))),
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
          Layer.succeed(RepoFiles, repoFilesFrom({ ".gtd/REQUIREMENTS.md": unansweredDoc })),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).toContain("gtd land:")
    }
  })

  it("runs guards in registry order — review-signoff, feedback-progress, answer-completeness", () => {
    expect(stepGuards.map((g) => g.name)).toEqual([
      "review-signoff",
      "feedback-progress",
      "answer-completeness",
    ])
  })

  it("reads the CURRENT working tree as-is — no in-process formatting happens here", async () => {
    // A step script's own `format:` command (run by an external driver) is
    // never invoked by `enforceStepGuards` — it only samples whatever is on
    // disk right now. An already-answered doc passes with no formatting step.
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
          Layer.succeed(RepoFiles, repoFilesFrom({ ".gtd/REQUIREMENTS.md": answeredDoc })),
        ),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })
})
