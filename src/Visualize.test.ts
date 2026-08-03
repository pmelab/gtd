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
import type { OnEdge, PendingChange } from "./PatternMachine.js"

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

  it("carries a prompt/message/script state's raw content, omits it for a commit state", () => {
    expect(stateNamed("planning").content).toBe("plan")
    expect(stateNamed("idle").content).toBe("idle")
    expect(stateNamed("start-check").content).toBe("run")
    expect(stateNamed("done").content).toBeUndefined()
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

  it("renders a templated `on` pattern against vars, in both the state's own edges and the incoming-edges map", () => {
    const templatedRaw = {
      states: {
        a: {
          actor: "human",
          message: "a",
          initial: true,
          on: { "A <%= it.vars.feedbackFile %>": "b" },
        },
        b: { commit: "chore: b" },
      },
    }
    const templatedModel = buildVizModel(
      compileWorkflowConfig(templatedRaw, "/dir").definition,
      templatedRaw,
      { feedbackFile: ".gtd/FEEDBACK.md" },
    )
    expect(templatedModel.states.find((s) => s.name === "a")!.on).toEqual([
      { pattern: "A .gtd/FEEDBACK.md", to: "b" },
    ])
    expect(templatedModel.states.find((s) => s.name === "b")!.incoming).toContainEqual({
      from: "a",
      pattern: "A .gtd/FEEDBACK.md",
    })
  })

  it("carries an on-edge's action when present, omits it when absent — all 4 describe/action combinations", () => {
    const rawWithAction = {
      states: {
        a: {
          actor: "human",
          message: "a",
          initial: true,
          on: {
            C: "b",
            "A file1.md": { to: "b", describe: "d1" },
            "A file2.md": { to: "b", action: "act2" },
            "A file3.md": { to: "b", describe: "d3", action: "act3" },
          },
        },
        b: { commit: "chore: b" },
      },
    }
    const actionModel = buildVizModel(
      compileWorkflowConfig(rawWithAction, "/dir").definition,
      rawWithAction,
      {},
    )
    const edges = actionModel.states.find((s) => s.name === "a")!.on
    expect(edges).toEqual([
      { pattern: "C", to: "b" },
      { pattern: "A file1.md", to: "b", describe: "d1" },
      { pattern: "A file2.md", to: "b", action: "act2" },
      { pattern: "A file3.md", to: "b", describe: "d3", action: "act3" },
    ])
    // neither/describe-only edges must OMIT the `action` key entirely, not set it to `undefined`
    expect(edges[0]).not.toHaveProperty("action")
    expect(edges[1]).not.toHaveProperty("action")
  })

  it("falls back to the raw pattern string when it fails to render", () => {
    const badRaw = {
      states: {
        a: {
          actor: "human",
          message: "a",
          initial: true,
          on: { "A <%= it.vars.missing.deeper %>": "b" },
        },
        b: { commit: "chore: b" },
      },
    }
    const badModel = buildVizModel(compileWorkflowConfig(badRaw, "/dir").definition, badRaw, {})
    expect(badModel.states.find((s) => s.name === "a")!.on).toEqual([
      { pattern: "A <%= it.vars.missing.deeper %>", to: "b" },
    ])
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
  const onEdgesAt = (state: string) => definition.states[state]!.on ?? []

  it("flags the on-edge that matches the pending changes", () => {
    const changes: PendingChange[] = [{ status: "A", path: ".gtd/FEEDBACK.md" }]
    const model = buildCurrentStateModel(restAt("start-check"), changes, onEdgesAt("start-check"))
    expect(model).toMatchObject({ state: "start-check", actor: "check", kind: "script" })
    expect(model.edges).toEqual([
      { pattern: "A .gtd/FEEDBACK.md", to: "start-blocked", matched: true },
      { pattern: "C", to: "planning", matched: false },
    ])
  })

  it("flags the clean-tree edge when there are no pending changes", () => {
    const model = buildCurrentStateModel(restAt("start-check"), [], onEdgesAt("start-check"))
    expect(model.edges).toEqual([
      { pattern: "A .gtd/FEEDBACK.md", to: "start-blocked", matched: false },
      { pattern: "C", to: "planning", matched: true },
    ])
  })

  it("matches/emits from the given (pre-rendered) onEdges, not `rest.stateDef.on`", () => {
    const changes: PendingChange[] = [{ status: "A", path: "elsewhere.md" }]
    const rendered = [["A elsewhere.md", "start-blocked"] as const, ["C", "planning"] as const]
    const model = buildCurrentStateModel(restAt("start-check"), changes, rendered)
    expect(model.edges).toEqual([
      { pattern: "A elsewhere.md", to: "start-blocked", matched: true },
      { pattern: "C", to: "planning", matched: false },
    ])
  })

  it("carries the group when given one, omits it otherwise", () => {
    expect(
      buildCurrentStateModel(restAt("start-check"), [], onEdgesAt("start-check"), "start").group,
    ).toBe("start")
    expect(
      buildCurrentStateModel(restAt("start-check"), [], onEdgesAt("start-check")).group,
    ).toBeUndefined()
  })

  it("passes retry through verbatim, omits it when unset", () => {
    const withRetry: ResolvedRest = {
      ...restAt("planning"),
      stateDef: { ...definition.states.planning!, retry: { max: 3, otherwise: "idle" } },
    }
    expect(buildCurrentStateModel(withRetry, [], onEdgesAt("planning")).retry).toEqual({
      max: 3,
      otherwise: "idle",
    })
    expect(
      buildCurrentStateModel(restAt("planning"), [], onEdgesAt("planning")).retry,
    ).toBeUndefined()
  })

  it("carries an edge's action on both the matched AND an unmatched edge, omits it when absent", () => {
    const onEdges: OnEdge[] = [
      ["A .gtd/FEEDBACK.md", "start-blocked", undefined, "Reject"],
      ["C", "planning", undefined, "Approve"],
    ]
    const changes: PendingChange[] = [{ status: "A", path: ".gtd/FEEDBACK.md" }]
    const withAction = buildCurrentStateModel(restAt("start-check"), changes, onEdges)
    expect(withAction.edges).toEqual([
      { pattern: "A .gtd/FEEDBACK.md", to: "start-blocked", matched: true, action: "Reject" },
      { pattern: "C", to: "planning", matched: false, action: "Approve" },
    ])

    const withoutAction = buildCurrentStateModel(
      restAt("start-check"),
      [],
      onEdgesAt("start-check"),
    )
    // no source edge carries an action — the key must be OMITTED, not `action: undefined`
    for (const edge of withoutAction.edges) expect(edge).not.toHaveProperty("action")
  })

  it("passes pending changes through", () => {
    const changes: PendingChange[] = [{ status: "A", path: ".gtd/FEEDBACK.md" }]
    expect(
      buildCurrentStateModel(restAt("start-check"), changes, onEdgesAt("start-check")).pending,
    ).toEqual(changes)
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
