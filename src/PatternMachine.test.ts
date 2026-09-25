import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  contentKindOf,
  contentOf,
  entryBaseTemplateOf,
  enterableStates,
  initialStateOf,
  inScope,
  isInEachSubtree,
  isRequireRevertState,
  isReviewBaseState,
  manualEntryStates,
  matchesPattern,
  matchRoute,
  memoryScopeAt,
  parsePattern,
  parseStateSubject,
  qualifierIndexAt,
  qualifyAt,
  resolveState,
  stateSubject,
  step,
  stripQualifiers,
  validateDefinition,
  wouldAttempt,
  type PendingChange,
  type RouteAnswer,
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

/** A minimal, valid three-state loop: idle → working → idle, plus a terminal `done` sink. */
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
      actor: "human",
      message: "done",
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
      actor: "human",
      message: "done",
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

// ── contentKindOf / contentOf ─────────────────────────────────────────────────

describe("contentKindOf", () => {
  it("reports the one set content key", () => {
    expect(contentKindOf({ script: "x" })).toBe("script")
    expect(contentKindOf({ prompt: "x" })).toBe("prompt")
    expect(contentKindOf({ message: "x" })).toBe("message")
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

  it("is undefined when no content key is set", () => {
    expect(contentOf({})).toBeUndefined()
  })
})

describe("isReviewBaseState", () => {
  const workflow: WorkflowDefinition = def(
    {
      idle: {
        actor: "human",
        message: "x",
        reviewBase: true,
        on: [["* *", "gate"]],
      },
      gate: { actor: "human", message: "review", on: [["C", "idle"]] },
      plain: { actor: "agent", prompt: "x", on: [["* *", "idle"]] },
    },
    "idle",
  )

  it("reports the reviewBase flag by state name", () => {
    expect(isReviewBaseState(workflow, "idle")).toBe(true)
    expect(isReviewBaseState(workflow, "gate")).toBe(false)
  })

  it("is false for an unknown state name", () => {
    expect(isReviewBaseState(workflow, "ghost")).toBe(false)
  })

  // Spec-review finding: `reviewBaseFor` (`Edge.ts`) walks QUALIFIED trace
  // rows inside an `each:` loop — a bare `def.states[state]` lookup misses
  // the map entirely for a qualified name and silently returns `false`,
  // meaning a loop item's `reviewBase: true` state never anchors the diff
  // base.
  it("strips a qualified state name before the lookup", () => {
    expect(isReviewBaseState(workflow, "idle[2]")).toBe(true)
  })
})

describe("isRequireRevertState", () => {
  const workflow: WorkflowDefinition = def(
    {
      idle: { actor: "human", message: "x", requireRevert: true, on: [["* *", "plain"]] },
      plain: { actor: "agent", prompt: "x", on: [["* *", "idle"]] },
    },
    "idle",
  )

  it("reports the requireRevert flag by state name", () => {
    expect(isRequireRevertState(workflow, "idle")).toBe(true)
    expect(isRequireRevertState(workflow, "plain")).toBe(false)
  })

  it("is false for an unknown state name", () => {
    expect(isRequireRevertState(workflow, "ghost")).toBe(false)
  })

  // Spec-review finding: `snapshotFromRest` (`Edge.ts`) calls this against
  // the resolved rest, which may be QUALIFIED inside an `each:` loop — a
  // qualified name must strip before the lookup or a loop item declaring
  // `requireRevert: true` silently skips the revert probe entirely.
  it("strips a qualified state name before the lookup", () => {
    expect(isRequireRevertState(workflow, "idle[3]")).toBe(true)
  })
})

describe("enterableStates", () => {
  it("lists every declared state, sorted", () => {
    const workflow: WorkflowDefinition = def(
      {
        zebra: { actor: "human", message: "x", on: [["* *", "apple"]] },
        apple: { actor: "human", message: "y", on: [["* *", "zebra"]] },
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

  it("resolves to a state that itself declares no actor — there is no separate exclusion for such a state, only the actor-vocabulary check", () => {
    const workflow: WorkflowDefinition = def(
      {
        a: { actor: "human", message: "x", on: [["* *", "sink"]] },
        sink: { message: "done" },
      },
      "a",
    )
    // "sink" declares no actor of its own, but "human" is still a
    // recognized actor somewhere in the workflow, so resolution lands on
    // "sink" rather than falling back to the initial state.
    expect(resolveState(workflow, "gtd(human): sink")).toBe("sink")
  })

  it("resolves a QUALIFIED state name by its stripped base — the qualifier is preserved on the returned name, not just validated away", () => {
    const workflow: WorkflowDefinition = def(
      {
        picking: { actor: "human", message: "pick", on: [["* *", "item.building"]] },
        "item.building": { actor: "agent", prompt: "build", on: [["* *", "picking"]] },
      },
      "picking",
    )
    expect(resolveState(workflow, "gtd(agent): item[2].building")).toBe("item[2].building")
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
        first: { actor: "human", message: "first" },
        second: { actor: "human", message: "second" },
      },
      "s",
    )
    // This change matches BOTH rows ("A x.md" and the "* *" catch-all) — the
    // first declared row must win.
    const decision = step(workflow, "s", "human", {
      changes: [change("A", "x.md")],
      processTrace: [],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(human): s → first",
      actor: "human",
      from: "s",
      to: "first",
    })
  })
})

describe("step — entering a terminal state", () => {
  it("targeting a state with its own actor and no outbound edges yields an ordinary commit decision", () => {
    const decision = step(simpleWorkflow, "working", "agent", {
      changes: [change("A", "DONE.md")],
      processTrace: [],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): working → done",
      actor: "agent",
      from: "working",
      to: "done",
    })
  })
})

describe("step — structural errors", () => {
  it("throws for an unknown state", () => {
    expect(() =>
      step(simpleWorkflow, "nonexistent", "human", { changes: [], processTrace: [] }),
    ).toThrow(/unknown state/)
  })

  it("throws when invoked at a state that declares no actor", () => {
    const workflow: WorkflowDefinition = def(
      {
        a: { actor: "human", message: "x", on: [["* *", "sink"]] },
        sink: { message: "done" },
      },
      "a",
    )
    expect(() => step(workflow, "sink", "human", { changes: [], processTrace: [] })).toThrow(
      /declares no actor/,
    )
  })

  it("throws when an `on` edge targets a state absent from the definition", () => {
    const workflow: WorkflowDefinition = def(
      { a: { actor: "human", message: "x", on: [["* *", "ghost"]] } },
      "a",
    )
    expect(() =>
      step(workflow, "a", "human", { changes: [change("A", "x.md")], processTrace: [] }),
    ).toThrow(/transitions to undefined state "ghost"/)
  })

  it("throws when an `on` edge targets a state that itself declares no actor", () => {
    const workflow: WorkflowDefinition = def(
      {
        a: { actor: "human", message: "x", on: [["* *", "sink"]] },
        sink: { message: "done" },
      },
      "a",
    )
    expect(() =>
      step(workflow, "a", "human", { changes: [change("A", "x.md")], processTrace: [] }),
    ).toThrow(/"sink" declares no actor/)
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
        c: { actor: "human", message: "c" },
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
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(human): s → c",
      actor: "human",
      from: "s",
      to: "c",
    })
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

// ── routes:-driven routing ───────────────────────────────────────────────────

/**
 * `check` (a `check` actor) has TWO red rows: `A/M PRIOR.md` (a prior round's
 * feedback exists — route to `judge`) and `A/M FEEDBACK.md` (no prior round —
 * bypass `judge` straight to `fix`, "the first red round pays for no
 * judgment"). `judge` carries `routes:` (identical -> escalate, catch-all ->
 * fix) and an ordinary `C` fallback row to `fix` for the "skipped"
 * (no-verdict) case.
 *
 * `retry` stays on `fix`, NOT `judge`: `fix` has TWO direct structural
 * sources — `check`'s own bypass row, and `judge`'s routes catch-all — so
 * `episodeVisits` accumulates across the full check/judge/fix cycle with no
 * reset, exactly like the bundled `fixerRetryWorkflow` shape above. Putting
 * `retry` on `judge` instead does NOT work under `sourcesOf`'s single-hop,
 * non-transitive rule (deliberately pinned by the `fixerRetryWorkflow` tests
 * above, where an incidental single-hop-onward neighbour like `reviewing`
 * must still reset the count): `judge`'s only direct source is `check`, but
 * `fix` sits between every pair of `judge` visits and is NOT one of `judge`'s
 * sources, so `fix` resets `judge`'s count on every single pass and the cap
 * can never fire. `fix` is where the accumulation is actually sound.
 */
const judgeWorkflow: WorkflowDefinition = def(
  {
    check: {
      actor: "check",
      script: "s",
      on: [
        ["A PRIOR.md", "judge"],
        ["M PRIOR.md", "judge"],
        ["A FEEDBACK.md", "fix"],
        ["M FEEDBACK.md", "fix"],
        ["* **", "check"],
        ["C", "check"],
      ],
    },
    judge: {
      actor: "human",
      message: "verdict needed",
      judge: '{"questions":[{"id":"verdict"}]}',
      routes: [{ question: "verdict", is: "identical", to: "escalate" }, { to: "fix" }],
      on: [["C", "fix"]],
    },
    fix: {
      actor: "agent",
      prompt: "fix it",
      retry: { max: 2, otherwise: "escalate" },
      on: [["* *", "check"]],
    },
    escalate: { actor: "human", message: "escalated" },
  },
  "check",
)

describe("step — routes:-driven routing off a `gtd judge answer` verdict", () => {
  it("an answered verdict routes via `routes:`, bypassing `on:` entirely — a catch-all row wins with no matching question", () => {
    const decision = step(judgeWorkflow, "judge", "human", {
      changes: [],
      processTrace: ["check"],
      routeAnswers: [{ id: "verdict", answer: "progress", p: 0.9 }],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(human): judge → fix",
      actor: "human",
      from: "judge",
      to: "fix",
    })
  })

  it("an 'identical' verdict routes straight to escalate, before any retry cap", () => {
    const decision = step(judgeWorkflow, "judge", "human", {
      changes: [],
      processTrace: ["check"],
      routeAnswers: [{ id: "verdict", answer: "identical", p: 0.95 }],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(human): judge → escalate",
      actor: "human",
      from: "judge",
      to: "escalate",
    })
  })

  it("no verdict this call (an ordinary `gtd land`) ignores `routes:` and falls through to the state's own `on:` — the skipped-judgment path", () => {
    const decision = step(judgeWorkflow, "judge", "human", {
      changes: [],
      processTrace: ["check"],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(human): judge → fix",
      actor: "human",
      from: "judge",
      to: "fix",
    })
  })

  it("`shadow: true` ignores a supplied verdict entirely and always falls through to `on:`", () => {
    const shadowed: WorkflowDefinition = def(
      {
        judge: {
          ...judgeWorkflow.states["judge"]!,
          shadow: true,
        },
        escalate: judgeWorkflow.states["escalate"]!,
        fix: judgeWorkflow.states["fix"]!,
      },
      "judge",
    )
    const decision = step(shadowed, "judge", "human", {
      changes: [],
      processTrace: [],
      routeAnswers: [{ id: "verdict", answer: "identical", p: 0.99 }],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(human): judge → fix",
      actor: "human",
      from: "judge",
      to: "fix",
    })
  })

  it("three attempts still force escalation regardless of verdict — fix's retry cap redirects BEFORE a third fix attempt, even on a non-identical verdict", () => {
    // Round 1: check -> fix directly (no PRIOR.md yet, bypasses judge) — 1st
    // fix visit. Round 2: check -> judge -> fix (a "progress" verdict) — 2nd
    // fix visit, meeting fix's own max: 2 cap. This 3rd round's judge routing
    // (still "progress", never "identical") would raw-target "fix" again,
    // but the cap redirects it to "escalate" instead — the verdict itself
    // never said to stop.
    const decision = step(judgeWorkflow, "judge", "human", {
      changes: [],
      processTrace: ["check", "fix", "check", "judge", "fix", "check"],
      routeAnswers: [{ id: "verdict", answer: "progress", p: 0.9 }],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(human): judge → escalate",
      actor: "human",
      from: "judge",
      to: "escalate",
    })
  })

  it("under the cap: the same 'progress' verdict with only one prior fix visit still routes to fix", () => {
    const decision = step(judgeWorkflow, "judge", "human", {
      changes: [],
      processTrace: ["check", "fix", "check"],
      routeAnswers: [{ id: "verdict", answer: "progress", p: 0.9 }],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(human): judge → fix",
      actor: "human",
      from: "judge",
      to: "fix",
    })
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
        done: { actor: "human", message: "done" },
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
        done: { actor: "human", message: "done" },
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

  it("retry.otherwise redirecting a clean-tree attempt off a prompt state still carries the attempt flag — the redirect changes `to`, not attempt-ness", () => {
    const workflow: WorkflowDefinition = def(
      {
        working: {
          actor: "agent",
          prompt: "do it",
          retry: { max: 1, otherwise: "done" },
          on: [],
        },
        done: { actor: "human", message: "done" },
      },
      "working",
    )
    const decision = step(workflow, "working", "agent", {
      changes: [],
      processTrace: ["working"],
    })
    expect(decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): working → done",
      actor: "agent",
      from: "working",
      to: "done",
      attempt: true,
    })
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
        done: { actor: "human", message: "done" },
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
  // `memoryScopeAt` needs a `WorkflowDefinition` only to re-apply an `each:`
  // qualifier onto its resolved scope — none of these rows are qualified, so
  // an `eachRefs`-free definition resolves identically to today's behavior.
  const NO_EACH_DEF: WorkflowDefinition = { states: {}, entries: { default: "", manual: [] } }

  it("a parent scope's unbroken run survives an excursion into child scopes: querying row 12's state over trace 1..11, and querying row 10's state over trace 1..9, both resolve entryIndex to row 8 (index 7)", () => {
    // Rows 9 and 11 are both true dotted descendants of `packages.item`
    // (`packages.item.health`, `packages.item.spec`), so they don't break
    // the run that started at row 8 (`packages.item.building`).
    expect(
      memoryScopeAt(NO_EACH_DEF, scopes, "packages.item.fix-spec", trace.slice(0, 11)),
    ).toEqual({
      scope: "packages.item",
      entryIndex: 7,
    })
    expect(
      memoryScopeAt(NO_EACH_DEF, scopes, "packages.item.fix-suite", trace.slice(0, 9)),
    ).toEqual({
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
    expect(
      memoryScopeAt(NO_EACH_DEF, scopes, "packages.item.spec.review", trace.slice(0, 12)),
    ).toEqual({
      scope: "packages.item.spec",
      entryIndex: 10,
    })
  })

  it("an empty trace resolves to entryIndex: -1 (fresh), not undefined, for a state present in scopes", () => {
    expect(memoryScopeAt(NO_EACH_DEF, scopes, "packages.item.closing", [])).toEqual({
      scope: "packages.item",
      entryIndex: -1,
    })
  })

  it("nothing in the trace ever inside the scope's subtree also falls back to entryIndex: -1", () => {
    expect(
      memoryScopeAt(NO_EACH_DEF, scopes, "packages.item.building", [
        "design.product-author",
        "design.product-answer",
      ]),
    ).toEqual({
      scope: "packages.item",
      entryIndex: -1,
    })
  })

  it("querying a state absent from `scopes` returns undefined entirely", () => {
    expect(memoryScopeAt(NO_EACH_DEF, scopes, "no-such-state", trace.slice(0, 12))).toBeUndefined()
  })

  it("a trace row naming a state absent from `scopes` is skipped, not thrown on, when the QUERIED state is itself present", () => {
    // "ghost" isn't in `scopes`; it sits right before the row that starts
    // the qualifying run, so it correctly counts as "not in scope" for
    // run-continuity purposes without crashing.
    const traceWithGap = ["ghost", "packages.item.building"]
    expect(memoryScopeAt(NO_EACH_DEF, scopes, "packages.item.fix-suite", traceWithGap)).toEqual({
      scope: "packages.item",
      entryIndex: 1,
    })
  })
})

// ── Definition validation ─────────────────────────────────────────────────────

describe("validateDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(validateDefinition(simpleWorkflow).errors).toEqual([])
    expect(validateDefinition(retryWorkflow).errors).toEqual([])
  })

  it("rejects a `file:` outside `.gtd/` — the one case the compiler's prepend can't catch, a hand-built definition that skipped it", () => {
    const { errors } = validateDefinition({
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
      }).errors,
    ).toEqual([])
    expect(
      validateDefinition({
        entries: { default: "a", manual: [] },
        states: { a: { actor: "h", message: "x", file: ".gtd/packages/x.md", on: [] } },
      }).errors,
    ).toEqual([])
  })

  it("requires at least one state", () => {
    expect(
      validateDefinition({ entries: { default: "a", manual: [] }, states: {} }).errors,
    ).toEqual(["workflow must declare at least one state"])
  })

  it("rejects entries.default naming an undefined state", () => {
    const { errors } = validateDefinition({
      entries: { default: "ghost", manual: [] },
      states: { a: { actor: "h", message: "x", on: [] } },
    })
    expect(errors).toContain('entries.default "ghost" is not a defined state')
  })

  it("rejects entries.manual naming an undefined state", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: ["ghost"] },
      states: { a: { actor: "h", message: "x", on: [["* *", "a"]] } },
    })
    expect(errors).toContain('entries.manual "ghost" is not a defined state')
  })

  it("rejects entries.manual equal to entries.default", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: ["a"] },
      states: { a: { actor: "h", message: "x", on: [["* *", "a"]] } },
    })
    expect(errors).toContain('entries.manual "a" must not be the same state as entries.default')
  })

  it("rejects a duplicate state name within entries.manual itself", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: ["b", "b"] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "h", message: "y", on: [["* *", "a"]] },
      },
    })
    expect(errors).toContain('entries.manual declares "b" more than once')
  })

  it("rejects entries.default naming a state inside an each: subtree", () => {
    const { errors } = validateDefinition({
      entries: { default: "item.building", manual: [] },
      states: {
        "item.building": { actor: "agent", prompt: "build", on: [["A DONE.md", "drained"]] },
        drained: { actor: "human", message: "done" },
      },
      eachRefs: { item: { entry: "item.building", drained: "drained" } },
    })
    expect(errors).toContain(
      'entries.default "item.building" is inside an each: reference — a process may not start inside a loop',
    )
  })

  it("rejects entries.manual naming a state inside an each: subtree", () => {
    const { errors } = validateDefinition({
      entries: { default: "drained", manual: ["item.building"] },
      states: {
        "item.building": { actor: "agent", prompt: "build", on: [["A DONE.md", "drained"]] },
        drained: { actor: "human", message: "done" },
      },
      eachRefs: { item: { entry: "item.building", drained: "drained" } },
    })
    expect(errors).toContain(
      'entries.manual "item.building" is inside an each: reference — a process may not be entered inside a loop',
    )
  })

  it("accepts entries that all sit outside every each: subtree", () => {
    const { errors } = validateDefinition({
      entries: { default: "picking", manual: ["drained"] },
      states: {
        picking: { actor: "human", message: "pick", on: [["* *", "item.building"]] },
        "item.building": { actor: "agent", prompt: "build", on: [["A DONE.md", "drained"]] },
        drained: { actor: "human", message: "done" },
      },
      eachRefs: { item: { entry: "item.building", drained: "drained" } },
    })
    expect(errors).toEqual([])
  })

  it("accepts entries with only `default` (an empty `manual`)", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: { a: { actor: "h", message: "x", on: [["* *", "a"]] } },
    })
    expect(errors).toEqual([])
  })

  it("accepts entries.default plus multiple entries.manual, all distinct and valid", () => {
    const { errors } = validateDefinition({
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
    const { errors: zero } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: { a: { actor: "h", on: [] } },
    })
    expect(zero.some((e) => e.includes("exactly one of script/prompt/message"))).toBe(true)

    const { errors: two } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: { a: { actor: "h", message: "x", script: "y", on: [] } },
    })
    expect(two.some((e) => e.includes("exactly one of script/prompt/message"))).toBe(true)
  })

  it("requires a state to declare an actor", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: { a: { message: "x", on: [] } },
    })
    expect(errors).toContain('state "a" must declare an actor')
  })

  it("rejects an unparseable pattern", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["nonsense", "a"]] },
      },
    })
    expect(errors.some((e) => e.includes('pattern "nonsense" does not parse'))).toBe(true)
  })

  it("rejects an `on` target that isn't a defined state", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "ghost"]] },
      },
    })
    expect(errors).toContain('state "a": "on" target "ghost" is not a defined state')
  })

  it("rejects a `retry.otherwise` that isn't a defined state", () => {
    const { errors } = validateDefinition({
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
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", model: "smart", on: [] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects an empty-string `model`", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", model: "", on: [] },
      },
    })
    expect(errors).toContain('state "a": "model" must be a non-empty string')
  })

  it("aggregates a bad `model` alongside other unrelated findings", () => {
    const { errors } = validateDefinition({
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
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", label: "Doing the work", on: [] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects an empty-string `label`", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", label: "", on: [] },
      },
    })
    expect(errors).toContain('state "a": "label" must be a non-empty string')
  })

  it("aggregates a bad `label` alongside other unrelated findings", () => {
    const { errors } = validateDefinition({
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
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", file: ".gtd/FEEDBACK.md", on: [] },
      },
    })
    expect(errors).toEqual([])
  })

  it("accepts a state declaring `file` and a valid `mode`", () => {
    const { errors } = validateDefinition({
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
    const { errors } = validateDefinition({
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
    const { errors } = validateDefinition({
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
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { prose: {} },
      states: {
        a: { actor: "h", message: "x", mode: "prose", on: [] },
      },
    })
    expect(errors).toContain('state "a": "mode" requires "file"')
  })

  it("rejects an empty-string `file`", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", file: "", on: [] },
      },
    })
    expect(errors).toContain('state "a": "file" must be a non-empty string')
  })

  it("rejects a `mode` no `modes:` entry defines, naming what is available", () => {
    const { errors } = validateDefinition({
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
    const { errors: accepted } = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { adr: { validate: "./scripts/check-adr.sh <%= it.file %>" } },
      states: {
        a: { actor: "h", message: "x", file: ".gtd/docs/adr.md", mode: "adr", on: [] },
      },
    })
    expect(accepted).toEqual([])

    const { errors: rejected } = validateDefinition({
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
      }).errors,
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
      }).errors,
    ).toEqual([])
  })

  it("rejects a `modes:` entry that declares a blank command", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { blank: { validate: "   " } },
      states: {
        a: { actor: "h", message: "x", on: [] },
      },
    })
    expect(errors).toEqual(['mode "blank": "validate" must be a non-empty shell command'])
  })

  it("rejects a `mode` with no sibling `file`", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      modes: { qa: {} },
      states: {
        a: { actor: "h", message: "x", mode: "qa", on: [] },
      },
    })
    expect(errors).toContain('state "a": "mode" requires "file"')
  })

  it("accepts a state declaring `reviewBase`", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: {
          actor: "h",
          message: "x",
          reviewBase: true,
          on: [["* *", "b"]],
        },
        b: { actor: "h", message: "review", on: [["C", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("accepts a non-empty string `reviewBase` (the template form)", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", reviewBase: "main", on: [["* *", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects a blank string `reviewBase` template", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", reviewBase: "", on: [["* *", "a"]] },
      },
    })
    expect(errors).toContain('state "a": "reviewBase" template must not be blank')
  })

  it("rejects a whitespace-only string `reviewBase` template", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", reviewBase: "   ", on: [["* *", "a"]] },
      },
    })
    expect(errors).toContain('state "a": "reviewBase" template must not be blank')
  })

  it("accepts entries.manual naming a distinct state", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: ["b"] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "h", message: "review", on: [["C", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("accepts a state declaring `requireProgress` with a `file`", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "a", prompt: "p", file: ".gtd/F.md", requireProgress: true, on: [["C", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects `requireProgress` without a `file`", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "a", prompt: "p", requireProgress: true, on: [["C", "a"]] },
      },
    })
    expect(errors).toContain('state "b": "requireProgress" requires "file"')
  })

  it("accepts a state declaring `requireRevert` with a `file`", () => {
    const { errors } = validateDefinition({
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
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "check", script: "s", requireRevert: true, on: [["C", "a"]] },
      },
    })
    expect(errors).toContain('state "b": "requireRevert" requires "file"')
  })

  it("accepts entries.manual naming a distinct script/check state", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: ["b"] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "check", script: "run", on: [["C", "a"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("treats entries.manual as reachable even with no inbound `on`/`retry` edge (seeded as a root)", () => {
    // "fix-check" has no inbound `on`/`retry` edge from the default entry — it
    // is entered ONLY via `gtd --entry fix-check`, so seeding it
    // as a reachability root is what keeps it from being wrongly flagged
    // unreachable.
    const { errors } = validateDefinition({
      entries: { default: "idle", manual: ["fix-check"] },
      states: {
        idle: { actor: "h", message: "x", on: [["* *", "idle"]] },
        "fix-check": { actor: "check", script: "r", on: [["C", "idle"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("aggregates a bad `file`/`mode` alongside other unrelated findings", () => {
    const { errors } = validateDefinition({
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
    const { errors: negative } = validateDefinition({
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

    const { errors: fractional } = validateDefinition({
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
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "done"]] },
        orphan: { actor: "h", message: "never entered", on: [["* *", "done"]] },
        done: { actor: "h", message: "done" },
      },
    })
    expect(errors).toEqual([
      'state "orphan" is unreachable from any entry state (a) (no "on" target, "routes" target, or "retry.otherwise" leads to it)',
    ])
  })

  it("counts a `retry.otherwise` redirect as a reachability edge", () => {
    // "escalate" is entered ONLY via checking's retry redirect — it must not
    // be reported as unreachable (retryWorkflow's shape, minimized).
    const { errors } = validateDefinition({
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

  it("counts a `routes:` target as a reachability edge — a state reachable only through a judgment is not reported unreachable", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "judging"]] },
        judging: {
          actor: "h",
          message: "verdict?",
          judge: "{}",
          routes: [{ question: "q1", is: "yes", minP: "0.9", to: "proceed" }, { to: "escalate" }],
        },
        proceed: { actor: "h", message: "ok", on: [["* *", "judging"]] },
        escalate: { actor: "h", message: "stuck", on: [["* *", "judging"]] },
      },
    })
    expect(errors).toEqual([])
  })

  it("reports a whole disconnected cluster as unreachable, not just its entry", () => {
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "a"]] },
        b: { actor: "h", message: "b", on: [["* *", "c"]] },
        c: { actor: "h", message: "c", on: [["* *", "b"]] },
      },
    })
    expect(errors).toContain(
      'state "b" is unreachable from any entry state (a) (no "on" target, "routes" target, or "retry.otherwise" leads to it)',
    )
    expect(errors).toContain(
      'state "c" is unreachable from any entry state (a) (no "on" target, "routes" target, or "retry.otherwise" leads to it)',
    )
  })

  it("skips the reachability walk when entries validation already failed", () => {
    // An undefined "entries.default": every state would look "unreachable"
    // from an undefined start — the reachability check must stay silent
    // rather than bury the real finding.
    const { errors } = validateDefinition({
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
    const { errors } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "ghost"]] },
      },
    })
    expect(errors).toEqual(['state "a": "on" target "ghost" is not a defined state'])
  })

  it("fires every per-field rule from src/StateFields.ts's table in one definition (regression guard for the field-table refactor, issue #158)", () => {
    // One fixture violating every per-field rule at once: a state with empty
    // `model`/`label`/`file` and an unknown `mode`; a state whose
    // `mode`/`requireProgress`/`answerGate` all lack the `file` they
    // require; a blank-template `reviewBase`. Guards against a future edit
    // to `STATE_FIELDS` silently dropping a field's `nonEmpty`/`requires`
    // rule.
    const { errors } = validateDefinition({
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
          on: [],
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
  })
})

// `.gtd/packages/03-template-engine-fixes.md`: the load-time scan for a
// disallowed bounded-primitive call must not mistake a comma INSIDE a quoted
// string argument for a second argument separator.
describe("validateDefinition — the bounded-primitive comma scan ignores quoted commas", () => {
  const stateWith = (prompt: string) => ({
    entries: { default: "a", manual: [] },
    states: {
      a: { actor: "agent", prompt, on: [] },
    },
  })

  it("a quoted path containing a comma is not read as a second it.sections argument", () => {
    const { errors } = validateDefinition(stateWith("<%~ it.sections('notes, 2026.md') %>"))
    expect(errors).toEqual([])
  })

  it("a double-quoted path containing a comma is likewise not read as a second argument", () => {
    const { errors } = validateDefinition(stateWith('<%~ it.sections("notes, 2026.md") %>'))
    expect(errors).toEqual([])
  })

  it("a backtick-quoted path containing a comma is likewise not read as a second argument", () => {
    const { errors } = validateDefinition(stateWith("<%~ it.sections(`notes, 2026.md`) %>"))
    expect(errors).toEqual([])
  })

  it("a backslash-escaped quote inside the literal does not end it early, so a later real comma still isn't misread", () => {
    const { errors } = validateDefinition(
      stateWith(String.raw`<%~ it.sections('a \'quoted, path\' here') %>`),
    )
    expect(errors).toEqual([])
  })

  it("a genuine second argument is still refused outside judge:/message:, even when the first argument itself contains parens", () => {
    const { errors } = validateDefinition(
      stateWith("<%~ JSON.stringify(it.sections(it.read('f.md'), 0.5)) %>"),
    )
    expect(errors).toContain(
      'state "a": "prompt" calls it.sections(path, share), which is allowed only in a "judge:" field or a "message:" template',
    )
  })

  it("a one-argument call stays allowed, unflagged, everywhere", () => {
    const { errors } = validateDefinition(
      stateWith("<%~ JSON.stringify(it.sections('notes, 2026.md')) %>"),
    )
    expect(errors).toEqual([])
  })
})

describe("validateDefinition — routes", () => {
  const base = {
    entries: { default: "a", manual: [] },
  } as const

  it("accepts a routes list ending in a bare catch-all row", () => {
    const { errors } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: "{}",
          routes: [{ question: "q1", is: "yes", minP: "0.9", to: "b" }, { to: "c" }],
        },
        b: { actor: "h", message: "b" },
        c: { actor: "h", message: "c" },
      },
    })
    expect(errors).toEqual([])
  })

  it("rejects an empty routes list", () => {
    const { errors } = validateDefinition({
      ...base,
      states: { a: { actor: "h", message: "x", judge: "{}", routes: [] } },
    })
    expect(errors).toEqual(['state "a": "routes" must declare at least one row'])
  })

  it("rejects a routes list with no catch-all row", () => {
    const { errors } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: "{}",
          routes: [{ question: "q1", is: "yes", minP: "0.9", to: "a" }],
        },
      },
    })
    expect(errors).toContain('state "a": "routes" must end with a catch-all row carrying only "to"')
  })

  it("rejects a catch-all row that isn't last", () => {
    const { errors } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: "{}",
          routes: [{ to: "a" }, { question: "q1", is: "yes", minP: "0.9", to: "a" }],
        },
      },
    })
    expect(errors).toContain(
      'state "a": "routes.0" is a catch-all (only "to") but is not the last row',
    )
    expect(errors).toContain('state "a": "routes" must end with a catch-all row carrying only "to"')
  })

  it("rejects a non-catch-all row missing is (question alone isn't enough)", () => {
    const { errors } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: "{}",
          routes: [{ question: "q1", to: "a" }, { to: "a" }],
        },
      },
    })
    expect(errors).toContain('state "a": "routes.0.is" must be a non-empty string')
  })

  it("does NOT require minP on a non-catch-all row — minP/maxP are each independently optional, and a row declaring neither matches at any probability", () => {
    const { errors } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: "{}",
          routes: [{ question: "q1", is: "yes", to: "a" }, { to: "a" }],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it("accepts a non-catch-all row declaring ONLY maxP (no minP) — the exact shape the conjunction-with-a-floor pattern needs", () => {
    const { errors } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: "{}",
          routes: [{ question: "q1", is: "yes", maxP: "0.9", to: "a" }, { to: "a" }],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it("a row carrying ONLY maxP (no question/is/minP) does not misclassify as the catch-all — it still requires question/is, and its declared ceiling is never silently discarded", () => {
    const { errors } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: "{}",
          routes: [{ maxP: "0.9", to: "a" }, { to: "a" }],
        },
      },
    })
    expect(errors).toContain('state "a": "routes.0.question" must be a non-empty string')
    expect(errors).toContain('state "a": "routes.0.is" must be a non-empty string')
  })

  it("rejects a routes row whose `to` names an undefined state", () => {
    const { errors } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: "{}",
          routes: [{ question: "q1", is: "yes", minP: "0.9", to: "ghost" }, { to: "a" }],
        },
      },
    })
    expect(errors).toContain('state "a": "routes.0.to" target "ghost" is not a defined state')
  })

  // The `judge:` question-id cross-check itself (Task 2: "checks every row's
  // `question` against the state's rendered question ids ... failing at load
  // time") — package 01, round-2 review item 3.
  const JUDGE_WITH_VERDICT = '{"state": "x", "questions": [{"id": "verdict"}]}'

  it("rejects a routes.*.question that doesn't name one of judge:'s own declared question ids — the exact failure scenario a typo'd question would otherwise silently degrade to the catch-all", () => {
    const { errors } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: JUDGE_WITH_VERDICT,
          routes: [{ question: "verdcit", is: "identical", minP: "0.9", to: "a" }, { to: "a" }],
        },
      },
    })
    expect(errors).toContain(
      'state "a": "routes.0.question" "verdcit" is not one of this state\'s judge: question ids (verdict)',
    )
  })

  it("accepts a routes.*.question that DOES match one of judge:'s declared question ids, and raises no cross-check warning", () => {
    const { errors, warnings } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: JUDGE_WITH_VERDICT,
          routes: [{ question: "verdict", is: "identical", minP: "0.9", to: "a" }, { to: "a" }],
        },
      },
    })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it("warns (does not error) when judge:'s template can't render/parse under the load-time stub, instead of silently skipping the question-id cross-check with no signal at all", () => {
    // A var reference with no default declared renders the literal string
    // "undefined" (Eta's own behaviour, pinned elsewhere in this repo), which
    // breaks the surrounding JSON — exactly the failure scenario round 2
    // traced: an author interpolates a var into `judge:`'s JSON text and the
    // cross-check silently loses coverage with no error, no warning.
    const { errors, warnings } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: '{"state": "x", "questions": [{"id": <%= it.vars.undeclaredVar %>}]}',
          routes: [{ question: "verdict", is: "identical", minP: "0.9", to: "a" }, { to: "a" }],
        },
      },
    })
    expect(errors).toEqual([])
    expect(warnings).toContain(
      'state "a": "routes.*.question" could not be checked against "judge:"\'s own question ids — the template did not render/parse under a load-time stub (no working-tree/git evidence available yet); a typo\'d question here will not be caught until runtime',
    )
  })

  it("warns (does not error) when a question id is itself DERIVED from it.read(...) — round 4's own false-positive repro: the same evidence-derived id renders to a real string under any single fixed stub, so a single-render check would wrongly cross-check a genuinely correct routes.0.question against it", () => {
    const { errors, warnings } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: '{"state":"s","questions":[{"id": "<%= it.read(".gtd/QID.md").trim() %>"}]}',
          routes: [{ question: "verdict", is: "yes", to: "a" }, { to: "a" }],
        },
      },
    })
    expect(errors).toEqual([])
    expect(warnings).toContain(
      'state "a": "routes.*.question" could not be checked against "judge:"\'s own question ids — the template did not render/parse under a load-time stub (no working-tree/git evidence available yet); a typo\'d question here will not be caught until runtime',
    )
  })

  it("does not warn when routes: declares ONLY a catch-all row — nothing to cross-check against question ids regardless of whether judge: itself renders", () => {
    const { warnings } = validateDefinition({
      ...base,
      states: {
        a: {
          actor: "h",
          message: "x",
          judge: '{"state": "x", "questions": [{"id": <%= it.vars.undeclaredVar %>}]}',
          routes: [{ to: "a" }],
        },
      },
    })
    expect(warnings).toEqual([])
  })

  it("resolves a judge: template's it.vars.<name> reference against the workflow's OWN declared vars: defaults at load time — the only var layer that exists before .gtdrc/entry-commit/env are known", () => {
    const { errors, warnings } = validateDefinition(
      {
        ...base,
        states: {
          a: {
            actor: "h",
            message: "x",
            judge: '{"state": "x", "questions": [{"id": "<%= it.vars.questionName %>"}]}',
            routes: [{ question: "verdict", is: "identical", minP: "0.9", to: "a" }, { to: "a" }],
          },
        },
      },
      { questionName: "verdict" },
    )
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe("matchRoute", () => {
  it("first-match-wins, exactly like matchOn", () => {
    const routes = [
      { question: "q1", is: "yes", minP: "0.5", to: "a" },
      { question: "q1", is: "yes", minP: "0", to: "b" },
      { to: "c" },
    ]
    // The first row already matches ("yes" at p=0.9 clears 0.5) — the second,
    // also-matching row never gets a chance to fire.
    expect(matchRoute(routes, [{ id: "q1", answer: "yes", p: 0.9 }])).toBe("a")
  })

  it("skips a row whose question has no answer, falling through to a later match", () => {
    const routes = [
      { question: "missing", is: "yes", minP: "0", to: "a" },
      { question: "q1", is: "yes", minP: "0", to: "b" },
      { to: "c" },
    ]
    expect(matchRoute(routes, [{ id: "q1", answer: "yes", p: 0.9 }])).toBe("b")
  })

  it("requires the answer's own p to clear minP — below the floor does not match", () => {
    const routes = [{ question: "q1", is: "yes", minP: "0.90", to: "a" }, { to: "b" }]
    expect(matchRoute(routes, [{ id: "q1", answer: "yes", p: 0.89 }])).toBe("b")
    expect(matchRoute(routes, [{ id: "q1", answer: "yes", p: 0.9 }])).toBe("a")
  })

  it("treats an absent minP as a floor of 0 — any reported probability clears it", () => {
    const routes = [{ question: "q1", is: "yes", to: "a" }, { to: "b" }]
    expect(matchRoute(routes, [{ id: "q1", answer: "yes", p: 0 }])).toBe("a")
  })

  it("the catch-all matches regardless of the answer set, including empty", () => {
    expect(matchRoute([{ to: "z" }], [])).toBe("z")
  })

  it("returns undefined when no row matches at all (a hand-built, unvalidated definition with no catch-all)", () => {
    const routes = [{ question: "q1", is: "yes", minP: "0", to: "a" }]
    expect(matchRoute(routes, [{ id: "q1", answer: "no", p: 1 }])).toBeUndefined()
  })

  it('conjunction by inversion: "all three nouls answered yes" — an escape row per noul (any "no" escalates) plus a catch-all that proceeds only once none of them fired', () => {
    // A verdict is a probability; no single row can positively AND three
    // separate questions' conditions (first-match-wins over ONE flat list
    // can't require every row to match at once). The equivalent — and the
    // only expressible — encoding inverts the conjunction: escalate the
    // instant ANY of the three nouls fails, and let the (last, unconditional)
    // catch-all stand for "none of them failed".
    const escalateOnAnyNo = [
      { question: "noul1", is: "no", minP: "0", to: "escalate" },
      { question: "noul2", is: "no", minP: "0", to: "escalate" },
      { question: "noul3", is: "no", minP: "0", to: "escalate" },
      { to: "proceed" },
    ]

    const allYes: readonly RouteAnswer[] = [
      { id: "noul1", answer: "yes", p: 0.95 },
      { id: "noul2", answer: "yes", p: 0.92 },
      { id: "noul3", answer: "yes", p: 0.99 },
    ]
    expect(matchRoute(escalateOnAnyNo, allYes)).toBe("proceed")

    // Flipping ANY single noul to "no" escalates, regardless of which one or
    // where in the answer set it sits.
    for (const flip of ["noul1", "noul2", "noul3"] as const) {
      const withOneNo = allYes.map((a) => (a.id === flip ? { ...a, answer: "no" } : a))
      expect(matchRoute(escalateOnAnyNo, withOneNo)).toBe("escalate")
    }

    // minP also gates a row directly: a row requiring high confidence for a
    // specific noul only fires once that noul clears the floor, letting the
    // SAME escape-row shape additionally guard against a low-confidence
    // "yes" for a question a workflow author chooses to gate this way.
    const escalateOnLowConfidence = [
      { question: "noul1", is: "yes", minP: "0.90", to: "proceed" },
      { to: "escalate" },
    ]
    expect(matchRoute(escalateOnLowConfidence, [{ id: "noul1", answer: "yes", p: 0.5 }])).toBe(
      "escalate",
    )
    expect(matchRoute(escalateOnLowConfidence, [{ id: "noul1", answer: "yes", p: 0.9 }])).toBe(
      "proceed",
    )
  })

  it('conjunction by inversion, WITH a confidence floor: "all three nouls answered yes at p ≥ 0.90" — two escape rows per noul (wrong answer, or right answer under the floor) plus a catch-all', () => {
    // `maxP` (the row's probability CEILING, `<`) is what makes the floor
    // half of the conjunction expressible: an escape row can now say "yes,
    // but not confidently" (`is: "yes", maxP: "0.90"`), not just "no". Per
    // noul this is TWO escape rows (wrong answer at any p; right answer under
    // the floor) instead of one — six escape rows plus the catch-all for
    // three nouls — still "N escape rows plus a catch-all", the shape the
    // package spec's own checkbox names.
    const escalateUnlessAllYesAt90 = [
      { question: "noul1", is: "no", to: "escalate" },
      { question: "noul1", is: "yes", maxP: "0.90", to: "escalate" },
      { question: "noul2", is: "no", to: "escalate" },
      { question: "noul2", is: "yes", maxP: "0.90", to: "escalate" },
      { question: "noul3", is: "no", to: "escalate" },
      { question: "noul3", is: "yes", maxP: "0.90", to: "escalate" },
      { to: "proceed" },
    ]

    // Round 3's own finding: this exact row shape must LOAD, not just
    // resolve correctly through the pure `matchRoute` function — `minP` was
    // wrongly mandatory on every non-catch-all row, so every `maxP`-only
    // escape row above failed `validateDefinition` with "routes.N.minP" must
    // be a non-empty string" even though the row shape it demonstrates is
    // exactly what the package spec's checkbox and `StateFields.ts`'s own
    // "either bound alone is legal" contract prescribe.
    const { errors } = validateDefinition({
      entries: { default: "judging", manual: [] },
      states: {
        judging: {
          actor: "h",
          message: "x",
          judge: '{"state": "x", "questions": [{"id": "noul1"}, {"id": "noul2"}, {"id": "noul3"}]}',
          routes: escalateUnlessAllYesAt90,
        },
        escalate: { actor: "h", message: "escalate" },
        proceed: { actor: "h", message: "proceed" },
      },
    })
    expect(errors).toEqual([])

    const allYesHighConfidence: readonly RouteAnswer[] = [
      { id: "noul1", answer: "yes", p: 0.95 },
      { id: "noul2", answer: "yes", p: 0.92 },
      { id: "noul3", answer: "yes", p: 0.99 },
    ]
    expect(matchRoute(escalateUnlessAllYesAt90, allYesHighConfidence)).toBe("proceed")

    // A "no" on any single noul still escalates, at any confidence.
    for (const flip of ["noul1", "noul2", "noul3"] as const) {
      const withOneNo = allYesHighConfidence.map((a) =>
        a.id === flip ? { ...a, answer: "no" } : a,
      )
      expect(matchRoute(escalateUnlessAllYesAt90, withOneNo)).toBe("escalate")
    }

    // The failure scenario round 2 traced: noul1 = no @ p 0.6 (a LOW-
    // confidence "no"), noul2/noul3 = yes @ 0.99. Without `maxP` this fell
    // through to the catch-all and proceeded on a low-confidence failure —
    // now the `is: "no"` escape row (no `minP` at all: it catches ANY "no")
    // still fires regardless of that answer's own p.
    const lowConfidenceNo: readonly RouteAnswer[] = [
      { id: "noul1", answer: "no", p: 0.6 },
      { id: "noul2", answer: "yes", p: 0.99 },
      { id: "noul3", answer: "yes", p: 0.99 },
    ]
    expect(matchRoute(escalateUnlessAllYesAt90, lowConfidenceNo)).toBe("escalate")

    // A "yes" that doesn't clear the 0.90 floor also escalates.
    const oneLowConfidenceYes: readonly RouteAnswer[] = [
      { id: "noul1", answer: "yes", p: 0.5 },
      { id: "noul2", answer: "yes", p: 0.99 },
      { id: "noul3", answer: "yes", p: 0.99 },
    ]
    expect(matchRoute(escalateUnlessAllYesAt90, oneLowConfidenceYes)).toBe("escalate")

    // Exactly at the floor (0.90) clears it — `minP`'s own `>=` convention,
    // `maxP`'s mirror is `<`, so 0.90 itself is NOT caught by `maxP: "0.90"`.
    const exactlyAtFloor: readonly RouteAnswer[] = [
      { id: "noul1", answer: "yes", p: 0.9 },
      { id: "noul2", answer: "yes", p: 0.99 },
      { id: "noul3", answer: "yes", p: 0.99 },
    ]
    expect(matchRoute(escalateUnlessAllYesAt90, exactlyAtFloor)).toBe("proceed")
  })

  it("a blank (or otherwise non-finite) minP/maxP makes the row fail closed — never match — rather than Number()'s dangerous coercion (blank -> 0, a floor of nothing)", () => {
    // The documented off-switch idiom (`judgeIdenticalMinP: ""`, mirroring
    // `reviewBase: ""`) must DISABLE the row it blanks, not make it fire on
    // any probability — `Number("")` is `0`, which without this guard would
    // do exactly the opposite of what a repo blanking the var intends.
    const blankMinP = [{ question: "q1", is: "yes", minP: "", to: "escalate" }, { to: "proceed" }]
    expect(matchRoute(blankMinP, [{ id: "q1", answer: "yes", p: 0.99 }])).toBe("proceed")

    const blankMaxP = [{ question: "q1", is: "yes", maxP: "", to: "escalate" }, { to: "proceed" }]
    expect(matchRoute(blankMaxP, [{ id: "q1", answer: "yes", p: 0.01 }])).toBe("proceed")

    // A non-numeric var also fails closed, not just a blank one.
    const nonNumericMinP = [
      { question: "q1", is: "yes", minP: "off", to: "escalate" },
      { to: "proceed" },
    ]
    expect(matchRoute(nonNumericMinP, [{ id: "q1", answer: "yes", p: 0.99 }])).toBe("proceed")
  })
})

describe("validateDefinition — missing-C-row warning", () => {
  it("warns exactly once for a non-prompt, non-initial state with no C row, no file, and no catch-all", () => {
    const { errors, warnings } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "check", script: "y", on: [["A x", "a"]] },
      },
    })
    expect(errors).toEqual([])
    expect(warnings).toEqual(['state "b" declares no "C" row'])
  })

  it("does not warn a prompt state with no C row", () => {
    const { warnings } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "coder", prompt: "y", on: [["A x", "a"]] },
      },
    })
    expect(warnings).toEqual([])
  })

  it("does not warn the workflow's initial state, even with no C row", () => {
    const { warnings } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "check", script: "x", on: [["A x", "a"]] },
      },
    })
    expect(warnings).toEqual([])
  })

  it("does not warn a state that declares a C row", () => {
    const { warnings } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "check", script: "y", on: [["C", "a"]] },
      },
    })
    expect(warnings).toEqual([])
  })

  it("still warns a state that declares a `* **` catch-all row — a diff pattern never matches a clean tree, so it says nothing about the clean case", () => {
    const { warnings } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "check", script: "y", on: [["* **", "a"]] },
      },
    })
    expect(warnings).toEqual(['state "b" declares no "C" row'])
  })

  it("still warns a state that declares its own `file:` — its narrow rows are still all diff patterns, none matching a clean tree", () => {
    const { warnings } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: {
          actor: "check",
          script: "y",
          file: ".gtd/REVIEW.md",
          on: [["D .gtd/REVIEW.md", "a"]],
        },
      },
    })
    expect(warnings).toEqual(['state "b" declares no "C" row'])
  })

  it("does not warn a human-actor state with no C row — docs/driver.md lands its opening beat unconditionally on every restart while a process rests there, which a C row would turn into a real commit", () => {
    const { warnings } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "check", script: "x", on: [["A x", "b"]] },
        b: { actor: "human", message: "y", on: [["* **", "a"]] },
      },
    })
    expect(warnings).toEqual([])
  })

  it("still warns a non-human, non-prompt, non-initial state with no C row even when its own actor kind isn't check", () => {
    const { warnings } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "agent", message: "y", on: [["A x", "a"]] },
      },
    })
    expect(warnings).toEqual(['state "b" declares no "C" row'])
  })

  it("never surfaces a warning as an error", () => {
    const { errors, warnings } = validateDefinition({
      entries: { default: "a", manual: [] },
      states: {
        a: { actor: "h", message: "x", on: [["* *", "b"]] },
        b: { actor: "check", script: "y", on: [["A x", "a"]] },
      },
    })
    expect(warnings.length).toBeGreaterThan(0)
    expect(errors).toEqual([])
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

// ── Task 1: the qualifier and its normalization ────────────────────────────

describe("stripQualifiers / qualifierIndexAt / qualifyAt — round trip", () => {
  it("stripQualifiers removes every [n] segment", () => {
    expect(stripQualifiers("packages[2].building")).toBe("packages.building")
    expect(stripQualifiers("packages.item[10].spec.review")).toBe("packages.item.spec.review")
    expect(stripQualifiers("packages.building")).toBe("packages.building")
  })

  it("qualifierIndexAt reads the index at refPath's own segment, undefined elsewhere", () => {
    expect(qualifierIndexAt("packages.item[2].building", "packages.item")).toBe(2)
    expect(qualifierIndexAt("packages.item.building", "packages.item")).toBeUndefined()
    expect(qualifierIndexAt("packages.building", "packages.item")).toBeUndefined()
  })

  it("qualifyAt then stripQualifiers round-trips to the original base name, for any index", () => {
    fc.assert(
      fc.property(fc.nat(50), (index) => {
        const base = "packages.item.building"
        const qualified = qualifyAt(base, "packages.item", index)
        expect(stripQualifiers(qualified)).toBe(base)
        expect(qualifierIndexAt(qualified, "packages.item")).toBe(index)
      }),
    )
  })
})

describe("isInEachSubtree / manualEntryStates", () => {
  const eachDef: WorkflowDefinition = {
    entries: { default: "picking", manual: ["picking", "aborted"] },
    states: {
      picking: { actor: "human", message: "pick", on: [["* *", "item.building"]] },
      "item.building": { actor: "agent", prompt: "build", on: [["A DONE.md", "drained"]] },
      drained: { actor: "human", message: "done" },
      aborted: { actor: "human", message: "aborted" },
    },
    eachRefs: { item: { entry: "item.building", drained: "drained" } },
  }

  it("a state inside the each: subtree reports in, one outside reports out", () => {
    expect(isInEachSubtree(eachDef, "item.building")).toBe(true)
    expect(isInEachSubtree(eachDef, "item[3].building")).toBe(true)
    expect(isInEachSubtree(eachDef, "drained")).toBe(false)
    expect(isInEachSubtree(eachDef, "picking")).toBe(false)
  })

  it("manualEntryStates withholds every each: subtree base name enterableStates still lists", () => {
    expect(enterableStates(eachDef)).toContain("item.building")
    expect(manualEntryStates(eachDef)).not.toContain("item.building")
    expect(manualEntryStates(eachDef)).toEqual(
      enterableStates(eachDef).filter((s) => s !== "item.building"),
    )
  })
})

describe("Edge.ts's resumed-memory scan does not crash on a qualified trace row", () => {
  it("memoryScopeAt strips a qualified state/trace row before its scopes[] lookup", () => {
    const scopes = { "packages.item.building": "packages.item" }
    const def: WorkflowDefinition = {
      states: {},
      entries: { default: "", manual: [] },
      eachRefs: { "packages.item": { entry: "packages.item.building", drained: "drained" } },
    }
    expect(() =>
      memoryScopeAt(def, scopes, "packages.item[2].building", ["packages.item[1].building"]),
    ).not.toThrow()
    expect(memoryScopeAt(def, scopes, "packages.item[2].building", [])).toEqual({
      scope: "packages.item[2]",
      entryIndex: -1,
    })
  })
})

// ── Task 3 / Task 5: advancing a loop with no beat, per-item retry budget ──

/**
 * A one-item-machine loop: `picking` enters `item.building` (retry-capped,
 * redirecting straight to `drained` once capped — Task 3's own ordering
 * test); a clean `item.building` completes to `item.review`; `item.review`
 * exits to `drained`, the reference's own `drained:` target — the only edge
 * that ADVANCES the loop. `item.escalate` is a second, unrelated exit that is
 * NOT `drained:`, reachable only by hand-crafting a decision in a test below.
 */
const eachLoopDef: WorkflowDefinition = {
  entries: { default: "picking", manual: [] },
  states: {
    picking: { actor: "human", message: "pick", on: [["* *", "item.building"]] },
    "item.building": {
      actor: "agent",
      prompt: "build it",
      retry: { max: 1, otherwise: "drained" },
      on: [["A DONE.md", "item.review"]],
    },
    "item.review": { actor: "human", message: "review", on: [["* *", "drained"]] },
    drained: { actor: "human", message: "no more items" },
  },
  eachRefs: { item: { entry: "item.building", drained: "drained" } },
}

const eachItems = { item: ["a", "b"] }

describe("step — each: loop advance", () => {
  it("a fresh entry (from outside the subtree) qualifies the reference's entry state with index 0", () => {
    const decision = step(eachLoopDef, "picking", "human", {
      changes: [change("M", "x")],
      processTrace: [],
      eachItems,
    })
    expect(decision).toMatchObject({ kind: "commit", to: "item[0].building" })
  })

  it("continuing within the same item's own machine reuses the current index", () => {
    const decision = step(eachLoopDef, "item[0].building", "agent", {
      changes: [change("A", "DONE.md")],
      processTrace: ["item[0].building"],
      eachItems,
    })
    expect(decision).toMatchObject({ kind: "commit", to: "item[0].review" })
  })

  it("reaching the reference's drained: target with items remaining advances to the NEXT item's entry, in the same decision", () => {
    const decision = step(eachLoopDef, "item[0].review", "human", {
      changes: [change("M", "x")],
      processTrace: ["item[0].building", "item[0].review"],
      eachItems,
    })
    expect(decision).toMatchObject({
      kind: "commit",
      from: "item[0].review",
      to: "item[1].building",
    })
  })

  it("reaching drained: on the LAST item stands — the loop ends there", () => {
    const decision = step(eachLoopDef, "item[1].review", "human", {
      changes: [change("M", "x")],
      processTrace: ["item[0].building", "item[0].review", "item[1].building", "item[1].review"],
      eachItems,
    })
    expect(decision).toMatchObject({ kind: "commit", to: "drained" })
  })

  it("an empty item list routes the entering land straight to drained:, no item state ever a rest", () => {
    const decision = step(eachLoopDef, "picking", "human", {
      changes: [change("M", "x")],
      processTrace: [],
      eachItems: { item: [] },
    })
    expect(decision).toMatchObject({ kind: "commit", from: "picking", to: "drained" })
  })

  it("the drain-advance rewrite runs AFTER retry-cap redirection: an exhausted retry whose otherwise IS the drained: target still advances to the next item in one decision", () => {
    // item[0].building's own cap is max:1 — one PRIOR visit already spends it.
    const decision = step(eachLoopDef, "item[0].building", "agent", {
      changes: [],
      processTrace: ["item[0].building"],
      eachItems,
    })
    expect(decision).toMatchObject({
      kind: "commit",
      from: "item[0].building",
      to: "item[1].building",
      attempt: true,
    })
  })

  it("a target leaving the subtree that is NOT drained: stands verbatim and ends the loop", () => {
    // Simulate an edge routing `item.review` to an unrelated exit instead of
    // `drained:` — remaining items must never be built.
    const abortDef: WorkflowDefinition = {
      ...eachLoopDef,
      states: {
        ...eachLoopDef.states,
        "item.review": { actor: "human", message: "review", on: [["* *", "aborted"]] },
        aborted: { actor: "human", message: "aborted" },
      },
    }
    const decision = step(abortDef, "item[0].review", "human", {
      changes: [change("M", "x")],
      processTrace: ["item[0].building", "item[0].review"],
      eachItems,
    })
    expect(decision).toMatchObject({ kind: "commit", to: "aborted" })
  })

  it("a retry.otherwise on a state OUTSIDE the subtree that redirects INTO it is a fresh entry, carrying enteredEachRef (spec-review round 3)", () => {
    // `picking` itself is capped: its own raw `on:` target ("picking", a
    // self-loop attempt) is not in any each: subtree, so the OLD
    // raw-pre-retry-target-only computation of `enteredEachRef` missed this
    // case entirely — the retry redirect (not the raw target) is what
    // freshly enters `item`'s subtree.
    const capturingPickingDef: WorkflowDefinition = {
      ...eachLoopDef,
      states: {
        ...eachLoopDef.states,
        picking: {
          actor: "human",
          message: "pick",
          retry: { max: 1, otherwise: "item.building" },
          on: [["* *", "picking"]],
        },
      },
    }
    const decision = step(capturingPickingDef, "picking", "human", {
      changes: [change("M", "x")],
      processTrace: ["picking"],
      eachItems,
    })
    expect(decision).toMatchObject({
      kind: "commit",
      from: "picking",
      to: "item[0].building",
      enteredEachRef: "item",
    })
  })

  describe("two each: references chained by drained: — spec-review round 4", () => {
    // A's own `drained:` target is literally B's entry state — the natural
    // way to author "a process running two loops in sequence" (Task 2).
    const twoLoopDef: WorkflowDefinition = {
      entries: { default: "start", manual: [] },
      states: {
        start: { actor: "human", message: "start", on: [["* *", "A.build"]] },
        "A.build": { actor: "agent", prompt: "build A", on: [["A DONE.md", "B.build"]] },
        "B.build": { actor: "agent", prompt: "build B", on: [["A DONE.md", "done"]] },
        done: { actor: "human", message: "done" },
      },
      eachRefs: {
        A: { entry: "A.build", drained: "B.build" },
        B: { entry: "B.build", drained: "done" },
      },
    }

    it("loop A empty: the entering commit qualifies straight into loop B (not a bare state) and carries B's own snapshot, not A's", () => {
      const decision = step(twoLoopDef, "start", "human", {
        changes: [change("M", "x")],
        processTrace: [],
        eachItems: { A: [], B: ["b1", "b2"] },
      })
      expect(decision).toMatchObject({
        kind: "commit",
        from: "start",
        to: "B[0].build",
        enteredEachRef: "B",
      })
    })

    it("loop A empty, loop B ALSO empty: chains straight through to the ordinary exit, carrying B's (not A's) empty-list entry", () => {
      const decision = step(twoLoopDef, "start", "human", {
        changes: [change("M", "x")],
        processTrace: [],
        eachItems: { A: [], B: [] },
      })
      expect(decision).toMatchObject({
        kind: "commit",
        from: "start",
        to: "done",
        enteredEachRef: "B",
      })
    })

    it("an A-advance commit (item 0 -> item 1, still inside A) carries NO enteredEachRef, even though the pre-advance target briefly qualified as a fresh entry into B", () => {
      const decision = step(twoLoopDef, "A[0].build", "agent", {
        changes: [change("A", "DONE.md")],
        processTrace: ["A[0].build"],
        eachItems: { A: ["a1", "a2"], B: ["b1"] },
      })
      expect(decision).toMatchObject({
        kind: "commit",
        from: "A[0].build",
        to: "A[1].build",
      })
      expect(decision).not.toHaveProperty("enteredEachRef")
    })

    it("loop A has items remaining and loop B's snapshotted list is empty: A still advances to its next item instead of being silently skipped", () => {
      // B being empty makes `qualifyLoopTarget` chain A's own `drained:`
      // ("B.build") straight through to B's `drained:` ("done") — the
      // resolved target `applyEachDrainAdvance` sees is "done", which is
      // neither A's nor B's OWN `drained:` string. Without threading the
      // pre-chain target ("B.build", exactly A's `drained:`) through, A never
      // advances and its second item is silently dropped.
      const decision = step(twoLoopDef, "A[0].build", "agent", {
        changes: [change("A", "DONE.md")],
        processTrace: ["A[0].build"],
        eachItems: { A: ["a1", "a2"], B: [] },
      })
      expect(decision).toMatchObject({
        kind: "commit",
        from: "A[0].build",
        to: "A[1].build",
      })
      expect(decision).not.toHaveProperty("enteredEachRef")
    })

    it("loop A drains for real (last item done): enters loop B fresh, qualified, with B's own snapshot", () => {
      const decision = step(twoLoopDef, "A[0].build", "agent", {
        changes: [change("A", "DONE.md")],
        processTrace: ["A[0].build"],
        eachItems: { A: ["a1"], B: ["b1", "b2"] },
      })
      expect(decision).toMatchObject({
        kind: "commit",
        from: "A[0].build",
        to: "B[0].build",
        enteredEachRef: "B",
      })
    })
  })

  it("restart re-derivation: resolving the same (state, trace) twice with no intervening land yields the identical decision", () => {
    const payload = {
      changes: [change("M", "x")],
      processTrace: ["item[0].building", "item[0].review"],
      eachItems,
    }
    const first = step(eachLoopDef, "item[0].review", "human", payload)
    const second = step(eachLoopDef, "item[0].review", "human", payload)
    expect(second).toEqual(first)
  })

  it("an item passing through its own machine three times (retry/self-loop) is not counted as consumed more than once — only reaching drained: advances", () => {
    // item[0] bounces building -> review -> (back to building, hand-authored
    // as if a feedback edge existed) three times before finally draining;
    // only the FINAL drained: transition should land on item[1].
    const bouncy: WorkflowDefinition = {
      ...eachLoopDef,
      states: {
        ...eachLoopDef.states,
        "item.review": {
          actor: "human",
          message: "review",
          on: [
            ["A REDO.md", "item.building"],
            ["* *", "drained"],
          ],
        },
      },
    }
    const trace = [
      "item[0].building",
      "item[0].review",
      "item[0].building",
      "item[0].review",
      "item[0].building",
    ]
    const decision = step(bouncy, "item[0].building", "agent", {
      changes: [change("A", "DONE.md")],
      processTrace: trace,
      eachItems,
    })
    expect(decision).toMatchObject({ kind: "commit", to: "item[0].review" })
    const finalDecision = step(bouncy, "item[0].review", "human", {
      changes: [change("M", "x")],
      processTrace: [...trace, "item[0].review"],
      eachItems,
    })
    expect(finalDecision).toMatchObject({ kind: "commit", to: "item[1].building" })
  })
})

describe("step — two each: refs sharing one drained: target (spec-review finding)", () => {
  // `alpha` and `beta` both drain to "done" — `applyEachDrainAdvance` must
  // match on the ref whose SUBTREE the current state sits inside, not just
  // any ref sharing the same `drained:` string; the buggy version did
  // `return target` on the FIRST ref in iteration order whose current-state
  // qualifier lookup came back `undefined`, silently ending every OTHER
  // ref's loop after its own item 0.
  const twoRefsDef: WorkflowDefinition = {
    entries: { default: "picking", manual: [] },
    states: {
      picking: { actor: "human", message: "pick", on: [["* *", "alpha.building"]] },
      "alpha.building": { actor: "agent", prompt: "a", on: [["A DONE.md", "done"]] },
      "beta.building": { actor: "agent", prompt: "b", on: [["A DONE.md", "done"]] },
      done: { actor: "human", message: "done" },
    },
    eachRefs: {
      alpha: { entry: "alpha.building", drained: "done" },
      beta: { entry: "beta.building", drained: "done" },
    },
  }

  it("beta's own drain-advance fires even though alpha (first in eachRefs) also drains to done", () => {
    const decision = step(twoRefsDef, "beta[0].building", "agent", {
      changes: [change("A", "DONE.md")],
      processTrace: ["beta[0].building"],
      eachItems: { alpha: ["a1"], beta: ["b1", "b2"] },
    })
    expect(decision).toMatchObject({ kind: "commit", to: "beta[1].building" })
  })

  it("beta drains for real (no items left) once alpha is exhausted too, and alpha's own drain is unaffected", () => {
    const betaDone = step(twoRefsDef, "beta[0].building", "agent", {
      changes: [change("A", "DONE.md")],
      processTrace: ["beta[0].building"],
      eachItems: { alpha: ["a1"], beta: ["b1"] },
    })
    expect(betaDone).toMatchObject({ kind: "commit", to: "done" })

    const alphaAdvance = step(twoRefsDef, "alpha[0].building", "agent", {
      changes: [change("A", "DONE.md")],
      processTrace: ["alpha[0].building"],
      eachItems: { alpha: ["a1", "a2"], beta: ["b1"] },
    })
    expect(alphaAdvance).toMatchObject({ kind: "commit", to: "alpha[1].building" })
  })
})

describe("step — per-item retry budget (Task 5)", () => {
  const budgetDef: WorkflowDefinition = {
    entries: { default: "picking", manual: [] },
    states: {
      picking: { actor: "human", message: "pick", on: [["* *", "item.building"]] },
      "item.building": {
        actor: "agent",
        prompt: "build it",
        retry: { max: 2, otherwise: "item.escalate" },
        on: [["A DONE.md", "item.review"]],
      },
      "item.escalate": { actor: "human", message: "stuck", on: [["* *", "aborted"]] },
      "item.review": { actor: "human", message: "review", on: [["* *", "drained"]] },
      drained: { actor: "human", message: "no more items" },
      aborted: { actor: "human", message: "aborted" },
    },
    eachRefs: { item: { entry: "item.building", drained: "drained" } },
  }

  it("max: 2 exhausts within one item and redirects to its own otherwise:, ending the loop (escalate is not drained:)", () => {
    const decision = step(budgetDef, "item[0].building", "agent", {
      changes: [],
      processTrace: ["item[0].building", "item[0].building"],
      eachItems,
    })
    expect(decision).toMatchObject({ kind: "commit", to: "item[0].escalate" })
  })

  it("the NEXT item starts with a full budget of two, even though the previous item's own cap exhausted", () => {
    // item[1] has never visited `item.building` at all — two prior visits
    // belong to item[0]'s qualified name, which never string-matches item[1]'s.
    const decision = step(budgetDef, "item[1].building", "agent", {
      changes: [],
      processTrace: ["item[0].building", "item[0].building"],
      eachItems,
    })
    expect(decision).toMatchObject({ kind: "commit", to: "item[1].building", attempt: true })
  })

  it("a trace row from a sibling BASE state still resets the counter across items, as it does today", () => {
    // `item.review` is not a source of `item.building` in this workflow, so
    // an interleaved review breaks the episode exactly like an unrelated red.
    const decision = step(budgetDef, "item[0].building", "agent", {
      changes: [],
      processTrace: ["item[0].building", "item[0].review", "item[0].building"],
      eachItems,
    })
    // Only one CONSECUTIVE visit survives the reset — cap of 2 not yet hit.
    expect(decision).toMatchObject({ kind: "commit", to: "item[0].building", attempt: true })
  })
})

// ── Task 4: per-item memory scope (session id falls out of the scope string) ─

describe("memoryScopeAt — per-item scope (Task 4)", () => {
  const scopes = { "item.building": "item", "item.review": "item" }
  const eachDef: WorkflowDefinition = {
    states: {},
    entries: { default: "", manual: [] },
    eachRefs: { item: { entry: "item.building", drained: "drained" } },
  }

  it("two consecutive items resolve to DIFFERENT scopes (and so, different session ids)", () => {
    const item0 = memoryScopeAt(eachDef, scopes, "item[0].building", [])
    const item1 = memoryScopeAt(eachDef, scopes, "item[1].building", [])
    expect(item0?.scope).toBe("item[0]")
    expect(item1?.scope).toBe("item[1]")
    expect(item0?.scope).not.toBe(item1?.scope)
  })

  it("an item's building -> fix -> fix sequence resolves to the SAME scope across every turn", () => {
    const trace = ["item[0].building", "item[0].review", "item[0].building"]
    const first = memoryScopeAt(eachDef, scopes, "item[0].review", trace.slice(0, 1))
    const second = memoryScopeAt(eachDef, scopes, "item[0].review", trace)
    expect(first?.scope).toBe("item[0]")
    expect(second?.scope).toBe("item[0]")
  })

  it("a restart mid-item (same state, same trace) re-derives the identical scope — no stored pointer needed", () => {
    const trace = ["item[0].building"]
    const a = memoryScopeAt(eachDef, scopes, "item[0].building", trace)
    const b = memoryScopeAt(eachDef, scopes, "item[0].building", trace)
    expect(a).toEqual(b)
  })

  // Spec-review finding: the scan compared BASE scopes for every trace row,
  // so item 0's own rows read as "inside item N+1's scope" too (same base
  // scope "item"), and `entryIndex` never reset at the item boundary —
  // `Edge.ts`'s `memoryResumedFor` would then read item N+1's very first
  // turn as "a prior turn in this scope", claiming `resume: true` on a
  // session id that was never created.
  it("a prior item's rows do NOT count toward the NEXT item's entryIndex — the run resets at the item boundary", () => {
    const trace = ["item[0].building", "item[0].review"]
    // Nothing in `trace` is inside item[1]'s subtree, so entryIndex must
    // fall back to -1 (fresh), not leak item 0's own entry position (0).
    expect(memoryScopeAt(eachDef, scopes, "item[1].building", trace)).toEqual({
      scope: "item[1]",
      entryIndex: -1,
    })
  })
})
