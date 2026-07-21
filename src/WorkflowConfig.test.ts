import { afterEach, describe, expect, it } from "vitest"
import { activateWorkflowConfig, compileWorkflowConfig } from "./WorkflowConfig.js"
import { activeWorkflow, defaultWorkflow, setActiveWorkflow } from "./Workflow.js"
import { DEFAULT_PAYLOAD, resolve } from "./Machine.js"
import { parseSubject } from "./Subjects.js"
import { buildPrompt } from "./Prompt.js"

// The active definition is module state shared by every test in this file —
// always reset, even when a test throws.
afterEach(() => setActiveWorkflow(defaultWorkflow))

describe("compileWorkflowConfig — merge over the default", () => {
  it("an empty config compiles to the default machine's shape", () => {
    const def = compileWorkflowConfig({})
    expect(Object.keys(def.states).sort()).toEqual(Object.keys(defaultWorkflow.states).sort())
    expect(def.actors).toEqual(defaultWorkflow.actors)
    expect(def.turnRules.length).toBe(defaultWorkflow.turnRules.length)
    expect(def.entry).toBe(defaultWorkflow.entry)
  })

  it("a state override replaces that state and leaves the rest untouched", () => {
    const def = compileWorkflowConfig({
      states: {
        fixing: {
          kind: "prompt",
          awaits: "agent",
          prompts: { agent: "Fix it. <%~ it.context.feedbackContent %>" },
          captureRules: [{ label: "fixing", consumeFeedback: true }],
        },
      },
    })
    expect(def.states["fixing"]!.prompts!["agent"]).toContain("Fix it.")
    expect(def.states["building"]).toBe(defaultWorkflow.states["building"])
  })

  it("a turn-rule override replaces the (actor, gate) row; new rows append", () => {
    const def = compileWorkflowConfig({
      turnRules: [
        {
          actor: "agent",
          gate: "building",
          branches: [{ to: { rest: { state: "idle", actor: "check" } } }],
        },
        {
          actor: "human",
          gate: "note",
          branches: [{ to: { rest: { state: "idle", actor: "check" } } }],
        },
      ],
    })
    expect(def.turnRules.length).toBe(defaultWorkflow.turnRules.length + 1)
    const overridden = def.turnRules.find((r) => r.actor === "agent" && r.gate === "building")!
    expect(overridden.branches[0]!.to).toEqual({ kind: "rest", state: "idle", actor: "check" })
  })
})

describe("compileWorkflowConfig — guards and stamps", () => {
  it("compiles fact/all/not/counterAtLeast guards against the payload", () => {
    const def = compileWorkflowConfig({
      states: {
        testing: {
          kind: "prompt",
          awaits: "check",
          prompts: { check: "@run-test" },
          captureRules: [
            {
              when: {
                all: [
                  { fact: "feedbackPresent" },
                  { counterAtLeast: { counter: "testFix", limit: "fixAttemptCap" } },
                ],
              },
              label: "escalated",
            },
            {
              when: { fact: "feedbackPresent" },
              label: "test-failed",
              stamp: { add: { testFix: 1 } },
            },
          ],
        },
      },
    })
    const rules = def.states["testing"]!.captureRules!
    const atCap = {
      ...DEFAULT_PAYLOAD,
      feedbackPresent: true,
      counters: { testFixCount: 3, reviewFixCount: 0, healthFixCount: 0 },
    }
    expect(rules[0]!.when!(atCap)).toBe(true)
    expect(rules[0]!.when!({ ...atCap, counters: { ...atCap.counters, testFixCount: 2 } })).toBe(
      false,
    )
    expect(rules[1]!.stamp!(atCap.counters, atCap)).toEqual({
      testFixCount: 4,
      reviewFixCount: 0,
      healthFixCount: 0,
    })
  })

  it("rejects an unknown fact and a context-inappropriate atom at load time", () => {
    expect(() =>
      compileWorkflowConfig({
        states: {
          idle: {
            kind: "prompt",
            awaits: "check",
            captureRules: [{ when: { fact: "nope" }, label: "x" }],
          },
        },
      }),
    ).toThrow(/unknown fact "nope"/)
    expect(() =>
      compileWorkflowConfig({
        routingRules: {
          testing: [
            {
              when: { counterAtLeast: { counter: "testFix", limit: 1 } },
              to: { rest: { state: "idle", actor: "check" } },
            },
          ],
        },
      }),
    ).toThrow(/counterAtLeast is not available/)
  })

  it("rejects undeclared actor/state references", () => {
    expect(() =>
      compileWorkflowConfig({
        states: { lounge: { kind: "prompt", awaits: "butler" } },
      }),
    ).toThrow(/undeclared actor "butler"/)
    expect(() =>
      compileWorkflowConfig({
        turnRules: [
          {
            actor: "agent",
            gate: "building",
            branches: [{ to: { rest: { state: "nowhere", actor: "agent" } } }],
          },
        ],
      }),
    ).toThrow(/undeclared state "nowhere"/)
  })
})

describe("a from-scratch machine (extends: none)", () => {
  const noteMachine = {
    extends: "none" as const,
    actors: [{ name: "human", kind: "interactive" as const }],
    entry: [{ gate: "note" }],
    states: {
      idle: { kind: "prompt" as const, awaits: "human", prompts: { human: "Nothing to note." } },
      noting: {
        kind: "prompt" as const,
        awaits: "human",
        prompts: { human: "Write your note, then run gtd step human." },
        captureRules: [{ label: "note" }],
      },
    },
    turnRules: [
      {
        actor: "human",
        gate: "note",
        branches: [{ to: { rest: { state: "noting", actor: "human" } } }],
      },
    ],
    fallback: [
      {
        when: { noSteeringFiles: true },
        branches: [{ to: { rest: { state: "idle", actor: "human" } } }],
      },
    ],
  }

  it("activates, steers the grammar, resolves, and renders its inline prompt", () => {
    activateWorkflowConfig(noteMachine)
    expect(activeWorkflow().actors.map((a) => a.name)).toEqual(["human"])
    // The grammar derives from the active definition: the custom gate parses,
    // default-only vocabulary is a boundary now.
    expect(parseSubject("gtd(human): note")).toEqual({ kind: "turn", actor: "human", gate: "note" })
    expect(parseSubject("gtd(agent): building").kind).toBe("boundary")
    // A dirty boundary tree enters at the configured gate...
    const entry = resolve([
      {
        type: "RESOLVE",
        payload: { ...DEFAULT_PAYLOAD, invoker: "human", workingTreeClean: false },
      },
    ])
    expect(entry.edgeAction).toMatchObject({ kind: "captureTurn", actor: "human", gate: "note" })
    // ...and the landed turn rests at the custom state with its inline prompt.
    const rest = resolve([
      {
        type: "RESOLVE",
        payload: {
          ...DEFAULT_PAYLOAD,
          lastCommitSubject: "gtd(human): note",
          workingTreeClean: true,
        },
      },
    ])
    expect(rest.state).toBe("noting")
    expect(buildPrompt(rest)).toContain("Write your note, then run gtd step human.")
  })

  it("resets to the default when the workflow key is absent", () => {
    activateWorkflowConfig(noteMachine)
    activateWorkflowConfig(undefined)
    expect(activeWorkflow()).toBe(defaultWorkflow)
    expect(parseSubject("gtd(agent): building").kind).toBe("turn")
  })
})
