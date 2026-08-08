import { describe, expect, it } from "vitest"
import { Effect, Exit, Layer } from "effect"
import {
  enforceStepGuards,
  stepGuards,
  checkSteeringFile,
  type GuardContext,
} from "./StepGuards.js"
import { RepoFiles, type RepoFilesOps } from "./RepoFiles.js"
import { CommandRunner, type CommandOutcome } from "./CommandRunner.js"
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

// ── steering-file guard + enforceStepGuards runner ──────────────────────────

const noopCommandRunner = Layer.succeed(CommandRunner, {
  bash: (): Effect.Effect<CommandOutcome, Error> =>
    Effect.fail(new Error("unscripted command in this test")),
})

const repoFilesFrom = (files: Record<string, string>): RepoFilesOps => ({
  working: (path) => files[path],
  committed: () => Effect.succeed(undefined),
})

describe("steering-file guard", () => {
  const draftingState = rest("drafting", {
    actor: "agent",
    prompt: "write",
    file: ".gtd/TODO.md",
    mode: "qa",
  })

  it("applies to any state that declares a mode", () => {
    expect(guard("steering-file").appliesTo(draftingState)).toBe(true)
    expect(
      guard("steering-file").appliesTo(rest("drafting", { actor: "agent", prompt: "x" })),
    ).toBe(false)
  })

  it("check reports the built-in validator's findings against post-format bytes", async () => {
    const refusal = await checkOf(
      "steering-file",
      ctx({
        rest: draftingState,
        worktree: Effect.succeed("Plan.\n\n## Open Questions\n\n###\n\nno question text.\n"),
      }),
    )
    expect(refusal).toContain("is not valid")
    expect(refusal).toContain("has no question text")
  })

  it("check allows a valid file", async () => {
    const refusal = await checkOf(
      "steering-file",
      ctx({ rest: draftingState, worktree: Effect.succeed("Just a plan, no questions.\n") }),
    )
    expect(refusal).toBeUndefined()
  })

  it("check no-ops when the file is absent (a deletion)", async () => {
    const refusal = await checkOf(
      "steering-file",
      ctx({ rest: draftingState, worktree: Effect.succeed(undefined) }),
    )
    expect(refusal).toBeUndefined()
  })
})

describe("enforceStepGuards", () => {
  const draftingState = rest("drafting", {
    actor: "agent",
    prompt: "write",
    file: ".gtd/TODO.md",
    mode: "qa",
  })

  it("no-ops for a squash or no-op decision, even with an invalid file", async () => {
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: draftingState,
        context: templateContext,
        changes: [],
        invoker: "agent",
        kind: "squash",
      }).pipe(
        Effect.provide(Layer.succeed(RepoFiles, repoFilesFrom({}))),
        Effect.provide(noopCommandRunner),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("no-ops when the state declares no `file:`", async () => {
    const noFile = rest("idle", { actor: "human", message: "go" })
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: noFile,
        context: templateContext,
        changes: [],
        invoker: "agent",
        kind: "commit",
      }).pipe(
        Effect.provide(Layer.succeed(RepoFiles, repoFilesFrom({}))),
        Effect.provide(noopCommandRunner),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("fails with the `gtd step <invoker>: ` prefix on a refusal", async () => {
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: draftingState,
        context: templateContext,
        changes: [],
        invoker: "agent",
        kind: "commit",
      }).pipe(
        Effect.provide(
          Layer.succeed(
            RepoFiles,
            repoFilesFrom({ ".gtd/TODO.md": "Plan.\n\n## Open Questions\n\n###\n\nno text.\n" }),
          ),
        ),
        Effect.provide(noopCommandRunner),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).toContain("gtd step agent:")
    }
  })

  it("runs guards in registry order — steering-file before review-signoff", () => {
    expect(stepGuards.map((g) => g.name)).toEqual([
      "steering-file",
      "review-signoff",
      "feedback-progress",
      "answer-completeness",
    ])
  })

  it("write-before-read: a scripted format rewrite is visible to every guard's check", async () => {
    const reviewState = rest("await-review", {
      actor: "human",
      prompt: "review",
      file: ".gtd/REVIEW.md",
      mode: "review",
      reviewWindow: true,
    })
    const header = "# Review: abc1234\n<!-- base: abc1234def5678901234567890123456789abcd -->\n\n"
    const unticked = `${header}## C\n- [ ] ./a.ts#1\n`
    const ticked = `${header}## C\n- [x] ./a.ts#1\n`
    const files: Record<string, string> = { ".gtd/REVIEW.md": unticked }
    const scriptedRunner = Layer.succeed(CommandRunner, {
      bash: (command: string): Effect.Effect<CommandOutcome, Error> => {
        if (command.includes("normalize-review")) {
          files[".gtd/REVIEW.md"] = ticked
          return Effect.succeed({ status: 0, output: "" })
        }
        return Effect.fail(new Error(`unscripted command "${command}"`))
      },
    })
    const def: WorkflowDefinition = {
      states: { "await-review": reviewState.stateDef },
      entries: { default: "await-review", manual: [] },
      modes: { review: { format: "normalize-review <%= it.file %>" } },
    }
    const withFormat = { ...reviewState, def }
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: withFormat,
        context: templateContext,
        changes: [],
        invoker: "human",
        kind: "commit",
      }).pipe(
        Effect.provide(
          Layer.succeed(RepoFiles, {
            working: (path: string) => files[path],
            committed: () => Effect.succeed(unticked),
          }),
        ),
        Effect.provide(scriptedRunner),
      ),
    )
    // The format command flips the box to ticked BEFORE review-signoff samples
    // the worktree, so this must succeed (no unticked items survive).
    expect(Exit.isSuccess(exit)).toBe(true)
  })
})

describe("checkSteeringFile", () => {
  const draftingState = rest("drafting", {
    actor: "agent",
    prompt: "write",
    file: ".gtd/TODO.md",
    mode: "qa",
  })

  it("reports present: false when the state declares no file:/mode:", async () => {
    const result = await Effect.runPromise(
      checkSteeringFile(rest("idle", { actor: "human", message: "go" }), templateContext).pipe(
        Effect.provide(Layer.succeed(RepoFiles, repoFilesFrom({}))),
        Effect.provide(noopCommandRunner),
      ),
    )
    expect(result).toEqual({ file: undefined, present: false, errors: [] })
  })

  it("reports present: false when the file is absent", async () => {
    const result = await Effect.runPromise(
      checkSteeringFile(draftingState, templateContext).pipe(
        Effect.provide(Layer.succeed(RepoFiles, repoFilesFrom({}))),
        Effect.provide(noopCommandRunner),
      ),
    )
    expect(result).toEqual({ file: ".gtd/TODO.md", present: false, errors: [] })
  })

  it("formats then validates a present file", async () => {
    const result = await Effect.runPromise(
      checkSteeringFile(draftingState, templateContext).pipe(
        Effect.provide(
          Layer.succeed(RepoFiles, repoFilesFrom({ ".gtd/TODO.md": "Just a plan.\n" })),
        ),
        Effect.provide(noopCommandRunner),
      ),
    )
    expect(result).toEqual({ file: ".gtd/TODO.md", present: true, errors: [] })
  })
})
