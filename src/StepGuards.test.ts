import { describe, expect, it } from "vitest"
import { Effect, Exit, Layer } from "effect"
import { enforceStepGuards, stepGuards, type GuardContext } from "./StepGuards.js"
import { RepoFiles, type RepoFilesOps } from "./RepoFiles.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { gitTestLayer } from "./testing/Layers.js"
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
  stateDir: ".gtd",
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

// ── require-revert ───────────────────────────────────────────────────────────

describe("require-revert guard", () => {
  const reUnwindState = rest("re-unwind", {
    actor: "check",
    script: "revert",
    file: ".gtd/REVIEW.md",
    requireRevert: true,
  })

  // `check`'s declared type is every guard's shared `GuardRequirements`
  // (`RepoFiles | GitService`), even though this guard's own body only ever
  // reaches for `GitService` — an unused `RepoFiles` stub satisfies the type.
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
    // The failed `git apply -R`: the tree is still clean, byte-for-byte the
    // human's hand-edit, indistinguishable from a legitimate note-only round.

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

  it("allows a note-only round when `reviewFile` is repointed to the repo root — exempted by EXACT path, not by a `.gtd/` prefix check", async () => {
    // issue #128's shape: a `reviewFile` outside `.gtd/`. If the exemption
    // regressed to a `.gtd/`-prefix check, `REVIEW.md` would no longer be
    // excluded from `touched`, `scoped` would be non-empty, and this note-only
    // round would be wrongly refused.
    const rootState = rest("re-unwind", {
      actor: "check",
      script: "revert",
      file: "REVIEW.md",
      requireRevert: true,
    })
    const repo = new InMemRepo()
    repo.writeFile("src/thing.ts", "export const thing = 1\n")
    repo.writeFile("REVIEW.md", "- [ ] ./src/thing.ts#1\n")
    repo.commitAllWithPrefix("gtd(check): build.review.reviewing")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("REVIEW.md", "- [x] ./src/thing.ts#1 — looks great\n")
    repo.commitAllWithPrefix("gtd(human): build.review.await-review -> build.review.deciding")
    const rb = repo.resolveRef("HEAD")!

    const exit = await runCheck(
      ctx({
        rest: rootState,
        file: rootState.stateDef.file!,
        template: { ...templateContext, reviewBase: rb, startCommit: base },
      }),
      repo,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toBeUndefined()
  })

  it("allows a review round touching a relocated plumbing directory — today: permanent refusal", async () => {
    // The reported deadlock's shape: `stateDir` relocated to `workflow-state`.
    // A revert script that deliberately keeps `workflow-state/` untouched
    // leaves that path differing from `base` forever; scoping residue by the
    // DECLARED directory (not a literal `.gtd/`) exempts it correctly.
    const repo = new InMemRepo()
    repo.writeFile("src/thing.ts", "export const thing = 1\n")
    repo.writeFile("workflow-state/notes.md", "before\n")
    repo.commitAllWithPrefix("gtd(check): build.review.reviewing")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("workflow-state/notes.md", "after\n")
    repo.commitAllWithPrefix("gtd(human): build.review.await-review -> build.review.deciding")
    const rb = repo.resolveRef("HEAD")!
    // The revert script deliberately keeps `workflow-state/` as-is — it still
    // differs from `base`, but it is plumbing, not residue.

    const exit = await runCheck(
      ctx({
        rest: reUnwindState,
        file: reUnwindState.stateDef.file!,
        template: {
          ...templateContext,
          reviewBase: rb,
          startCommit: base,
          stateDir: "workflow-state",
        },
      }),
      repo,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toBeUndefined()
  })

  it("still refuses on real code residue alongside a relocated plumbing directory, naming ONLY the code path", async () => {
    const repo = new InMemRepo()
    repo.writeFile("src/thing.ts", "export const thing = 1\n")
    repo.writeFile("workflow-state/notes.md", "before\n")
    repo.commitAllWithPrefix("gtd(check): build.review.reviewing")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("workflow-state/notes.md", "after\n")
    repo.writeFile("src/thing.ts", "export const thing = 1\n// TODO: also export doubled\n")
    repo.commitAllWithPrefix("gtd(human): build.review.await-review -> build.review.deciding")
    const rb = repo.resolveRef("HEAD")!
    // The revert script never touches `workflow-state/` (plumbing) but the
    // failed `git apply -R` left `src/thing.ts` (real code) as residue.

    const exit = await runCheck(
      ctx({
        rest: reUnwindState,
        file: reUnwindState.stateDef.file!,
        template: {
          ...templateContext,
          reviewBase: rb,
          startCommit: base,
          stateDir: "workflow-state",
        },
      }),
      repo,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toContain("src/thing.ts")
      expect(exit.value).not.toContain("workflow-state")
      expect(exit.value).toContain(`git checkout ${rb}~1 -- 'src/thing.ts'`)
    }
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

// ── enforceStepGuards runner ─────────────────────────────────────────────────

const repoFilesFrom = (
  files: Record<string, string>,
  committedByRef: Record<string, Record<string, string>> = {},
): RepoFilesOps => ({
  working: (path) => files[path],
  // Keyed by the REF the guard asked for ("HEAD" when it passed none): the
  // review window's saved head is a different ref, and which of the two a
  // guard reads its "before this step" copy at is exactly what the
  // open-window scenarios below pin.
  committed: (path, ref = "HEAD") => Effect.succeed(committedByRef[ref]?.[path]),
})

// `enforceStepGuards`'s declared requirement is the shared `GuardRequirements`
// (`RepoFiles | GitService`) even when the resting state applies no
// `requireRevert` guard — an unused `GitService` layer satisfies the type for
// every test below that never actually reaches for git.
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

  it("no-ops for a squash or no-op decision, even with an unanswered question", async () => {
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: answerState,
        file: answerState.stateDef.file,
        context: templateContext,
        changes: [],
        windowHead: undefined,
        kind: "squash",
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
        windowHead: undefined,
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
        windowHead: undefined,
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
        windowHead: undefined,
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

  it("runs guards in registry order — review-signoff, feedback-progress, answer-completeness, require-revert", () => {
    expect(stepGuards.map((g) => g.name)).toEqual([
      "review-signoff",
      "feedback-progress",
      "answer-completeness",
      "require-revert",
    ])
  })

  // While the review checkout window is open, real HEAD sits at the REVIEW
  // BASE — the review doc the process itself wrote does not exist there. The
  // pre-turn copy every guard compares against therefore has to be read at the
  // window's SAVED HEAD (`Rest.windowHead`), or `original` comes back empty,
  // the sign-off guard sees "the doc differs beyond a checkbox flip", takes the
  // it-is-a-comment branch, and the unticked count is never reached.
  describe("with a review checkout window open", () => {
    const WINDOW_HEAD = "refs/worktree/gtd/review-head"
    const reviewState = rest("await-review", {
      actor: "human",
      message: "review",
      file: "REVIEW.md",
      mode: "review",
      reviewWindow: true,
    })
    // A real review doc: `untickedFiles` only counts file pointers inside a
    // chunk heading, so the header/base/chunk shape is load-bearing here.
    const doc = (a: string, b: string): string =>
      [
        "# Review: abc1234",
        "<!-- base: abc1234def5678901234567890123456789abcd -->",
        "",
        "## Chunk",
        "",
        `- [${a}] ./src/a.ts#1 — first hunk`,
        `- [${b}] ./src/b.ts#1 — second hunk`,
        "",
      ].join("\n")
    const agentsDoc = doc(" ", " ")
    const oneTicked = doc("x", " ")
    const allTicked = doc("x", "x")

    const runGuards = (worktreeDoc: string, windowHead: string | undefined) =>
      Effect.runPromiseExit(
        enforceStepGuards({
          rest: reviewState,
          file: reviewState.stateDef.file,
          context: templateContext,
          changes: [{ path: "REVIEW.md", status: "M" }],
          windowHead,
          kind: "commit",
          attempt: false,
        }).pipe(
          Effect.provide(
            Layer.merge(
              unusedGitService,
              Layer.succeed(
                RepoFiles,
                // The doc exists at the window's saved head and NOT at real HEAD
                // (the review base) — the window's whole shape, in one double.
                repoFilesFrom(
                  { "REVIEW.md": worktreeDoc },
                  { [WINDOW_HEAD]: { "REVIEW.md": agentsDoc } },
                ),
              ),
            ),
          ),
        ),
      )

    it("refuses a tick-only pass that still leaves a box unticked", async () => {
      const exit = await runGuards(oneTicked, WINDOW_HEAD)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(String(exit.cause)).toContain("still unticked and no comment")
      }
    })

    it("allows the same pass once every box is ticked — a sign-off", async () => {
      const exit = await runGuards(allTicked, WINDOW_HEAD)
      expect(Exit.isSuccess(exit)).toBe(true)
    })

    it("reading real HEAD instead is what made the gate inert — the unticked pass would pass", async () => {
      // Pins the regression itself: with no saved head to read, the pre-turn
      // copy is absent, every tick reads as a note, and nothing is enforced.
      const exit = await runGuards(oneTicked, undefined)
      expect(Exit.isSuccess(exit)).toBe(true)
    })
  })

  it("a plumbing-only edit under a relocated stateDir is not a code change — the unticked-box check stays reachable", async () => {
    const reviewState = rest("await-review", {
      actor: "human",
      message: "review",
      file: ".gtd/REVIEW.md",
      mode: "review",
      reviewWindow: true,
    })
    const twoUnticked = "## C\n- [ ] ./a.ts#1\n- [ ] ./b.ts#1\n"
    const exit = await Effect.runPromiseExit(
      enforceStepGuards({
        rest: reviewState,
        file: reviewState.stateDef.file,
        context: { ...templateContext, stateDir: "workflow-state" },
        changes: [{ path: "workflow-state/notes.md", status: "M" }],
        windowHead: undefined,
        kind: "commit",
        attempt: false,
      }).pipe(
        Effect.provide(
          Layer.merge(
            unusedGitService,
            Layer.succeed(
              RepoFiles,
              repoFilesFrom(
                { ".gtd/REVIEW.md": twoUnticked },
                { HEAD: { ".gtd/REVIEW.md": twoUnticked } },
              ),
            ),
          ),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("still unticked and no comment")
    }
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
        windowHead: undefined,
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
