import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  contentKindOf,
  initialStateOf,
  isCommitState,
  matchesPattern,
  parsePattern,
  parseStateSubject,
  resolveState,
  stateSubject,
  step,
  validateDefinition,
  type PendingChange,
  type StateDef,
  type StateMode,
  type StepDecision,
  type WorkflowDefinition,
} from "./PatternMachine.js"

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A minimal, valid three-state loop: idle → working → idle (commit). */
const simpleWorkflow: WorkflowDefinition = {
  states: {
    idle: {
      actor: "human",
      message: "waiting",
      initial: true,
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
}

/** A check/fix loop exercising retry: checking ⇄ fixing, capped, redirecting to escalate. */
const retryWorkflow: WorkflowDefinition = {
  states: {
    start: {
      actor: "human",
      message: "go",
      initial: true,
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
}

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

describe("isCommitState", () => {
  it("is true only when `commit` is set", () => {
    expect(isCommitState({ commit: "x" })).toBe(true)
    expect(isCommitState({ prompt: "x" })).toBe(false)
    expect(isCommitState({})).toBe(false)
  })
})

// ── Commit-subject grammar ────────────────────────────────────────────────────

describe("stateSubject / parseStateSubject round trip", () => {
  it("round-trips actor/state pairs", () => {
    expect(parseStateSubject(stateSubject("human", "grilling"))).toEqual({
      actor: "human",
      state: "grilling",
    })
    expect(parseStateSubject(stateSubject("agent", "await-review"))).toEqual({
      actor: "agent",
      state: "await-review",
    })
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseStateSubject("  gtd(human): grilling  \n")).toEqual({
      actor: "human",
      state: "grilling",
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
    // "nobody" is declared by no state in this workflow at all.
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
    // "working" only declares "A DONE.md" and "C" — an unrelated dirty file matches neither.
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
    // "idle" is a human state whose "A TODO.md" edge targets "working", an
    // AGENT state — a cross-actor handoff.
    const decision = step(simpleWorkflow, "idle", "human", {
      changes: [change("A", "TODO.md")],
      processTrace: [],
    })
    expect(decision).toEqual({
      kind: "commit",
      // The subject carries "human" (the invoker), not "working"'s own
      // declared actor ("agent").
      subject: "gtd(human): working",
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
      // declared actor ("human") — resolveState reads the state name alone,
      // so this still resolves back to "idle" on the next invocation.
      subject: "gtd(agent): idle",
      actor: "agent",
      from: "working",
      to: "idle",
    })
  })

  it("is a no-op when no C event is declared", () => {
    // "idle" declares no "C" row.
    const decision = step(simpleWorkflow, "idle", "human", { changes: [], processTrace: [] })
    expect(decision).toEqual({ kind: "noop", state: "idle" })
  })
})

describe("step — first match wins", () => {
  it("picks the first declared pattern that matches, ignoring a later one that would also match", () => {
    const def: WorkflowDefinition = {
      states: {
        s: {
          actor: "human",
          message: "x",
          initial: true,
          on: [
            ["A x.md", "first"],
            ["* *", "second"],
          ],
        },
        first: { commit: "chore: first" },
        second: { commit: "chore: second" },
      },
    }
    // This change matches BOTH rows ("A x.md" and the "* *" catch-all) — the
    // first declared row must win.
    const decision = step(def, "s", "human", {
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
      subject: "gtd(agent): checking",
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
      subject: "gtd(agent): escalate",
      actor: "agent",
      from: "fixing",
      to: "escalate",
    })
  })

  it("counts every occurrence in the trace, regardless of what's interleaved with it", () => {
    // "checking" appears 3 times here — already past its max=2 cap — so this
    // still redirects even though "fixing" entries sit between them.
    const decision = step(retryWorkflow, "fixing", "agent", {
      changes: [change("M", "x.ts")],
      processTrace: ["checking", "fixing", "checking", "fixing", "checking", "fixing"],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): escalate",
      actor: "agent",
      from: "fixing",
      to: "escalate",
    })
  })

  it("resets naturally: an empty process trace (fresh process) never redirects on first entry", () => {
    const decision = step(retryWorkflow, "fixing", "agent", {
      changes: [change("M", "x.ts")],
      processTrace: [],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): checking",
      actor: "agent",
      from: "fixing",
      to: "checking",
    })
  })

  it("applies retry recursively to `otherwise` when it also declares a retry cap", () => {
    const def: WorkflowDefinition = {
      states: {
        s: {
          actor: "human",
          message: "x",
          initial: true,
          on: [["* *", "a"]],
        },
        a: { actor: "human", message: "a", retry: { max: 1, otherwise: "b" }, on: [["* *", "a"]] },
        b: { actor: "human", message: "b", retry: { max: 1, otherwise: "c" }, on: [["* *", "b"]] },
        c: { commit: "chore: c" },
      },
    }
    // "a" is at its cap (1 prior visit) so it redirects to "b" — which is
    // ALSO at its cap (1 prior visit) — so it redirects again to "c".
    const decision = step(def, "s", "human", {
      changes: [change("A", "x")],
      processTrace: ["a", "b"],
    })
    expect(decision).toEqual({ kind: "squash", state: "c", template: "chore: c" })
  })

  it("guards against a redirect cycle: two states whose `otherwise` point at each other terminate rather than loop", () => {
    const def: WorkflowDefinition = {
      states: {
        s: { actor: "human", message: "x", initial: true, on: [["* *", "a"]] },
        a: { actor: "human", message: "a", retry: { max: 0, otherwise: "b" }, on: [["* *", "a"]] },
        b: { actor: "human", message: "b", retry: { max: 0, otherwise: "a" }, on: [["* *", "b"]] },
      },
    }
    // max: 0 means EVERY entry redirects immediately (0 prior visits already
    // satisfies "at least max"). Without the cycle guard this would recurse
    // forever; it must terminate and land on one of the two states.
    const decision = step(def, "s", "human", { changes: [change("A", "x")], processTrace: [] })
    expect(decision.kind).toBe("commit")
    if (decision.kind === "commit") {
      expect(["a", "b"]).toContain(decision.to)
    }
  })
})

// ── Definition validation ─────────────────────────────────────────────────────

describe("validateDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(validateDefinition(simpleWorkflow)).toEqual([])
    expect(validateDefinition(retryWorkflow)).toEqual([])
  })

  it("requires at least one state", () => {
    expect(validateDefinition({ states: {} })).toEqual(["workflow must declare at least one state"])
  })

  it("requires exactly one initial state (zero)", () => {
    const errors = validateDefinition({
      states: { a: { actor: "h", message: "x", on: [] } },
    })
    expect(errors).toContain("workflow must declare exactly one initial state (found 0)")
  })

  it("requires exactly one initial state (more than one)", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, on: [] },
        b: { actor: "h", message: "y", initial: true, on: [] },
      },
    })
    expect(errors.some((e) => e.includes("exactly one initial state"))).toBe(true)
  })

  it("rejects a commit state as the initial state", () => {
    const errors = validateDefinition({
      states: { a: { commit: "chore: a", initial: true } },
    })
    expect(errors).toContain('initial state "a" must not be a commit state')
  })

  it("requires exactly one content kind (zero, and more than one)", () => {
    const zero = validateDefinition({
      states: { a: { actor: "h", initial: true, on: [] } },
    })
    expect(zero.some((e) => e.includes("exactly one of script/prompt/message/commit"))).toBe(true)

    const two = validateDefinition({
      states: { a: { actor: "h", message: "x", script: "y", initial: true, on: [] } },
    })
    expect(two.some((e) => e.includes("exactly one of script/prompt/message/commit"))).toBe(true)
  })

  it("rejects a commit state that declares an actor or `on`", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, on: [["* *", "b"]] },
        b: { commit: "chore: b", actor: "h" },
      },
    })
    expect(errors).toContain('commit state "b" must not declare an actor')
  })

  it("rejects a commit state that declares `on`", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, on: [["* *", "b"]] },
        b: { commit: "chore: b", on: [["* *", "a"]] },
      },
    })
    expect(errors).toContain('commit state "b" must not declare "on"')
  })

  it("requires a non-commit state to declare an actor", () => {
    const errors = validateDefinition({
      states: { a: { message: "x", initial: true, on: [] } },
    })
    expect(errors).toContain('state "a" must declare an actor (only a commit state may omit one)')
  })

  it("rejects an unparseable pattern", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, on: [["nonsense", "a"]] },
      },
    })
    expect(errors.some((e) => e.includes('pattern "nonsense" does not parse'))).toBe(true)
  })

  it("rejects an `on` target that isn't a defined state", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, on: [["* *", "ghost"]] },
      },
    })
    expect(errors).toContain('state "a": "on" target "ghost" is not a defined state')
  })

  it("rejects a `retry.otherwise` that isn't a defined state", () => {
    const errors = validateDefinition({
      states: {
        a: {
          actor: "h",
          message: "x",
          initial: true,
          retry: { max: 1, otherwise: "ghost" },
          on: [["* *", "a"]],
        },
      },
    })
    expect(errors).toContain('state "a": retry.otherwise "ghost" is not a defined state')
  })

  it("accepts a state declaring a valid `model`", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, model: "smart", on: [] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects an empty-string `model`", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, model: "", on: [] },
      },
    })
    expect(errors).toContain('state "a": "model" must be a non-empty string')
  })

  it("rejects a commit state that declares a `model`", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, on: [["* *", "b"]] },
        b: { commit: "chore: b", model: "smart" },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "model"')
  })

  it("aggregates a bad `model` alongside other unrelated findings", () => {
    const errors = validateDefinition({
      states: {
        a: {
          actor: "h",
          message: "x",
          initial: true,
          model: "",
          on: [["* *", "ghost"]],
        },
      },
    })
    expect(errors).toContain('state "a": "model" must be a non-empty string')
    expect(errors).toContain('state "a": "on" target "ghost" is not a defined state')
  })

  it("accepts a state declaring a valid `file` alone (no `mode`)", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, file: ".gtd/FEEDBACK.md", on: [] },
      },
    })
    expect(errors).toEqual([])
  })

  it("accepts a state declaring `file` and a valid `mode`", () => {
    const errors = validateDefinition({
      states: {
        a: {
          actor: "h",
          message: "x",
          initial: true,
          file: ".gtd/TODO.md",
          mode: "qa",
          on: [],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects an empty-string `file`", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, file: "", on: [] },
      },
    })
    expect(errors).toContain('state "a": "file" must be a non-empty string')
  })

  it("rejects a commit state that declares a `file`", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, on: [["* *", "b"]] },
        b: { commit: "chore: b", file: ".gtd/TODO.md" },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "file"')
  })

  it("rejects a `mode` outside the closed vocabulary, naming the allowed values", () => {
    const errors = validateDefinition({
      states: {
        a: {
          actor: "h",
          message: "x",
          initial: true,
          file: ".gtd/TODO.md",
          mode: "yolo" as StateMode,
          on: [],
        },
      },
    })
    expect(errors).toContain('state "a": "mode" must be one of qa, review (got "yolo")')
  })

  it("rejects a `mode` with no sibling `file`", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, mode: "qa", on: [] },
      },
    })
    expect(errors).toContain('state "a": "mode" requires "file"')
  })

  it("rejects a commit state that declares a `mode`", () => {
    const errors = validateDefinition({
      states: {
        a: { actor: "h", message: "x", initial: true, on: [["* *", "b"]] },
        b: { commit: "chore: b", file: ".gtd/TODO.md", mode: "qa" },
      },
    })
    expect(errors).toContain('state "b": a commit state cannot declare "mode"')
  })

  it("aggregates a bad `file`/`mode` alongside other unrelated findings", () => {
    const errors = validateDefinition({
      states: {
        a: {
          actor: "h",
          message: "x",
          initial: true,
          file: "",
          mode: "yolo" as StateMode,
          on: [["* *", "ghost"]],
        },
      },
    })
    expect(errors).toContain('state "a": "file" must be a non-empty string')
    expect(errors).toContain('state "a": "mode" must be one of qa, review (got "yolo")')
    expect(errors).toContain('state "a": "on" target "ghost" is not a defined state')
  })

  it("rejects a negative or non-integer retry.max", () => {
    const negative = validateDefinition({
      states: {
        a: {
          actor: "h",
          message: "x",
          initial: true,
          retry: { max: -1, otherwise: "a" },
          on: [["* *", "a"]],
        },
      },
    })
    expect(negative.some((e) => e.includes("retry.max must be a non-negative integer"))).toBe(true)

    const fractional = validateDefinition({
      states: {
        a: {
          actor: "h",
          message: "x",
          initial: true,
          retry: { max: 1.5, otherwise: "a" },
          on: [["* *", "a"]],
        },
      },
    })
    expect(fractional.some((e) => e.includes("retry.max must be a non-negative integer"))).toBe(
      true,
    )
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
