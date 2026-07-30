import { describe, expect, it } from "vitest"
import { compileWorkflowConfig } from "./PatternConfig.js"
import {
  buildCurrentStateModel,
  buildVizModel,
  handleVizRequest,
  startVizServer,
  type CurrentStateModel,
} from "./Visualize.js"
import type { ResolvedRest } from "./Edge.js"
import type { PendingChange } from "./PatternMachine.js"

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

describe("buildCurrentStateModel", () => {
  const definition = compileWorkflowConfig(raw, "/dir").definition
  const restAt = (state: string): ResolvedRest => ({
    def: definition,
    state,
    stateDef: definition.states[state]!,
    actor: definition.states[state]!.actor!,
  })

  it("flags the on-edge that matches the pending changes", () => {
    const changes: PendingChange[] = [{ status: "A", path: ".gtd/FEEDBACK.md" }]
    const model = buildCurrentStateModel(restAt("start-check"), changes)
    expect(model).toMatchObject({ state: "start-check", actor: "check", kind: "script" })
    expect(model.edges).toEqual([
      { pattern: "A .gtd/FEEDBACK.md", to: "start-blocked", matched: true },
      { pattern: "C", to: "planning", matched: false },
    ])
  })

  it("flags the clean-tree edge when there are no pending changes", () => {
    const model = buildCurrentStateModel(restAt("start-check"), [])
    expect(model.edges).toEqual([
      { pattern: "A .gtd/FEEDBACK.md", to: "start-blocked", matched: false },
      { pattern: "C", to: "planning", matched: true },
    ])
  })

  it("carries the group when given one, omits it otherwise", () => {
    expect(buildCurrentStateModel(restAt("start-check"), [], "start").group).toBe("start")
    expect(buildCurrentStateModel(restAt("start-check"), []).group).toBeUndefined()
  })

  it("passes retry through verbatim, omits it when unset", () => {
    const withRetry: ResolvedRest = {
      ...restAt("planning"),
      stateDef: { ...definition.states.planning!, retry: { max: 3, otherwise: "idle" } },
    }
    expect(buildCurrentStateModel(withRetry, []).retry).toEqual({ max: 3, otherwise: "idle" })
    expect(buildCurrentStateModel(restAt("planning"), []).retry).toBeUndefined()
  })

  it("passes pending changes through", () => {
    const changes: PendingChange[] = [{ status: "A", path: ".gtd/FEEDBACK.md" }]
    expect(buildCurrentStateModel(restAt("start-check"), changes).pending).toEqual(changes)
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

describe("startVizServer's /state.json route", () => {
  it("serves the resolver's current-state JSON, and {} when it resolves null", async () => {
    const current: CurrentStateModel = {
      state: "planning",
      actor: "agent",
      kind: "prompt",
      edges: [{ pattern: "* **", to: "done", matched: true }],
      pending: [],
    }
    let resolved: CurrentStateModel | null = current
    const { server, url } = await startVizServer(model, 0, "127.0.0.1", () =>
      Promise.resolve(resolved),
    )
    try {
      const res = await fetch(`${url}/state.json`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(current)

      resolved = null
      const res2 = await fetch(`${url}/state.json`)
      expect(await res2.json()).toEqual({})
    } finally {
      server.close()
    }
  })

  it("serves {} when no resolveCurrent is given at all", async () => {
    const { server, url } = await startVizServer(model, 0)
    try {
      const res = await fetch(`${url}/state.json`)
      expect(await res.json()).toEqual({})
    } finally {
      server.close()
    }
  })
})
