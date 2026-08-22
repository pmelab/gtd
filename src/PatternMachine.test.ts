import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  contentKindOf,
  contentOf,
  entryBaseTemplateOf,
  enterableStates,
  initialStateOf,
  inScope,
  isCommitState,
  isReviewBaseState,
  isReviewWindowState,
  matchesPattern,
  memoryScopeAt,
  parsePattern,
  parseStateSubject,
  resolveState,
  stateSubject,
  step,
  validateDefinition,
  wouldAttempt,
  type PendingChange,
  type StateDef,
  type StateMode,
  type StateName,
  type StepDecision,
  type WorkflowDefinition,
  type WorkflowEntries,
} from "./PatternMachine.js"

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Wraps a bare `states` map with `entries` — a one-line-per-fixture conversion from the old per-state `initial`/`reviewEntry`/`fixEntry` flags. */
const def = (
  states: WorkflowDefinition["states"],
  entries: StateName | WorkflowEntries,
): WorkflowDefinition => ({
  states,
  entries: typeof entries === "string" ? { default: entries, manual: [] } : entries,
})

/** A minimal, valid three-state loop: idle → working → idle (commit). */
const simpleWorkflow: WorkflowDefinition = def(
  {
    idle: {
      actor: "human",
      message: "waiting",
      on: [
        ["A TODO.md", "working"],
        ["* *", "working"],
      ],
    },
    working: {
      actor: "agent",
      prompt: "do the thing",
      on: [
        ["A DONE.md", "done"],
        ["C", "idle"],
      ],
    },
    done: {
      commit: "chore: <%= it.state %>",
    },
  },
  "idle",
)

/** A check/fix loop exercising retry: checking ⇄ fixing, capped, redirecting to escalate. */
const retryWorkflow: WorkflowDefinition = def(
  {
    start: {
      actor: "human",
      message: "go",
      on: [["* *", "checking"]],
    },
    checking: {
      actor: "check",
      script: "npm test",
      retry: { max: 2, otherwise: "escalate" },
      on: [
        ["A FEEDBACK.md", "fixing"],
        ["C", "done"],
      ],
    },
    fixing: {
      actor: "agent",
      prompt: "fix it",
      on: [["* *", "checking"]],
    },
    escalate: {
      actor: "human",
      message: "stuck",
      on: [["* *", "done"]],
    },
    done: {
      commit: "chore: done",
    },
  },
  "start",
)

/**
 * A check/fix/review loop capping the FIXER rather than the checker — the
 * shape the bundled template actually uses, and the only shape in which an
 * out-of-loop reset is reachable: `checking` routes red to `fixing` and
 * green to `reviewing`; `fixing` carries a retry cap and routes back to
 * `checking`; `reviewing` also routes back to `checking`. `fixing`'s only
 * source is `checking` — `reviewing` and `escalate` are not sources of
 * `fixing`, so either one interleaved in the trace resets `fixing`'s count.
 */
const fixerRetryWorkflow: WorkflowDefinition = def(
  {
    checking: {
      actor: "check",
      script: "npm test",
      on: [
        ["A FEEDBACK.md", "fixing"],
        ["C", "reviewing"],
      ],
    },
    fixing: {
      actor: "agent",
      prompt: "fix it",
      retry: { max: 2, otherwise: "escalate" },
      on: [["* *", "checking"]],
    },
    reviewing: {
      actor: "human",
      message: "review",
      on: [["* *", "checking"]],
    },
    escalate: {
      actor: "human",
      message: "stuck",
      on: [["* *", "checking"]],
    },
  },
  "checking",
)

const change = (status: PendingChange["status"], path: string): PendingChange => ({
  status,
  path,
})

// ── contentKindOf / isCommitState ────────────────────────────────────────────

describe("contentKindOf", () => {
  it("reports the one set content key", () => {
    expect(contentKindOf({ script: "x" })).toBe("script")
    expect(contentKindOf({ prompt: "x" })).toBe("prompt")
    expect(contentKindOf({ message: "x" })).toBe("message")
    expect(contentKindOf({ commit: "x" })).toBe("commit")
  })

  it("is undefined when no content key is set", () => {
    expect(contentKindOf({})).toBeUndefined()
  })
})

describe("contentOf", () => {
  it("returns the raw content string for script/prompt/message", () => {
    expect(contentOf({ script: "run tests" })).toBe("run tests")
    expect(contentOf({ prompt: "do the thing" })).toBe("do the thing")
    expect(contentOf({ message: "waiting" })).toBe("waiting")
  })

  it("is undefined for a commit state", () => {
    expect(contentOf({ commit: "chore: done" })).toBeUndefined()
  })

  it("is undefined when no content key is set", () => {
    expect(contentOf({})).toBeUndefined()
  })
})

describe("isCommitState", () => {
  it("is true only when `commit` is set", () => {
    expect(isCommitState({ commit: "x" })).toBe(true)
    expect(isCommitState({ prompt: "x" })).toBe(false)
    expect(isCommitState({})).toBe(false)
  })
})

describe("isReviewWindowState / isReviewBaseState", () => {
  const workflow: WorkflowDefinition = def(
    {
      idle: {
        actor: "human",
        message: "x",
        reviewBase: true,
        on: [["* *", "gate"]],
      },
      gate: { actor: "human", message: "review", reviewWindow: true, on: [["C", "idle"]] },
      plain: { actor: "agent", prompt: "x", on: [["* *", "idle"]] },
    },
    "idle",
  )

  it("reports the reviewWindow flag by state name", () => {
    expect(isReviewWindowState(workflow, "gate")).toBe(true)
    expect(isReviewWindowState(workflow, "plain")).toBe(false)
    expect(isReviewWindowState(workflow, "idle")).toBe(false)
  })

  it("reports the reviewBase flag by state name", () => {
    expect(isReviewBaseState(workflow, "idle")).toBe(true)
    expect(isReviewBaseState(workflow, "gate")).toBe(false)
  })

  it("is false for an unknown state name", () => {
    expect(isReviewWindowState(workflow, "ghost")).toBe(false)
    expect(isReviewBaseState(workflow, "ghost")).toBe(false)
  })
})

describe("enterableStates", () => {
  it("lists every non-commit state, sorted, excluding commit states", () => {
    const workflow: WorkflowDefinition = def(
      {
        zebra: { actor: "human", message: "x", on: [["* *", "apple"]] },
        apple: { actor: "human", message: "y", on: [["* *", "done"]] },
        done: { commit: "chore: done" },
      },
      "zebra",
    )
    expect(enterableStates(workflow)).toEqual(["apple", "zebra"])
  })
})

describe("isReviewBaseState — pinning the string/template form as NOT a window anchor", () => {
  it("is false when `reviewBase` is a string, even though it is set", () => {
    const workflow: WorkflowDefinition = def(
      {
        idle: { actor: "human", message: "x", reviewBase: "main", on: [["* *", "idle"]] },
      },
      "idle",
    )
    expect(isReviewBaseState(workflow, "idle")).toBe(false)
  })
})

describe("entryBaseTemplateOf", () => {
  it("returns the template string when `reviewBase` is a string", () => {
    const workflow: WorkflowDefinition = def(
      {
        idle: { actor: "human", message: "x", reviewBase: "main", on: [["* *", "idle"]] },
      },
      "idle",
    )
    expect(entryBaseTemplateOf(workflow, "idle")).toBe("main")
  })

  it("is undefined when `reviewBase` is `true`", () => {
    const workflow: WorkflowDefinition = def(
      {
        idle: { actor: "human", message: "x", reviewBase: true, on: [["* *", "idle"]] },
      },
      "idle",
    )
    expect(entryBaseTemplateOf(workflow, "idle")).toBeUndefined()
  })

  it("is undefined when `reviewBase` is absent", () => {
    const workflow: WorkflowDefinition = def(
      { idle: { actor: "human", message: "x", on: [["* *", "idle"]] } },
      "idle",
    )
    expect(entryBaseTemplateOf(workflow, "idle")).toBeUndefined()
  })

  it("is undefined for an unknown state name", () => {
    const workflow: WorkflowDefinition = def(
      { idle: { actor: "human", message: "x", on: [["* *", "idle"]] } },
      "idle",
    )
    expect(entryBaseTemplateOf(workflow, "ghost")).toBeUndefined()
  })
})

// ── Commit-subject grammar ────────────────────────────────────────────────────

describe("stateSubject / parseStateSubject round trip", () => {
  it("round-trips actor/state pairs (no source)", () => {
    expect(parseStateSubject(stateSubject("human", "grilling"))).toEqual({
      actor: "human",
      state: "grilling",
    })
    expect(parseStateSubject(stateSubject("agent", "await-review"))).toEqual({
      actor: "agent",
      state: "await-review",
    })
  })

  it("renders and round-trips a <from> → <to> transition, resolving to <to>", () => {
    const subject = stateSubject("builder", "checking", "building")
    expect(subject).toBe("gtd(builder): building → checking")
    expect(parseStateSubject(subject)).toEqual({
      actor: "builder",
      state: "checking",
      from: "building",
    })
  })

  it("collapses a self-loop (from === to) to the bare form", () => {
    expect(stateSubject("builder", "building", "building")).toBe("gtd(builder): building")
  })

  it("still reads legacy bare `gtd(<actor>): <state>` subjects as the entered state", () => {
    expect(parseStateSubject("gtd(agent): await-review")).toEqual({
      actor: "agent",
      state: "await-review",
    })
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseStateSubject("  gtd(human): building → grilling  \n")).toEqual({
      actor: "human",
      state: "grilling",
      from: "building",
    })
  })

  const malformed = [
    "chore: init",
    "feat: shipped",
    "",
    "gtd human: grilling",
    "gtd(): grilling",
    "gtd(human):",
    "gtd(human)grilling",
    "gtd: grilling",
  ]

  it.each(malformed)("treats %j as unparseable", (subject) => {
    expect(parseStateSubject(subject)).toBeUndefined()
  })
})

// ── Resolve ──────────────────────────────────────────────────────────────────

describe("resolveState", () => {
  it("resolves a matching turn subject to its named state", () => {
    expect(resolveState(simpleWorkflow, "gtd(agent): working")).toBe("working")
    expect(resolveState(simpleWorkflow, "gtd(human): idle")).toBe("idle")
  })

  it("falls back to the initial state for a non-gtd subject", () => {
    expect(resolveState(simpleWorkflow, "feat: shipped")).toBe(initialStateOf(simpleWorkflow))
  })

  it("falls back to the initial state for a malformed subject", () => {
    expect(resolveState(simpleWorkflow, "gtd(human) working")).toBe(initialStateOf(simpleWorkflow))
  })

  it("falls back to the initial state for an undeclared state name", () => {
    expect(resolveState(simpleWorkflow, "gtd(agent): nonexistent")).toBe(
      initialStateOf(simpleWorkflow),
    )
  })

  it("resolves by state name alone — the subject's actor need NOT match the state's own declared actor", () => {
    // "working" is declared with actor "agent", but a subject naming "human"
    // (e.g. a human handing off into an agent state) still resolves to
    // "working" — resolution reads the state name only (decision 2).
    expect(resolveState(simpleWorkflow, "gtd(human): working")).toBe("working")
  })

  it("falls back to the initial state for an actor outside the workflow's closed-world vocabulary", () => {
    expect(resolveState(simpleWorkflow, "gtd(nobody): working")).toBe(
      initialStateOf(simpleWorkflow),
    )
  })

  it("never resolves AT a commit state, even when a subject names one with a recognized actor", () => {
    // "done" is a commit state and carries no actor of its own, but a
    // hand-authored subject can still name a recognized actor here — excluded
    // explicitly (`isCommitState`), not via an actor-mismatch trick.
    expect(resolveState(simpleWorkflow, "gtd(agent): done")).toBe(initialStateOf(simpleWorkflow))
    expect(resolveState(simpleWorkflow, "gtd(human): done")).toBe(initialStateOf(simpleWorkflow))
    expect(resolveState(simpleWorkflow, "gtd(nobody): done")).toBe(initialStateOf(simpleWorkflow))
  })

  it("is total: an arbitrary garbage subject always resolves to a defined state", () => {
    fc.assert(
      fc.property(fc.string(), (garbage) => {
        const resolved = resolveState(simpleWorkflow, garbage)
        expect(Object.keys(simpleWorkflow.states)).toContain(resolved)
      }),
      { numRuns: 500 },
    )
  })
})

// ── Pattern parsing ───────────────────────────────────────────────────────────

describe("parsePattern", () => {
  it("parses the bare clean token", () => {
    expect(parsePattern("C")).toEqual({ kind: "clean" })
  })

  it.each([
    ["A TODO.md", "A", "TODO.md"],
    ["M src/x.ts", "M", "src/x.ts"],
    ["D FEEDBACK.md", "D", "FEEDBACK.md"],
    ["* *", "*", "*"],
  ] as const)("parses %j as status %j / glob %j", (raw, status, glob) => {
    expect(parsePattern(raw)).toEqual({ kind: "diff", status, glob })
  })

  it("tolerates extra whitespace between status and glob, and around the whole pattern", () => {
    expect(parsePattern("  A   TODO.md  ")).toEqual({ kind: "diff", status: "A", glob: "TODO.md" })
  })

  it("preserves a glob containing further spaces (only the first space separates status/glob)", () => {
    expect(parsePattern("A my file.md")).toEqual({
      kind: "diff",
      status: "A",
      glob: "my file.md",
    })
  })

  it.each(["c", "X TODO.md", "A", "A ", "AA TODO.md", "", "   "])("rejects %j", (raw) => {
    expect(parsePattern(raw)).toBeUndefined()
  })
})

// ── Glob matching semantics ───────────────────────────────────────────────────

describe("matchesPattern — glob semantics", () => {
  const p = (raw: string) => {
    const parsed = parsePattern(raw)
    if (parsed === undefined) throw new Error(`bad fixture pattern: ${raw}`)
    return parsed
  }

  it("clean pattern fires only on an empty change list", () => {
    expect(matchesPattern(p("C"), [])).toBe(true)
    expect(matchesPattern(p("C"), [change("A", "x")])).toBe(false)
  })

  it("single-segment `*` matches a root-level path but not a nested one", () => {
    expect(matchesPattern(p("* *"), [change("A", "TODO.md")])).toBe(true)
    expect(matchesPattern(p("* *"), [change("A", ".gtd/FEEDBACK.md")])).toBe(false)
  })

  it("`**` matches both root-level and nested paths (the true any-depth catch-all)", () => {
    expect(matchesPattern(p("* **"), [change("A", "TODO.md")])).toBe(true)
    expect(matchesPattern(p("* **"), [change("A", ".gtd/FEEDBACK.md")])).toBe(true)
    expect(matchesPattern(p("* **"), [change("M", "a/b/c/d.ts")])).toBe(true)
  })

  it("matches dotfiles and dot-directories the same as any other segment (no dotglob exclusion)", () => {
    expect(matchesPattern(p("* *"), [change("A", ".gitignore")])).toBe(true)
    expect(matchesPattern(p("* **"), [change("A", ".gtd/FEEDBACK.md")])).toBe(true)
  })

  it("`src/*.ts` matches directly under src/ but not further nested", () => {
    const pattern = p("M src/*.ts")
    expect(matchesPattern(pattern, [change("M", "src/x.ts")])).toBe(true)
    expect(matchesPattern(pattern, [change("M", "src/sub/x.ts")])).toBe(false)
    expect(matchesPattern(pattern, [change("M", "other/x.ts")])).toBe(false)
  })

  it("`src/**/*.ts` matches zero or more intermediate directories", () => {
    const pattern = p("M src/**/*.ts")
    expect(matchesPattern(pattern, [change("M", "src/x.ts")])).toBe(true)
    expect(matchesPattern(pattern, [change("M", "src/sub/x.ts")])).toBe(true)
    expect(matchesPattern(pattern, [change("M", "src/a/b/c/x.ts")])).toBe(true)
    expect(matchesPattern(pattern, [change("M", "other/x.ts")])).toBe(false)
    expect(matchesPattern(pattern, [change("M", "src/x.js")])).toBe(false)
  })

  it("status must match too (A/M/D distinguish; `*` matches every status)", () => {
    const added = p("A FEEDBACK.md")
    expect(matchesPattern(added, [change("M", "FEEDBACK.md")])).toBe(false)
    expect(matchesPattern(added, [change("A", "FEEDBACK.md")])).toBe(true)
    const any = p("* FEEDBACK.md")
    expect(matchesPattern(any, [change("D", "FEEDBACK.md")])).toBe(true)
  })

  it("contains-match: fires if ANY pending change matches, regardless of the others", () => {
    const pattern = p("A FEEDBACK.md")
    expect(matchesPattern(pattern, [change("M", "unrelated.md"), change("A", "FEEDBACK.md")])).toBe(
      true,
    )
  })

  it("regex-special characters in a path are matched literally, not as regex syntax", () => {
    // A literal glob path with a "+" and "." must match only that exact segment text.
    expect(matchesPattern(p("A a+b.md"), [change("A", "a+b.md")])).toBe(true)
    expect(matchesPattern(p("A a+b.md"), [change("A", "aXb.md")])).toBe(false)
  })

  it("glob semantics documented discrepancy: `* *` is NOT a full catch-all once paths nest", () => {
    // The plan's prose calls `"* *"` "the catch-all for any dirty tree", but a
    // single-segment `*` cannot cross a `/` — so a change to a nested path is
    // NOT caught by `"* *"`. `"* **"` is the actual any-depth catch-all.
    const rootOnly = p("* *")
    const anyDepth = p("* **")
    const nested = [change("M", ".gtd/FEEDBACK.md")]
    expect(matchesPattern(rootOnly, nested)).toBe(false)
    expect(matchesPattern(anyDepth, nested)).toBe(true)
  })
})

describe("matchesPattern — property: `**` matches whatever `*` matches (superset)", () => {
  it("holds over random single-segment path fragments", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9_.-]{1,20}$/),
        fc.constantFrom("A", "M", "D") as fc.Arbitrary<PendingChange["status"]>,
        (segment, status) => {
          const starPattern = parsePattern("* *")!
          const doubleStarPattern = parsePattern("* **")!
          const pending = [change(status, segment)]
          if (matchesPattern(starPattern, pending)) {
            expect(matchesPattern(doubleStarPattern, pending)).toBe(true)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it("`**` always matches any random multi-segment path", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-zA-Z0-9_.-]{1,10}$/), { minLength: 1, maxLength: 5 }),
        (segments) => {
          const path = segments.join("/")
          expect(matchesPattern(parsePattern("* **")!, [change("A", path)])).toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })
})

// ── Step decision matrix ──────────────────────────────────────────────────────

describe("step — out-of-turn refusal", () => {
  it("refuses when the invoker isn't the state's declared actor", () => {
    const decision = step(simpleWorkflow, "idle", "agent", { changes: [], processTrace: [] })
    expect(decision).toEqual({
      kind: "refusal",
      reason: "out-of-turn",
      state: "idle",
      awaits: "human",
    })
  })
})

describe("step — no-match refusal on a dirty tree", () => {
  it("refuses and names the state's declared patterns when nothing matches", () => {
    const decision = step(simpleWorkflow, "working", "agent", {
      changes: [change("M", "scratch.txt")],
      processTrace: [],
    })
    expect(decision).toEqual({
      kind: "refusal",
      reason: "no-match",
      state: "working",
      patterns: ["A DONE.md", "C"],
    })
  })
})

// ── Attribution: subject actor is the invoker, resolution keys on state name ──

describe("step + resolveState — cross-actor handoff attribution", () => {
  it("a human stepping at a human state into an agent state writes the human's actor, and resolution still hands the turn to the agent", () => {
    const decision = step(simpleWorkflow, "idle", "human", {
      changes: [change("A", "TODO.md")],
      processTrace: [],
    })
    expect(decision).toEqual({
      kind: "commit",
      // The subject carries "human" (the invoker), not "working"'s own
      // declared actor ("agent"), prefixed with the "idle" source state.
      subject: "gtd(human): idle → working",
      actor: "human",
      from: "idle",
      to: "working",
    })
    if (decision.kind !== "commit") throw new Error("expected a commit decision")

    // Resolving that exact subject on the next invocation must still land on
    // "working" — resolution reads the state name alone.
    const resolved = resolveState(simpleWorkflow, decision.subject)
    expect(resolved).toBe("working")

    // And it's "working"'s OWN declared actor ("agent") — not "human", the
    // subject's actor — who is now recognized as awaited: the agent may step,
    // the human (who just authored the handoff) is refused as out-of-turn.
    expect(
      step(simpleWorkflow, resolved, "agent", { changes: [], processTrace: [] }).kind,
    ).not.toBe("refusal")
    expect(step(simpleWorkflow, resolved, "human", { changes: [], processTrace: [] })).toEqual({
      kind: "refusal",
      reason: "out-of-turn",
      state: "working",
      awaits: "agent",
    })
  })
})

describe("step — out-of-turn refusal keys on the RESOLVED state's declared actor, not the subject's actor", () => {
  it("a subject authored by one actor still gates the NEXT step by the resolved state's own declared actor", () => {
    // Simulate HEAD carrying a handoff subject: "human" authored the step
    // that entered "working" (an agent state) — exactly what the previous
    // test's `step` call would write.
    const headSubject = "gtd(human): working"
    const resolved = resolveState(simpleWorkflow, headSubject)
    expect(resolved).toBe("working")

    // The subject's own actor ("human") is irrelevant to who may step next —
    // only "working"'s declared actor ("agent") governs turn-taking.
    expect(step(simpleWorkflow, resolved, "human", { changes: [], processTrace: [] })).toEqual({
      kind: "refusal",
      reason: "out-of-turn",
      state: "working",
      awaits: "agent",
    })
  })
})

describe("resolveState — an undeclared actor is a boundary, resolving to the initial state", () => {
  it("an actor token no state in the workflow declares resolves to initial, even with an otherwise-valid state name", () => {
    // "nobody" is not "human", "agent", or "check" (or any other actor
    // declared anywhere in `simpleWorkflow`) — a closed-world boundary.
    expect(resolveState(simpleWorkflow, "gtd(nobody): working")).toBe(
      initialStateOf(simpleWorkflow),
    )
  })
})

describe("step — clean tree", () => {
  it("fires the declared C event when present", () => {
    const decision = step(simpleWorkflow, "working", "agent", { changes: [], processTrace: [] })
    expect(decision).toEqual({
      kind: "commit",
      // The subject carries the INVOKER's actor ("agent"), not "idle"'s own
      // declared actor ("human") — resolveState reads the entered state alone,
      // so this still resolves back to "idle" on the next invocation.
      subject: "gtd(agent): working → idle",
      actor: "agent",
      from: "working",
      to: "idle",
    })
  })

  it("is a no-op when no C event is declared", () => {
    const decision = step(simpleWorkflow, "idle", "human", { changes: [], processTrace: [] })
    expect(decision).toEqual({ kind: "noop", state: "idle" })
  })
})

describe("step — first match wins", () => {
  it("picks the first declared pattern that matches, ignoring a later one that would also match", () => {
    const workflow: WorkflowDefinition = def(
      {
        s: {
          actor: "human",
          message: "x",
          on: [
            ["A x.md", "first"],
            ["* *", "second"],
          ],
        },
        first: { commit: "chore: first" },
        second: { commit: "chore: second" },
      },
      "s",
    )
    // This change matches BOTH rows ("A x.md" and the "* *" catch-all) — the
    // first declared row must win.
    const decision = step(workflow, "s", "human", {
      changes: [change("A", "x.md")],
      processTrace: [],
    })
    expect(decision).toEqual({ kind: "squash", state: "first", template: "chore: first" })
  })
})

describe("step — squash decision", () => {
  it("targeting a commit state yields a squash decision carrying its template verbatim", () => {
    const decision = step(simpleWorkflow, "working", "agent", {
      changes: [change("A", "DONE.md")],
      processTrace: [],
    })
    expect(decision).toEqual({
      kind: "squash",
      state: "done",
      template: "chore: <%= it.state %>",
    })
  })
})

describe("step — structural errors", () => {
  it("throws for an unknown state", () => {
    expect(() =>
      step(simpleWorkflow, "nonexistent", "human", { changes: [], processTrace: [] }),
    ).toThrow(/unknown state/)
  })

  it("throws when invoked at a commit state", () => {
    expect(() => step(simpleWorkflow, "done", "human", { changes: [], processTrace: [] })).toThrow(
      /commit state/,
    )
  })
})

// ── Retry redirection ─────────────────────────────────────────────────────────

describe("step — retry redirection", () => {
  it("under the limit: fixing -> checking with one prior visit stays at checking", () => {
    const decision = step(retryWorkflow, "fixing", "agent", {
      changes: [change("M", "x.ts")],
      processTrace: ["start", "checking"],
    })
    expect(decision).toEqual({
      kind: "commit",
      // The subject carries the INVOKER's actor ("agent"), not "checking"'s
      // own declared actor ("check").
      subject: "gtd(agent): fixing → checking",
      actor: "agent",
      from: "fixing",
      to: "checking",
    })
  })

  it("at the limit: redirects to `otherwise` instead of re-entering the capped state", () => {
    // max=2, and "checking" already appears twice in the trace: the third
    // entry redirects to "escalate".
    const decision = step(retryWorkflow, "fixing", "agent", {
      changes: [change("M", "x.ts")],
      processTrace: ["start", "checking", "fixing", "checking"],
    })
    expect(decision).toEqual({
      kind: "commit",
      // The subject carries the INVOKER's actor ("agent"), not "escalate"'s
      // own declared actor ("human").
      subject: "gtd(agent): fixing → escalate",
      actor: "agent",
      from: "fixing",
      to: "escalate",
    })
  })

  it("redirects even with its own loop partner (fixing) interleaved — the reset only fires for a state outside the loop, see the fixerRetryWorkflow tests below", () => {
    // "checking" appears 3 times here — already past its max=2 cap — so this
    // still redirects even though "fixing" entries sit between them: "fixing"
    // is one of "checking"'s sources (its own "on" targets "checking"), so
    // interleaving with it never resets the count.
    const decision = step(retryWorkflow, "fixing", "agent", {
      changes: [change("M", "x.ts")],
      processTrace: ["checking", "fixing", "checking", "fixing", "checking", "fixing"],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): fixing → escalate",
      actor: "agent",
      from: "fixing",
      to: "escalate",
    })
  })

  it("interleaved loop partner does not reset — and the cap still fires within one episode (fixerRetryWorkflow caps the fixer, the shape the bundled template uses)", () => {
    // "fixing"'s only source is "checking" (checking's own "A FEEDBACK.md"
    // row targets it) — so the two "checking" entries interleaved between the
    // two "fixing" entries do NOT reset the count. Two prior "fixing" visits
    // meets its max: 2 cap, so this third attempted entry redirects.
    const decision = step(fixerRetryWorkflow, "checking", "check", {
      changes: [change("A", "FEEDBACK.md")],
      processTrace: ["checking", "fixing", "checking", "fixing"],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(check): checking → escalate",
      actor: "check",
      from: "checking",
      to: "escalate",
    })
  })

  it("out-of-loop state resets: an intervening `reviewing` entry (not a source of `fixing`) restores the budget", () => {
    // Same shape as above, but a "reviewing" entry sits between the two
    // "checking"/"fixing" pairs. "reviewing" is not one of "fixing"'s
    // sources, so it resets the count back to zero — only the LAST
    // "checking" → "fixing" pair counts, well under the max: 2 cap.
    const decision = step(fixerRetryWorkflow, "checking", "check", {
      changes: [change("A", "FEEDBACK.md")],
      processTrace: ["checking", "fixing", "checking", "reviewing", "checking", "fixing"],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(check): checking → fixing",
      actor: "check",
      from: "checking",
      to: "fixing",
    })
  })

  it("resets naturally: an empty process trace (fresh process) never redirects on first entry", () => {
    const decision = step(retryWorkflow, "fixing", "agent", {
      changes: [change("M", "x.ts")],
      processTrace: [],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): fixing → checking",
      actor: "agent",
      from: "fixing",
      to: "checking",
    })
  })

  it("applies retry recursively to `otherwise` when it also declares a retry cap", () => {
    const workflow: WorkflowDefinition = def(
      {
        s: {
          actor: "human",
          message: "x",
          on: [["* *", "a"]],
        },
        a: { actor: "human", message: "a", retry: { max: 1, otherwise: "b" }, on: [["* *", "a"]] },
        b: { actor: "human", message: "b", retry: { max: 1, otherwise: "c" }, on: [["* *", "b"]] },
        c: { commit: "chore: c" },
      },
      "s",
    )
    // Per-episode counting means a trace of just ["a", "b"] would no longer
    // work here: "b" is not one of "a"'s sources, so it would reset "a"'s own
    // count back to zero and the first hop would never fire. Landing at "b"
    // is itself the redirect this test wants to prove chains further, so the
    // trace instead shows "a" re-entered AFTER that reset (["a", "b", "a"]):
    // the trailing "a" is "a"'s one (fresh, post-reset) episode visit, which
    // already meets its max=1 cap, so THIS turn's attempt to enter "a" again
    // redirects to "b". "b" is at its own cap too — because "a" is one of
    // "b"'s sources (it's "a"'s own `retry.otherwise`), the leading "a" in
    // the trace does NOT reset "b"'s count, so "b"'s one prior visit still
    // counts, meeting its own max=1 cap — so it redirects again to "c".
    const decision = step(workflow, "s", "human", {
      changes: [change("A", "x")],
      processTrace: ["a", "b", "a"],
    })
    expect(decision).toEqual({ kind: "squash", state: "c", template: "chore: c" })
  })

  it("guards against a redirect cycle: two states whose `otherwise` point at each other terminate rather than loop", () => {
    const workflow: WorkflowDefinition = def(
      {
        s: { actor: "human", message: "x", on: [["* *", "a"]] },
        a: { actor: "human", message: "a", retry: { max: 0, otherwise: "b" }, on: [["* *", "a"]] },
        b: { actor: "human", message: "b", retry: { max: 0, otherwise: "a" }, on: [["* *", "b"]] },
      },
      "s",
    )
    // max: 0 means EVERY entry redirects immediately (0 prior visits already
    // satisfies "at least max"). Without the cycle guard this would recurse
    // forever; it must terminate and land on one of the two states.
    const decision = step(workflow, "s", "human", { changes: [change("A", "x")], processTrace: [] })
    expect(decision.kind).toBe("commit")
    if (decision.kind === "commit") {
      expect(["a", "b"]).toContain(decision.to)
    }
  })
})

// ── Attempt commits ──────────────────────────────────────────────────────────

describe("step — attempt commits (clean tree, no-C prompt state)", () => {
  it("a clean step at a no-C prompt state decides an attempt commit, self-looping", () => {
    const decision = step(retryWorkflow, "fixing", "agent", { changes: [], processTrace: [] })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): fixing",
      actor: "agent",
      from: "fixing",
      to: "fixing",
      attempt: true,
    })
  })

  it("a declared C row still wins on a clean tree — never an attempt", () => {
    const decision = step(simpleWorkflow, "working", "agent", { changes: [], processTrace: [] })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): working → idle",
      actor: "agent",
      from: "working",
      to: "idle",
    })
  })

  it("a script state with no C row still decides a plain no-op, never an attempt", () => {
    const workflow: WorkflowDefinition = def(
      { checking: { actor: "check", script: "npm test", on: [["A x", "checking"]] } },
      "checking",
    )
    const decision = step(workflow, "checking", "check", { changes: [], processTrace: [] })
    expect(decision).toEqual({ kind: "noop", state: "checking" })
  })

  it("a message state with no C row still decides a plain no-op, never an attempt", () => {
    const workflow: WorkflowDefinition = def(
      { idle: { actor: "human", message: "hi", on: [["A x", "idle"]] } },
      "idle",
    )
    const decision = step(workflow, "idle", "human", { changes: [], processTrace: [] })
    expect(decision).toEqual({ kind: "noop", state: "idle" })
  })

  it("a dirty tree matching no pattern still refuses, never an attempt", () => {
    const noMatchWorkflow: WorkflowDefinition = def(
      {
        working: { actor: "agent", prompt: "do it", on: [["A x", "done"]] },
        done: { commit: "c" },
      },
      "working",
    )
    const refusal = step(noMatchWorkflow, "working", "agent", {
      changes: [change("M", "y")],
      processTrace: [],
    })
    expect(refusal).toEqual({
      kind: "refusal",
      reason: "no-match",
      state: "working",
      patterns: ["A x"],
    })
  })

  it("retry: {max, otherwise} on a prompt state attempts under the cap, then redirects at the cap", () => {
    const workflow: WorkflowDefinition = def(
      {
        working: {
          actor: "agent",
          prompt: "do it",
          retry: { max: 2, otherwise: "escalate" },
          on: [["A DONE.md", "done"]],
        },
        escalate: { actor: "human", message: "stuck", on: [["* *", "done"]] },
        done: { commit: "chore: done" },
      },
      "working",
    )
    // One prior entry into "working" (max: 2) — under the cap, attempts again.
    const first = step(workflow, "working", "agent", { changes: [], processTrace: ["working"] })
    expect(first).toEqual({
      kind: "commit",
      subject: "gtd(agent): working",
      actor: "agent",
      from: "working",
      to: "working",
      attempt: true,
    })

    // Two prior entries — at the cap — redirects to "escalate".
    const second = step(workflow, "working", "agent", {
      changes: [],
      processTrace: ["working", "working"],
    })
    expect(second).toEqual({
      kind: "commit",
      subject: "gtd(agent): working → escalate",
      actor: "agent",
      from: "working",
      to: "escalate",
      attempt: true,
    })
  })

  it("retry.otherwise naming a commit state yields a squash decision — never an attempt", () => {
    const workflow: WorkflowDefinition = def(
      {
        working: {
          actor: "agent",
          prompt: "do it",
          retry: { max: 1, otherwise: "done" },
          on: [],
        },
        done: { commit: "chore: done" },
      },
      "working",
    )
    const decision = step(workflow, "working", "agent", {
      changes: [],
      processTrace: ["working"],
    })
    expect(decision).toEqual({ kind: "squash", state: "done", template: "chore: done" })
  })

  it("attempt counting is unchanged: a clean-tree attempt at `fixing` counts from zero once an intervening `reviewing` entry resets the episode", () => {
    // "fixing" appears twice, but "reviewing" (not one of "fixing"'s
    // sources) sits between them and resets the count — so at this clean
    // attempt, only the LAST "fixing" entry counts (1), still under max: 2.
    const trace = ["fixing", "checking", "reviewing", "checking", "fixing"]
    expect(wouldAttempt(fixerRetryWorkflow, "fixing", trace)).toBe(true)
    const decision = step(fixerRetryWorkflow, "fixing", "agent", {
      changes: [],
      processTrace: trace,
    })
    // Identical shape to a fresh (empty-trace) attempt — the reset means this
    // is exactly as if "fixing" had never been visited before.
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): fixing",
      actor: "agent",
      from: "fixing",
      to: "fixing",
      attempt: true,
    })
  })
})

describe("wouldAttempt", () => {
  it("is true exactly when a clean step at `state` would decide a self-looping attempt", () => {
    expect(wouldAttempt(retryWorkflow, "fixing", [])).toBe(true)
  })

  it("is false when a declared C row would fire instead", () => {
    expect(wouldAttempt(simpleWorkflow, "working", [])).toBe(false)
  })

  it("is false at a script/message state (a clean step there is a plain no-op)", () => {
    expect(wouldAttempt(retryWorkflow, "checking", ["start", "checking"])).toBe(false)
  })

  it("is false once a retry cap redirects the attempt elsewhere", () => {
    const workflow: WorkflowDefinition = def(
      {
        working: {
          actor: "agent",
          prompt: "do it",
          retry: { max: 2, otherwise: "escalate" },
          on: [["A DONE.md", "done"]],
        },
        escalate: { actor: "human", message: "stuck", on: [["* *", "done"]] },
        done: { commit: "chore: done" },
      },
      "working",
    )
    expect(wouldAttempt(workflow, "working", ["working"])).toBe(true)
    expect(wouldAttempt(workflow, "working", ["working", "working"])).toBe(false)
  })
})

// ── Memory scoping primitives ─────────────────────────────────────────────────

describe("inScope — dotted-prefix scope test", () => {
  it('the root scope ("") matches every state', () => {
    expect(inScope("anything", "")).toBe(true)
    expect(inScope("", "")).toBe(true)
  })

  it("an exact match is in scope", () => {
    expect(inScope("a.b", "a.b")).toBe(true)
  })

  it("a true dotted descendant is in scope", () => {
    expect(inScope("a.b.c", "a.b")).toBe(true)
  })

  it("a same-prefix SIBLING (no dot separator) is NOT in scope", () => {
    expect(inScope("packages.itemx.building", "packages.item")).toBe(false)
  })

  it("a sibling with no shared prefix at all is not in scope", () => {
    expect(inScope("b.c", "a.b")).toBe(false)
  })

  it("a scope that's a strict suffix/substring of the state, but not a prefix, is not in scope", () => {
    expect(inScope("x.a.b", "a.b")).toBe(false)
  })
})

describe("memoryScopeAt", () => {
  // The worked trace: qualified state name -> that state's OWN scope.
  // Rows 11/13 name the same state (`packages.item.spec.review`) and rows
  // 2/4 name the same state (`design.product-author`) — the table maps each
  // DISTINCT state name once, consistently. Rows 2-6 are all scope `design`
  // (the advancedPlan machine's one design conversation spans product Q&A,
  // technical Q&A, and decomposition — see src/workflows/unified.yaml).
  const rows: ReadonlyArray<readonly [state: string, scope: string]> = [
    ["spec-gate.check", "spec-gate"], // 1
    ["design.product-author", "design"], // 2
    ["design.product-answer", "design"], // 3
    ["design.product-author", "design"], // 4
    ["design.technical-author", "design"], // 5
    ["design.decompose", "design"], // 6
    ["packages.picking", "packages"], // 7
    ["packages.item.building", "packages.item"], // 8
    ["packages.item.health.check", "packages.item.health"], // 9
    ["packages.item.fix-suite", "packages.item"], // 10
    ["packages.item.spec.review", "packages.item.spec"], // 11
    ["packages.item.fix-spec", "packages.item"], // 12
    ["packages.item.spec.review", "packages.item.spec"], // 13
    ["packages.item.closing", "packages.item"], // 14
  ]
  const scopes: Readonly<Record<string, string>> = Object.fromEntries(rows)
  const trace = rows.map(([state]) => state)

  it("a parent scope's unbroken run survives an excursion into child scopes: querying row 12's state over trace 1..11, and querying row 10's state over trace 1..9, both resolve entryIndex to row 8 (index 7)", () => {
    // Rows 9 and 11 are both true dotted descendants of `packages.item`
    // (`packages.item.health`, `packages.item.spec`), so they don't break
    // the run that started at row 8 (`packages.item.building`).
    expect(memoryScopeAt(scopes, "packages.item.fix-spec", trace.slice(0, 11))).toEqual({
      scope: "packages.item",
      entryIndex: 7,
    })
    expect(memoryScopeAt(scopes, "packages.item.fix-suite", trace.slice(0, 9))).toEqual({
      scope: "packages.item",
      entryIndex: 7,
    })
  })

  it("a PARENT scope in between breaks the run for a query scoped at the CHILD: querying row 13's state over trace 1..12 resolves entryIndex to row 11 (index 10)", () => {
    // Row 12 (`packages.item.fix-spec`, scope `packages.item`) is the
    // PARENT of `packages.item.spec`, not a descendant of it — inScope is
    // false — so it breaks any run scoped at `packages.item.spec`. The only
    // trace row ever inside that subtree is row 11 itself, which therefore
    // starts (and is) its own unbroken run.
    expect(memoryScopeAt(scopes, "packages.item.spec.review", trace.slice(0, 12))).toEqual({
      scope: "packages.item.spec",
      entryIndex: 10,
    })
  })

  it("an empty trace resolves to entryIndex: -1 (fresh), not undefined, for a state present in scopes", () => {
    expect(memoryScopeAt(scopes, "packages.item.closing", [])).toEqual({
      scope: "packages.item",
      entryIndex: -1,
    })
  })

  it("nothing in the trace ever inside the scope's subtree also falls back to entryIndex: -1", () => {
    expect(
      memoryScopeAt(scopes, "packages.item.building", [
        "design.product-author",
        "design.product-answer",
      ]),
    ).toEqual({
      scope: "packages.item",
      entryIndex: -1,
    })
  })

  it("querying a state absent from `scopes` returns undefined entirely", () => {
    expect(memoryScopeAt(scopes, "no-such-state", trace.slice(0, 12))).toBeUndefined()
  })

  it("a trace row naming a state absent from `scopes` is skipped, not thrown on, when the QUERIED state is itself present", () => {
    // "ghost" isn't in `scopes`; it sits right before the row that starts
    // the qualifying run, so it correctly counts as "not in scope" for
    // run-continuity purposes without crashing.
    const traceWithGap = ["ghost", "packages.item.building"]
    expect(memoryScopeAt(scopes, "packages.item.fix-suite", traceWithGap)).toEqual({
      scope: "packages.item",
      entryIndex: 1,
    })
  })
})

// ── Definition validation ─────────────────────────────────────────────────────

describe("validateDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(validateDefinition(simpleWorkflow)).toEqual([])
    expect(validateDefinition(retryWorkflow)).toEqual([])
  })

  it("rejects a `file:` outside `.gtd/` — the one case the compiler's prepend can't catch, a hand-built definition that skipped it", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", file: "REVIEW.md", on: [] },
      },
    })
    expect(errors).toContain('state "a": "file" must be under ".gtd/" (got "REVIEW.md")')
  })

  it("accepts a `file:` that is exactly `.gtd` itself, or any path under `.gtd/`", () => {
    expect(
      validateDefinition({
        entries: { default: "a", manual: [] },
        states: { a: { actor: "h", message: "x", file: ".gtd", on: [] } },
      }),
    ).toEqual([])
    expect(
      validateDefinition({
        entries: { default: "a", manual: [] },
        states: { a: { actor: "h", message: "x", file: ".gtd/packages/x.md", on: [] } },
      }),
    ).toEqual([])
  })

  it("requires at least one state", () => {
    expect(validateDefinition({ entries: { default: "a", manual: [] }, states: {} })).toEqual([
      "workflow must declare at least one state",
    ])
  })

  it("rejects entries.default naming an undefined state", () => {
    const errors = validateDefinition({
      entries: { default: "ghost", manual: [] },
      states: { a: { actor: "h", message: "x", on: [] } },
    })
    expect(errors).toContain('entries.default "ghost" is not a defined state')
  })

  it("rejects entries.default naming a commit state", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: { a: { commit: "chore: a" } },
    })
    expect(errors).toContain('entries.default "a" must not be a commit state')
  })

  it("rejects entries.manual naming an undefined state", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: ["ghost"] },
      states: { a: { actor: "h", message: "x", on: [["* *", "a"]] } },
    })
    expect(errors).toContain('entries.manual "ghost" is not a defined state')
  })

  it("rejects entries.manual equal to entries.default", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: ["a"] },
      states: { a: { actor: "h", message: "x", on: [["* *", "a"]] } },
    })
    expect(errors).toContain('entries.manual "a" must not be the same state as entries.default')
  })

  it("rejects a duplicate state name within entries.manual itself", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: ["b", "b"] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "h", message: "y", on: [["* *", "a"]] },
      },
    })
    expect(errors).toContain('entries.manual declares "b" more than once')
  })

  it("accepts entries with only `default` (an empty `manual`)", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: { a: { actor: "h", message: "x", on: [["* *", "a"]] } },
    })
    expect(errors).toEqual([])
  })

  it("accepts entries.default plus multiple entries.manual, all distinct and valid", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: ["b", "c"] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "a"]] },
        b: { actor: "h", message: "y", on: [["* *", "a"]] },
        c: { actor: "check", script: "run", on: [["C", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("requires exactly one content kind (zero, and more than one)", () => {
    const zero = validateDefinition({
      entries: { default: "a", manual: [] },
      states: { a: { actor: "h", on: [] } },
    })
    expect(zero.some((e) => e.includes("exactly one of script/prompt/message/commit"))).toBe(true)

    const two = validateDefinition({
      entries: { default: "a", manual: [] },
      states: { a: { actor: "h", message: "x", script: "y", on: [] } },
    })
    expect(two.some((e) => e.includes("exactly one of script/prompt/message/commit"))).toBe(true)
  })

  it("rejects a commit state that declares an actor or `on`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", actor: "h" },
      },
    })
    expect(errors).toContain('commit state "b" must not declare an actor')
  })

  it("rejects a commit state that declares `on`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", on: [["* *", "a"]] },
      },
    })
    expect(errors).toContain('commit state "b" must not declare "on"')
  })

  it("requires a non-commit state to declare an actor", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: { a: { message: "x", on: [] } },
    })
    expect(errors).toContain('state "a" must declare an actor (only a commit state may omit one)')
  })

  it("rejects an unparseable pattern", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["nonsense", "a"]] },
      },
    })
    expect(errors.some((e) => e.includes('pattern "nonsense" does not parse'))).toBe(true)
  })

  it("rejects an `on` target that isn't a defined state", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "ghost"]] },
      },
    })
    expect(errors).toContain('state "a": "on" target "ghost" is not a defined state')
  })

  it("rejects a `retry.otherwise` that isn't a defined state", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: {
          actor: "h",
          message: "x",
          retry: { max: 1, otherwise: "ghost" },
          on: [["* *", "a"]],
        },
      },
    })
    expect(errors).toContain('state "a": retry.otherwise "ghost" is not a defined state')
  })

  it("accepts a state declaring a valid `model`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", model: "smart", on: [] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects an empty-string `model`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", model: "", on: [] },
      },
    })
    expect(errors).toContain('state "a": "model" must be a non-empty string')
  })

  it("rejects a commit state that declares a `model`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", model: "smart" },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "model"')
  })

  it("aggregates a bad `model` alongside other unrelated findings", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: {
          actor: "h",
          message: "x",
          model: "",
          on: [["* *", "ghost"]],
        },
      },
    })
    expect(errors).toContain('state "a": "model" must be a non-empty string')
    expect(errors).toContain('state "a": "on" target "ghost" is not a defined state')
  })

  it("accepts a state declaring a valid `label`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", label: "Doing the work", on: [] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects an empty-string `label`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", label: "", on: [] },
      },
    })
    expect(errors).toContain('state "a": "label" must be a non-empty string')
  })

  it("rejects a commit state that declares a `label`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", label: "Done" },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "label"')
  })

  it("aggregates a bad `label` alongside other unrelated findings", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: {
          actor: "h",
          message: "x",
          label: "",
          on: [["* *", "ghost"]],
        },
      },
    })
    expect(errors).toContain('state "a": "label" must be a non-empty string')
    expect(errors).toContain('state "a": "on" target "ghost" is not a defined state')
  })

  it("accepts a state declaring a valid `file` alone (no `mode`)", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", file: ".gtd/FEEDBACK.md", on: [] },
      },
    })
    expect(errors).toEqual([])
  })

  it("accepts a state declaring `file` and a valid `mode`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { qa: {} },
      states: {
        a: {
          actor: "h",
          message: "x",
          file: ".gtd/TODO.md",
          mode: "qa",
          on: [],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it("accepts a state declaring `mode: prose` when `modes:` declares an empty (format-only) entry", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { prose: {} },
      states: {
        a: {
          actor: "h",
          message: "x",
          file: ".gtd/TODO.md",
          mode: "prose",
          on: [],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects `mode: prose` with no `modes:` declaration at all — this pure module knows no built-in vocabulary", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", file: ".gtd/TODO.md", mode: "prose", on: [] },
      },
    })
    expect(errors).toContain(
      'state "a": "mode" must name a mode this workflow knows (none declared) (got "prose")',
    )
  })

  it("rejects `mode: prose` without a sibling `file`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { prose: {} },
      states: {
        a: { actor: "h", message: "x", mode: "prose", on: [] },
      },
    })
    expect(errors).toContain('state "a": "mode" requires "file"')
  })

  it("rejects an empty-string `file`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", file: "", on: [] },
      },
    })
    expect(errors).toContain('state "a": "file" must be a non-empty string')
  })

  it("rejects a commit state that declares a `file`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", file: ".gtd/TODO.md" },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "file"')
  })

  it("rejects a `mode` no `modes:` entry defines, naming what is available", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { qa: {} },
      states: {
        a: {
          actor: "h",
          message: "x",
          file: ".gtd/TODO.md",
          mode: "yolo" as StateMode,
          on: [],
        },
      },
    })
    expect(errors).toContain(
      'state "a": "mode" must name a mode this workflow knows (qa) (got "yolo")',
    )
  })

  it("accepts a `mode` a `modes:` entry declares, and lists the declared names when another mode is unknown", () => {
    const accepted = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { adr: { validate: "./scripts/check-adr.sh <%= it.file %>" } },
      states: {
        a: { actor: "h", message: "x", file: ".gtd/docs/adr.md", mode: "adr", on: [] },
      },
    })
    expect(accepted).toEqual([])

    const rejected = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { adr: { validate: "check" } },
      states: {
        a: { actor: "h", message: "x", file: ".gtd/docs/adr.md", mode: "adrs", on: [] },
      },
    })
    expect(rejected).toContain(
      'state "a": "mode" must name a mode this workflow knows (adr) (got "adrs")',
    )
  })

  it("accepts an empty `modes:` entry ({}) — the format-only tier any workflow can declare, built-in or not", () => {
    expect(
      validateDefinition({
        entries: { default: "a", manual: [] },
        modes: { adr: {} },
        states: {
          a: { actor: "h", message: "x", file: ".gtd/docs/adr.md", mode: "adr", on: [] },
        },
      }),
    ).toEqual([])
  })

  it("still validates a declared mode's own format/validate commands, even when it shadows a built-in name", () => {
    expect(
      validateDefinition({
        entries: { default: "a", manual: [] },
        modes: {
          qa: { format: "prettier -w <%= it.file %>", validate: "my-linter <%= it.file %>" },
        },
        states: {
          a: { actor: "h", message: "x", file: ".gtd/TODO.md", mode: "qa", on: [] },
        },
      }),
    ).toEqual([])
  })

  it("rejects a `modes:` entry that declares a blank command", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { blank: { validate: "   " } },
      states: {
        a: { actor: "h", message: "x", on: [] },
      },
    })
    expect(errors).toEqual(['mode "blank": "validate" must be a non-empty shell command'])
  })

  it("rejects a `mode` with no sibling `file`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { qa: {} },
      states: {
        a: { actor: "h", message: "x", mode: "qa", on: [] },
      },
    })
    expect(errors).toContain('state "a": "mode" requires "file"')
  })

  it("rejects a commit state that declares a `mode`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { qa: {} },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", file: ".gtd/TODO.md", mode: "qa" },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "mode"')
  })

  it("accepts a non-commit state declaring `reviewWindow`/`reviewBase`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: {
          actor: "h",
          message: "x",
          reviewBase: true,
          on: [["* *", "b"]],
        },
        b: { actor: "h", message: "review", reviewWindow: true, on: [["C", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects a commit state that declares `reviewWindow`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", reviewWindow: true },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "reviewWindow"')
  })

  it("rejects a commit state that declares `reviewBase`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", reviewBase: true },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "reviewBase"')
  })

  it("accepts a non-empty string `reviewBase` (the template form)", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", reviewBase: "main", on: [["* *", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects a blank string `reviewBase` template", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", reviewBase: "", on: [["* *", "a"]] },
      },
    })
    expect(errors).toContain('state "a": "reviewBase" template must not be blank')
  })

  it("rejects a whitespace-only string `reviewBase` template", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", reviewBase: "   ", on: [["* *", "a"]] },
      },
    })
    expect(errors).toContain('state "a": "reviewBase" template must not be blank')
  })

  it("accepts entries.manual naming a distinct, non-commit state", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: ["b"] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "h", message: "review", on: [["C", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects entries.manual naming a commit state", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: ["b"] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b" },
      },
    })
    expect(errors).toContain('entries.manual "b" must not be a commit state')
  })

  it("accepts a non-commit state declaring `requireProgress` with a `file`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "a", prompt: "p", file: ".gtd/F.md", requireProgress: true, on: [["C", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects `requireProgress` without a `file`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "a", prompt: "p", requireProgress: true, on: [["C", "a"]] },
      },
    })
    expect(errors).toContain('state "b": "requireProgress" requires "file"')
  })

  it("rejects a commit state that declares `requireProgress`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", requireProgress: true },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "requireProgress"')
  })

  it("accepts a non-commit state declaring `requireRevert` with a `file`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: {
          actor: "check",
          script: "s",
          file: ".gtd/REVIEW.md",
          requireRevert: true,
          on: [["C", "a"]],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects `requireRevert` without a `file`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "check", script: "s", requireRevert: true, on: [["C", "a"]] },
      },
    })
    expect(errors).toContain('state "b": "requireRevert" requires "file"')
  })

  it("rejects a commit state that declares `requireRevert`", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b", requireRevert: true },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "requireRevert"')
  })

  it("accepts entries.manual naming a distinct, non-commit script/check state", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: ["b"] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "check", script: "run", on: [["C", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects entries.manual naming a commit state (script/check variant)", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: ["b"] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { commit: "chore: b" },
      },
    })
    expect(errors).toContain('entries.manual "b" must not be a commit state')
  })

  it("treats entries.manual as reachable even with no inbound `on`/`retry` edge (seeded as a root)", () => {
    // "fix-check" has no inbound `on`/`retry` edge from the default entry — it
    // is entered ONLY via `gtd --entry fix-check`, so seeding it
    // as a reachability root is what keeps it from being wrongly flagged
    // unreachable.
    const errors = validateDefinition({
      entries: { default: "idle", manual: ["fix-check"] },
      states: {
        idle: { actor: "h", message: "x", on: [["* *", "idle"]] },
        "fix-check": { actor: "check", script: "r", on: [["C", "idle"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("aggregates a bad `file`/`mode` alongside other unrelated findings", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: {
          actor: "h",
          message: "x",
          file: "",
          mode: "yolo" as StateMode,
          on: [["* *", "ghost"]],
        },
      },
    })
    expect(errors).toContain('state "a": "file" must be a non-empty string')
    expect(errors).toContain(
      'state "a": "mode" must name a mode this workflow knows (none declared) (got "yolo")',
    )
    expect(errors).toContain('state "a": "on" target "ghost" is not a defined state')
  })

  it("rejects a negative or non-integer retry.max", () => {
    const negative = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: {
          actor: "h",
          message: "x",
          retry: { max: -1, otherwise: "a" },
          on: [["* *", "a"]],
        },
      },
    })
    expect(negative.some((e) => e.includes("retry.max must be a non-negative integer"))).toBe(true)

    const fractional = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: {
          actor: "h",
          message: "x",
          retry: { max: 1.5, otherwise: "a" },
          on: [["* *", "a"]],
        },
      },
    })
    expect(fractional.some((e) => e.includes("retry.max must be a non-negative integer"))).toBe(
      true,
    )
  })

  it("rejects a state unreachable from the initial state", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "done"]] },
        orphan: { actor: "h", message: "never entered", on: [["* *", "done"]] },
        done: { commit: "chore: done" },
      },
    })
    expect(errors).toEqual([
      'state "orphan" is unreachable from any entry state (a) (no "on" target or "retry.otherwise" leads to it)',
    ])
  })

  it("counts a `retry.otherwise` redirect as a reachability edge", () => {
    // "escalate" is entered ONLY via checking's retry redirect — it must not
    // be reported as unreachable (retryWorkflow's shape, minimized).
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "checking"]] },
        checking: {
          actor: "check",
          script: "t",
          retry: { max: 1, otherwise: "escalate" },
          on: [["* *", "checking"]],
        },
        escalate: { actor: "h", message: "stuck", on: [["* *", "checking"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("reports a whole disconnected cluster as unreachable, not just its entry", () => {
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "a"]] },
        b: { actor: "h", message: "b", on: [["* *", "c"]] },
        c: { actor: "h", message: "c", on: [["* *", "b"]] },
      },
    })
    expect(errors).toContain(
      'state "b" is unreachable from any entry state (a) (no "on" target or "retry.otherwise" leads to it)',
    )
    expect(errors).toContain(
      'state "c" is unreachable from any entry state (a) (no "on" target or "retry.otherwise" leads to it)',
    )
  })

  it("skips the reachability walk when entries validation already failed", () => {
    // An undefined "entries.default": every state would look "unreachable"
    // from an undefined start — the reachability check must stay silent
    // rather than bury the real finding.
    const errors = validateDefinition({
      entries: { default: "ghost", manual: [] },
      states: { a: { actor: "h", message: "x", on: [] } },
    })
    expect(errors).toContain('entries.default "ghost" is not a defined state')
    expect(errors.some((e) => e.includes("unreachable"))).toBe(false)
  })

  it("does not double-report an undefined `on` target as also unreachable", () => {
    // "ghost" is not a defined state: that is validateOnEdges's finding; the
    // reachability walk skips undefined targets rather than crashing, and
    // reports nothing extra for a definition whose defined states are all
    // reachable.
    const errors = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "ghost"]] },
      },
    })
    expect(errors).toEqual(['state "a": "on" target "ghost" is not a defined state'])
  })

  it("fires every per-field rule from src/StateFields.ts's table in one definition (regression guard for the field-table refactor, issue #158)", () => {
    // One fixture violating every per-field rule at once: a commit state
    // carrying every field forbidden on a commit state; a non-commit state
    // with empty `model`/`label`/`file` and an unknown `mode`; a state whose
    // `mode`/`requireProgress`/`answerGate` all lack the `file` they
    // require; a blank-template `reviewBase`. Guards against a future edit
    // to `STATE_FIELDS` silently dropping a field's `nonEmpty`/`commit`/
    // `requires` rule.
    const errors = validateDefinition({
      entries: { default: "start", manual: [] },
      states: {
        start: { actor: "human", message: "go", on: [["* *", "badFields"]] },
        badFields: {
          actor: "human",
          message: "x",
          model: "",
          label: "",
          file: "",
          mode: "bogus",
          on: [["* *", "missingFile"]],
        },
        missingFile: {
          actor: "human",
          message: "y",
          mode: "qa",
          requireProgress: true,
          answerGate: true,
          on: [["* *", "blankBase"]],
        },
        blankBase: {
          actor: "human",
          message: "z",
          reviewBase: "   ",
          on: [["* *", "badCommit"]],
        },
        badCommit: {
          commit: "chore: x",
          model: "m",
          label: "l",
          file: "f",
          mode: "qa",
          reviewWindow: true,
          reviewBase: true,
          requireProgress: true,
          answerGate: true,
        },
      },
    })

    expect(errors).toContain('state "badFields": "model" must be a non-empty string')
    expect(errors).toContain('state "badFields": "label" must be a non-empty string')
    expect(errors).toContain('state "badFields": "file" must be a non-empty string')
    expect(errors).toContain(
      'state "badFields": "mode" must name a mode this workflow knows (none declared) (got "bogus")',
    )
    expect(errors).toContain('state "missingFile": "mode" requires "file"')
    expect(errors).toContain('state "missingFile": "requireProgress" requires "file"')
    expect(errors).toContain('state "missingFile": "answerGate" requires "file"')
    expect(errors).toContain('state "blankBase": "reviewBase" template must not be blank')
    expect(errors).toContain('state "badCommit": a commit state cannot declare "model"')
    expect(errors).toContain('state "badCommit": a commit state cannot declare "label"')
    expect(errors).toContain('state "badCommit": a commit state cannot declare "file"')
    expect(errors).toContain('state "badCommit": a commit state cannot declare "mode"')
    expect(errors).toContain('state "badCommit": a commit state cannot declare "reviewWindow"')
    expect(errors).toContain('state "badCommit": a commit state cannot declare "reviewBase"')
    expect(errors).toContain('state "badCommit": a commit state cannot declare "requireProgress"')
    expect(errors).toContain('state "badCommit": a commit state cannot declare "answerGate"')
  })
})

// ── δ-purity property: decision depends only on (state def, invoker, payload) ─

/** A small alphabet of harmless "noise" states never referenced by any `on`/`retry` edge. */
const arbNoiseState: fc.Arbitrary<[string, StateDef]> = fc
  .record({
    name: fc.stringMatching(/^noise-[a-z0-9]{1,8}$/),
    kind: fc.constantFrom("script" as const, "prompt" as const, "message" as const),
    value: fc.string({ maxLength: 20 }),
  })
  .map(({ name, kind, value }) => [name, { actor: "human", [kind]: value } as StateDef])

describe("δ-purity: step's decision ignores unreferenced states in the definition", () => {
  it("adding/removing noise states never changes the decision for a fixed (state, invoker, payload)", () => {
    fc.assert(
      fc.property(
        fc.array(arbNoiseState, { maxLength: 5 }),
        fc.array(arbNoiseState, { maxLength: 5 }),
        fc.constantFrom("idle" as const, "working" as const),
        fc.constantFrom("human" as const, "agent" as const, "check" as const),
        fc.array(fc.constantFrom("A" as const, "M" as const, "D" as const), { maxLength: 3 }),
        (noiseA, noiseB, state, invoker, statuses) => {
          const changes: PendingChange[] = statuses.map((status, i) => change(status, `f${i}.md`))
          const buildDef = (noise: readonly [string, StateDef][]): WorkflowDefinition => ({
            entries: simpleWorkflow.entries,
            states: {
              ...simpleWorkflow.states,
              ...Object.fromEntries(noise),
            },
          })
          const defA = buildDef(noiseA)
          const defB = buildDef(noiseB)
          const run = (def: WorkflowDefinition): StepDecision | string => {
            try {
              return step(def, state, invoker, { changes, processTrace: [] })
            } catch (e) {
              return e instanceof Error ? e.message : String(e)
            }
          }
          expect(run(defA)).toEqual(run(defB))
        },
      ),
      { numRuns: 300 },
    )
  })
})
