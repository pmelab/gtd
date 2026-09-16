import { describe, expect, it } from "vitest"
import { enforceStepGuards } from "./Guards.js"
import { snapshot } from "./snapshot.fixture.js"
import type { StateDef } from "../PatternMachine.js"

describe("enforceStepGuards — review-doc", () => {
  const reviewState: StateDef = { actor: "human", message: "review", mode: "review" }

  it("refuses when the review file was deleted", () => {
    const s = snapshot({
      state: "await-review",
      stateDef: reviewState,
      file: ".gtd/REVIEW.md",
      changes: [{ status: "D", path: ".gtd/REVIEW.md" }],
    })
    expect(enforceStepGuards(s)).toContain("was deleted")
  })

  it("allows an edit that keeps the file", () => {
    const s = snapshot({
      state: "await-review",
      stateDef: reviewState,
      file: ".gtd/REVIEW.md",
      changes: [{ status: "M", path: ".gtd/REVIEW.md" }],
    })
    expect(enforceStepGuards(s)).toBeUndefined()
  })

  it("allows a sign-off with boxes still unticked — a tick only records that the hunk was read", () => {
    const unticked = "## C\n- [ ] ./a.ts#1\n- [ ] ./b.ts#1\n"
    const s = snapshot({
      state: "await-review",
      stateDef: reviewState,
      file: ".gtd/REVIEW.md",
      headFile: unticked,
      worktreeFile: unticked,
      changes: [{ status: "M", path: ".gtd/REVIEW.md" }],
    })
    expect(enforceStepGuards(s)).toBeUndefined()
  })
})

describe("enforceStepGuards — feedback-progress", () => {
  const progressState: StateDef = { actor: "human", message: "fix it", requireProgress: true }

  it("refuses a deleted file with no code change and no sentinel", () => {
    const s = snapshot({
      state: "fix",
      stateDef: progressState,
      file: ".gtd/FEEDBACK.md",
      headFile: "please fix the bug",
      changes: [{ status: "D", path: ".gtd/FEEDBACK.md" }],
    })
    expect(enforceStepGuards(s)).toContain("without addressing its instructions")
  })

  it("allows the NOTHING ACTIONABLE sentinel", () => {
    const s = snapshot({
      state: "fix",
      stateDef: progressState,
      file: ".gtd/FEEDBACK.md",
      headFile: "NOTHING ACTIONABLE\n",
      changes: [{ status: "D", path: ".gtd/FEEDBACK.md" }],
    })
    expect(enforceStepGuards(s)).toBeUndefined()
  })

  it("allows a deletion alongside a real code change", () => {
    const s = snapshot({
      state: "fix",
      stateDef: progressState,
      file: ".gtd/FEEDBACK.md",
      headFile: "please fix the bug",
      changes: [
        { status: "D", path: ".gtd/FEEDBACK.md" },
        { status: "M", path: "src/a.ts" },
      ],
    })
    expect(enforceStepGuards(s)).toBeUndefined()
  })

  it("treats other .gtd/ churn alongside the delete as no code change (still refused)", () => {
    const s = snapshot({
      state: "fix",
      stateDef: progressState,
      file: ".gtd/FEEDBACK.md",
      headFile: "please fix the bug",
      changes: [
        { status: "D", path: ".gtd/FEEDBACK.md" },
        { status: "D", path: ".gtd/REVIEW_RAW.md" },
      ],
    })
    expect(enforceStepGuards(s)).toContain("without addressing its instructions")
  })
})

describe("enforceStepGuards — answer-completeness", () => {
  const qaState: StateDef = { actor: "agent", prompt: "answer", answerGate: true, mode: "qa" }

  it("refuses an unanswered question", () => {
    const s = snapshot({
      state: "await-answers",
      stateDef: qaState,
      file: ".gtd/QUESTIONS.md",
      worktreeFile: "## Open Questions\n\n### Q1\nWhich?\n\n- [ ] A\n- [ ] B\n",
      changes: [{ status: "M", path: ".gtd/QUESTIONS.md" }],
    })
    expect(enforceStepGuards(s)).toContain("open question(s)")
  })

  it("allows every question answered", () => {
    const s = snapshot({
      state: "await-answers",
      stateDef: qaState,
      file: ".gtd/QUESTIONS.md",
      worktreeFile: "## Open Questions\n\n### Q1\nWhich?\n\n- [x] A\n- [ ] B\n",
      changes: [{ status: "M", path: ".gtd/QUESTIONS.md" }],
    })
    expect(enforceStepGuards(s)).toBeUndefined()
  })

  it("reads the CURRENT working tree as-is — no in-process formatting happens here", () => {
    const s = snapshot({
      state: "await-answers",
      stateDef: qaState,
      file: ".gtd/QUESTIONS.md",
      // HEAD still has the question unanswered; only the (unformatted,
      // ragged-whitespace) worktree copy carries the tick — proves the
      // guard samples the worktree file verbatim, not HEAD, and never
      // reformats it first.
      headFile: "## Open Questions\n\n### Q1\nWhich?\n\n- [ ] A\n- [ ] B\n",
      // Trailing whitespace oxfmt would normally strip — the guard must
      // still read this exact worktree content, not a hypothetically
      // reformatted version of it.
      worktreeFile: "## Open Questions\n\n### Q1\nWhich?  \n\n- [x] A\n- [ ] B\n",
      changes: [{ status: "M", path: ".gtd/QUESTIONS.md" }],
    })
    expect(enforceStepGuards(s)).toBeUndefined()
  })
})

describe("enforceStepGuards — require-revert", () => {
  const revertState: StateDef = { actor: "human", script: "echo hi", requireRevert: true }

  it("refuses with no identifiable review round", () => {
    const s = snapshot({
      state: "await-revert",
      stateDef: revertState,
      file: ".gtd/FILE.md",
      reviewBase: "",
      startCommit: "",
    })
    expect(enforceStepGuards(s)).toContain("no identifiable review round")
  })

  it("refuses residue left over from the review round", () => {
    const s = snapshot({
      state: "await-revert",
      stateDef: revertState,
      file: ".gtd/FILE.md",
      reviewBase: "abc",
      startCommit: "def",
      revert: { checked: true, base: "abc~1", residue: ["src/a.ts"] },
    })
    const refusal = enforceStepGuards(s)
    expect(refusal).toContain("src/a.ts still differ from abc~1")
    expect(refusal).toContain("git checkout abc~1 -- 'src/a.ts'")
  })

  it("allows a clean revert (no residue)", () => {
    const s = snapshot({
      state: "await-revert",
      stateDef: revertState,
      file: ".gtd/FILE.md",
      reviewBase: "abc",
      startCommit: "def",
      revert: { checked: true, base: "abc~1", residue: [] },
    })
    expect(enforceStepGuards(s)).toBeUndefined()
  })

  it("joins a two-path residue with a comma in the prose but a quoted pathspec in the recovery command — the pathspec quotes every path", () => {
    const s = snapshot({
      state: "await-revert",
      stateDef: revertState,
      file: ".gtd/FILE.md",
      reviewBase: "abc",
      startCommit: "def",
      revert: { checked: true, base: "abc~1", residue: ["src/a.ts", "src/b.ts"] },
    })
    const refusal = enforceStepGuards(s)
    expect(refusal).toContain("src/a.ts, src/b.ts still differ from abc~1")
    expect(refusal).toContain(
      "Run `git checkout abc~1 -- 'src/a.ts' 'src/b.ts'`, then `gtd land` again.",
    )
  })

  it("quotes residue paths containing whitespace or shell metacharacters in the recovery command", () => {
    const s = snapshot({
      state: "await-revert",
      stateDef: revertState,
      file: ".gtd/FILE.md",
      reviewBase: "abc",
      startCommit: "def",
      revert: { checked: true, base: "abc~1", residue: ["src/my file.ts", "src/it's.ts"] },
    })
    const refusal = enforceStepGuards(s)
    expect(refusal).toContain(
      "Run `git checkout abc~1 -- 'src/my file.ts' 'src/it'\\''s.ts'`, then `gtd land` again.",
    )
  })
})

describe("enforceStepGuards — registry order", () => {
  it("runs guards in registry order — review-doc, feedback-progress, answer-completeness, require-revert", () => {
    const revert = { checked: true, base: "abc~1", residue: ["src/a.ts"] }

    // review-doc, feedback-progress AND require-revert all apply and would
    // all refuse — review-doc (first in the registry) wins.
    const reviewDocWins = snapshot({
      state: "s",
      stateDef: {
        actor: "human",
        message: "x",
        mode: "review",
        requireProgress: true,
        requireRevert: true,
      },
      file: ".gtd/FILE.md",
      headFile: "please fix",
      changes: [{ status: "D", path: ".gtd/FILE.md" }],
      reviewBase: "abc",
      startCommit: "def",
      revert,
    })
    expect(enforceStepGuards(reviewDocWins)).toContain("gtd land: review-doc: ")

    // review-doc no longer applies (mode isn't "review"); feedback-progress
    // and require-revert both apply and would both refuse —
    // feedback-progress wins.
    const feedbackProgressWins = snapshot({
      state: "s",
      stateDef: { actor: "human", message: "x", requireProgress: true, requireRevert: true },
      file: ".gtd/FILE.md",
      headFile: "please fix",
      changes: [{ status: "D", path: ".gtd/FILE.md" }],
      reviewBase: "abc",
      startCommit: "def",
      revert,
    })
    expect(enforceStepGuards(feedbackProgressWins)).toContain("gtd land: feedback-progress: ")

    // feedback-progress, answer-completeness AND require-revert all apply
    // and would all refuse — feedback-progress (earlier in the registry)
    // wins over answer-completeness.
    const feedbackBeforeAnswer = snapshot({
      state: "s",
      stateDef: {
        actor: "agent",
        prompt: "x",
        requireProgress: true,
        answerGate: true,
        mode: "qa",
        requireRevert: true,
      },
      file: ".gtd/FILE.md",
      headFile: "please fix",
      worktreeFile: "## Open Questions\n\n### Q1\nWhich?\n\n- [ ] A\n- [ ] B\n",
      changes: [{ status: "D", path: ".gtd/FILE.md" }],
      reviewBase: "abc",
      startCommit: "def",
      revert,
    })
    expect(enforceStepGuards(feedbackBeforeAnswer)).toContain("gtd land: feedback-progress: ")

    // Only answer-completeness and require-revert apply (requireProgress
    // dropped) and both would refuse — answer-completeness wins.
    const answerCompletenessWins = snapshot({
      state: "s",
      stateDef: { actor: "agent", prompt: "x", answerGate: true, mode: "qa", requireRevert: true },
      file: ".gtd/FILE.md",
      worktreeFile: "## Open Questions\n\n### Q1\nWhich?\n\n- [ ] A\n- [ ] B\n",
      changes: [{ status: "M", path: ".gtd/FILE.md" }],
      reviewBase: "abc",
      startCommit: "def",
      revert,
    })
    expect(enforceStepGuards(answerCompletenessWins)).toContain("gtd land: answer-completeness: ")

    // Only require-revert applies — it's the last resort.
    const requireRevertOnly = snapshot({
      state: "s",
      stateDef: { actor: "human", script: "echo hi", requireRevert: true },
      file: ".gtd/FILE.md",
      changes: [],
      reviewBase: "abc",
      startCommit: "def",
      revert,
    })
    expect(enforceStepGuards(requireRevertOnly)).toContain("gtd land: require-revert: ")
  })
})

describe("enforceStepGuards — no applicable guard / no file", () => {
  it("is a no-op for a state no guard applies to", () => {
    const s = snapshot({
      state: "building",
      stateDef: { actor: "human", script: "echo hi" },
      file: ".gtd/FILE.md",
      changes: [{ status: "D", path: ".gtd/FILE.md" }],
    })
    expect(enforceStepGuards(s)).toBeUndefined()
  })

  it("is a no-op when the resting state declares no file", () => {
    const s = snapshot({
      state: "await-review",
      stateDef: { actor: "human", message: "review", mode: "review" },
      file: undefined,
      changes: [],
    })
    expect(enforceStepGuards(s)).toBeUndefined()
  })
})
