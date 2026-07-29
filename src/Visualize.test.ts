import { describe, expect, it } from "vitest"
import { compileWorkflowConfig } from "./PatternConfig.js"
import { buildVizModel, handleVizRequest } from "./Visualize.js"

// A small workflow authored with a sub-machine, so we exercise both the
// compiled (flat) states AND the raw sub-machine grouping.
const raw = {
  submachines: {
    gate: {
      params: ["onGreen"],
      states: {
        check: {
          actor: "check",
          script: "run",
          on: { "A .gtd/FEEDBACK.md": "blocked", C: "$onGreen" },
        },
        blocked: {
          actor: "human",
          message: "red",
          file: ".gtd/FEEDBACK.md",
          on: { "* **": "check" },
        },
      },
    },
  },
  use: [
    {
      submachine: "gate",
      name: "start",
      as: { check: "start-check", blocked: "start-blocked" },
      with: { onGreen: "planning" },
    },
  ],
  states: {
    idle: { actor: "human", message: "idle", initial: true, on: { "* **": "start-check" } },
    planning: {
      actor: "agent",
      prompt: "plan",
      model: "smart",
      memory: "plan",
      file: ".gtd/TODO.md",
      answerGate: true,
      on: { "* **": "done" },
    },
    done: { commit: "chore: done" },
  },
}

const model = buildVizModel(compileWorkflowConfig(raw, "/dir").definition, raw, {
  testCommand: "npm test",
})
const stateNamed = (name: string) => model.states.find((s) => s.name === name)!

describe("buildVizModel", () => {
  it("carries the initial state and every state's actor + content kind", () => {
    expect(model.initial).toBe("idle")
    expect(stateNamed("idle")).toMatchObject({ actor: "human", kind: "message", initial: true })
    expect(stateNamed("start-check")).toMatchObject({ actor: "check", kind: "script" })
    expect(stateNamed("done")).toMatchObject({ kind: "commit" })
    // a commit state carries no actor
    expect(stateNamed("done").actor).toBeUndefined()
  })

  it("carries model/memory/file/mode/flags and flattens on-edges", () => {
    const planning = stateNamed("planning")
    expect(planning).toMatchObject({ model: "smart", memory: "plan", file: ".gtd/TODO.md" })
    expect(planning.flags).toContain("answerGate")
    expect(planning.on).toEqual([{ pattern: "* **", to: "done" }])
  })

  it("groups states by their sub-machine invocation (using its `name`)", () => {
    expect(model.groups).toContainEqual({
      name: "start",
      submachine: "gate",
      states: ["start-check", "start-blocked"],
    })
    expect(stateNamed("start-check").group).toBe("start")
    expect(stateNamed("start-blocked").group).toBe("start")
    expect(stateNamed("idle").group).toBeUndefined()
  })

  it("computes incoming edges (routes in from)", () => {
    // start-check green (C) -> planning
    expect(stateNamed("planning").incoming).toContainEqual({ from: "start-check", pattern: "C" })
    // idle -> start-check
    expect(stateNamed("start-check").incoming).toContainEqual({ from: "idle", pattern: "* **" })
  })

  it("passes vars through", () => {
    expect(model.vars).toEqual({ testCommand: "npm test" })
  })

  it("yields no groups for a workflow with no sub-machines", () => {
    const flatRaw = {
      states: {
        a: { actor: "human", message: "a", initial: true, on: { "* **": "b" } },
        b: { commit: "chore: b" },
      },
    }
    const flatModel = buildVizModel(compileWorkflowConfig(flatRaw, "/dir").definition, flatRaw, {})
    expect(flatModel.groups).toEqual([])
    expect(flatModel.states.every((s) => s.group === undefined)).toBe(true)
  })
})

describe("handleVizRequest", () => {
  it("serves the page at / and the model at /workflow.json, 404 otherwise", () => {
    expect(handleVizRequest("/", model).status).toBe(200)
    expect(handleVizRequest("/", model).contentType).toMatch(/text\/html/)
    const json = handleVizRequest("/workflow.json", model)
    expect(json.status).toBe(200)
    expect(json.contentType).toMatch(/application\/json/)
    expect(JSON.parse(json.body).initial).toBe("idle")
    expect(handleVizRequest("/nope", model).status).toBe(404)
  })
})
