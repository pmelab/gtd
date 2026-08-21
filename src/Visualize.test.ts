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

// A small workflow authored with a machine reference, so we exercise both the
// compiled (flat) states AND the machine-instance tree.
const raw = {
  entry: { default: "root" },
  machines: {
    gate: {
      params: ["onGreen"],
      entry: "check",
      states: {
        check: {
          actor: "check",
          script: "run",
          on: { "A .gtd/FEEDBACK.md": "blocked", C: "$onGreen" },
        },
        blocked: {
          actor: "human",
          message: "red",
          file: "FEEDBACK.md",
          on: { "* **": "check" },
        },
      },
    },
    root: {
      model: "smart",
      entry: "idle",
      states: {
        idle: { actor: "human", message: "idle", on: { "* **": "start.check" } },
        planning: {
          actor: "agent",
          prompt: "plan",
          file: "TODO.md",
          answerGate: true,
          on: { "* **": "done" },
        },
        done: { commit: "chore: done" },
        start: { machine: "gate", with: { onGreen: "planning" } },
      },
    },
  },
}

const compiled = compileWorkflowConfig(raw, "/dir")
const model = buildVizModel(
  compiled.definition,
  compiled.tree,
  {
    testCommand: "npm test",
  },
  compiled.scopes,
)
const stateNamed = (name: string) => model.states.find((s) => s.name === name)!

describe("buildVizModel", () => {
  it("carries the initial state and every state's actor + content kind", () => {
    expect(model.initial).toBe("idle")
    expect(stateNamed("idle")).toMatchObject({ actor: "human", kind: "message" })
    expect(stateNamed("idle").initial).toBe(true)
    expect(stateNamed("start.check")).toMatchObject({ actor: "check", kind: "script" })
    expect(stateNamed("done")).toMatchObject({ kind: "commit" })
    // a commit state carries no actor
    expect(stateNamed("done").actor).toBeUndefined()
  })

  it("carries model/file/mode/flags and flattens on-edges", () => {
    const planning = stateNamed("planning")
    expect(planning).toMatchObject({ model: "smart", file: ".gtd/TODO.md" })
    expect(planning.flags).toContain("answerGate")
    expect(planning.on).toEqual([{ pattern: "* **", to: "done" }])
  })

  it("carries a prompt/message/script state's raw content, omits it for a commit state", () => {
    expect(stateNamed("planning").content).toBe("plan")
    expect(stateNamed("idle").content).toBe("idle")
    expect(stateNamed("start.check").content).toBe("run")
    expect(stateNamed("done").content).toBeUndefined()
  })

  it("groups states by their machine instance", () => {
    expect(model.groups).toContainEqual({
      name: "start",
      machine: "gate",
      states: ["start.check", "start.blocked"],
      depth: 0,
    })
    expect(stateNamed("start.check").group).toBe("start")
    expect(stateNamed("start.blocked").group).toBe("start")
    expect(stateNamed("idle").group).toBeUndefined()
  })

  it("computes a group's model from a machine-level `model:` declaration, via any one of its prompt states", () => {
    const modelRaw = {
      entry: { default: "root" },
      machines: {
        worker: {
          model: "sonnet",
          entry: "think",
          states: {
            think: { actor: "agent", prompt: "think hard", on: { "* **": "done" } },
            done: { commit: "chore: done" },
          },
        },
        root: {
          entry: "idle",
          states: {
            idle: { actor: "human", message: "idle", on: { "* **": "job.think" } },
            job: { machine: "worker" },
          },
        },
      },
    }
    const modelCompiled = compileWorkflowConfig(modelRaw, "/dir")
    const modelModel = buildVizModel(
      modelCompiled.definition,
      modelCompiled.tree,
      {},
      modelCompiled.scopes,
    )
    expect(modelModel.groups.find((g) => g.name === "job")).toMatchObject({
      machine: "worker",
      model: "sonnet",
    })
  })

  it("leaves a group's model absent when its machine has no prompt state (a script/message-only machine)", () => {
    // the `gate` machine (the `start` group) has only script/message states,
    // no prompt — no `def.model` to read.
    expect(model.groups.find((g) => g.name === "start")).not.toHaveProperty("model")
  })

  it("computes VizState.group as a direct `scopes` lookup, not a chop off the qualified name's last dot segment", () => {
    // A naive "chop at the last dot" of "outer.inner.leaf" would yield
    // "outer.inner" — WRONG. This state's real owning instance, straight from
    // `scopes` (as the flattener would produce for a state two levels deep in
    // the tree), is "outer.deep".
    const manualWorkflow = {
      entries: { default: "outer.inner.leaf", manual: [] },
      states: {
        "outer.inner.leaf": { actor: "agent", prompt: "p", on: [] },
        top: { commit: "chore: done" },
      },
    }
    const manualTree = {
      key: "root",
      machine: "root",
      states: ["top"],
      children: [
        {
          key: "outer",
          machine: "m",
          states: [],
          children: [
            { key: "outer.deep", machine: "m2", states: ["outer.inner.leaf"], children: [] },
          ],
        },
      ],
    }
    const manualScopes: Record<string, string> = {
      "outer.inner.leaf": "outer.deep",
      top: "",
    }
    const manualModel = buildVizModel(manualWorkflow, manualTree, {}, manualScopes)
    expect(manualModel.states.find((s) => s.name === "outer.inner.leaf")!.group).toBe("outer.deep")
    expect(manualModel.states.find((s) => s.name === "top")!.group).toBeUndefined()
  })

  it("computes incoming edges (routes in from)", () => {
    // start.check green (C) -> planning
    expect(stateNamed("planning").incoming).toContainEqual({ from: "start.check", pattern: "C" })
    // idle -> start.check
    expect(stateNamed("start.check").incoming).toContainEqual({ from: "idle", pattern: "* **" })
  })

  it("passes vars through", () => {
    expect(model.vars).toEqual({ testCommand: "npm test" })
  })

  it("yields no groups for a workflow with no machine references", () => {
    const flatRaw = {
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: { actor: "human", message: "a", on: { "* **": "b" } },
            b: { commit: "chore: b" },
          },
        },
      },
    }
    const flatCompiled = compileWorkflowConfig(flatRaw, "/dir")
    const flatModel = buildVizModel(
      flatCompiled.definition,
      flatCompiled.tree,
      {},
      flatCompiled.scopes,
    )
    expect(flatModel.groups).toEqual([])
    expect(flatModel.states.every((s) => s.group === undefined)).toBe(true)
  })

  it("renders a templated `on` pattern against vars, in both the state's own edges and the incoming-edges map", () => {
    const templatedRaw = {
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: {
              actor: "human",
              message: "a",
              on: { "A <%= it.vars.feedbackFile %>": "b" },
            },
            b: { commit: "chore: b" },
          },
        },
      },
    }
    const templatedCompiled = compileWorkflowConfig(templatedRaw, "/dir")
    const templatedModel = buildVizModel(
      templatedCompiled.definition,
      templatedCompiled.tree,
      {
        feedbackFile: ".gtd/FEEDBACK.md",
      },
      templatedCompiled.scopes,
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
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: {
              actor: "human",
              message: "a",
              on: {
                C: "b",
                "A file1.md": { to: "b", describe: "d1" },
                "A file2.md": { to: "b", action: "act2" },
                "A file3.md": { to: "b", describe: "d3", action: "act3" },
              },
            },
            b: { commit: "chore: b" },
          },
        },
      },
    }
    const actionCompiled = compileWorkflowConfig(rawWithAction, "/dir")
    const actionModel = buildVizModel(
      actionCompiled.definition,
      actionCompiled.tree,
      {},
      actionCompiled.scopes,
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

  it("flags a state that declares entry: true with the entry badge, leaves others (including the default/initial state) without it", () => {
    const entryRaw = {
      entry: { default: "root" },
      machines: {
        root: {
          entry: "idle",
          states: {
            idle: { actor: "human", message: "idle", on: { "* **": "reviewer" } },
            reviewer: {
              actor: "agent",
              prompt: "review this",
              entry: true,
              on: { "* **": "done" },
            },
            done: { commit: "chore: done" },
          },
        },
      },
    }
    const entryCompiled = compileWorkflowConfig(entryRaw, "/dir")
    const entryModel = buildVizModel(
      entryCompiled.definition,
      entryCompiled.tree,
      {},
      entryCompiled.scopes,
    )
    const named = (name: string) => entryModel.states.find((s) => s.name === name)!

    expect(named("reviewer").flags).toContain("entry")

    expect(named("idle").flags).not.toContain("entry")
    expect(named("idle").initial).toBe(true)

    expect(named("done").flags).not.toContain("entry")
  })

  it("falls back to the raw pattern string when it fails to render", () => {
    const badRaw = {
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: {
              actor: "human",
              message: "a",
              on: { "A <%= it.vars.missing.deeper %>": "b" },
            },
            b: { commit: "chore: b" },
          },
        },
      },
    }
    const badCompiled = compileWorkflowConfig(badRaw, "/dir")
    const badModel = buildVizModel(badCompiled.definition, badCompiled.tree, {}, badCompiled.scopes)
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
    const model = buildCurrentStateModel(restAt("start.check"), changes, onEdgesAt("start.check"))
    expect(model).toMatchObject({ state: "start.check", actor: "check", kind: "script" })
    expect(model.edges).toEqual([
      { pattern: "A .gtd/FEEDBACK.md", to: "start.blocked", matched: true },
      { pattern: "C", to: "planning", matched: false },
    ])
  })

  it("flags the clean-tree edge when there are no pending changes", () => {
    const model = buildCurrentStateModel(restAt("start.check"), [], onEdgesAt("start.check"))
    expect(model.edges).toEqual([
      { pattern: "A .gtd/FEEDBACK.md", to: "start.blocked", matched: false },
      { pattern: "C", to: "planning", matched: true },
    ])
  })

  it("matches/emits from the given (pre-rendered) onEdges, not `rest.stateDef.on`", () => {
    const changes: PendingChange[] = [{ status: "A", path: "elsewhere.md" }]
    const rendered = [["A elsewhere.md", "start.blocked"] as const, ["C", "planning"] as const]
    const model = buildCurrentStateModel(restAt("start.check"), changes, rendered)
    expect(model.edges).toEqual([
      { pattern: "A elsewhere.md", to: "start.blocked", matched: true },
      { pattern: "C", to: "planning", matched: false },
    ])
  })

  it("carries the group when given one, omits it otherwise", () => {
    expect(
      buildCurrentStateModel(restAt("start.check"), [], onEdgesAt("start.check"), "start").group,
    ).toBe("start")
    expect(
      buildCurrentStateModel(restAt("start.check"), [], onEdgesAt("start.check")).group,
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
      ["A .gtd/FEEDBACK.md", "start.blocked", undefined, "Reject"],
      ["C", "planning", undefined, "Approve"],
    ]
    const changes: PendingChange[] = [{ status: "A", path: ".gtd/FEEDBACK.md" }]
    const withAction = buildCurrentStateModel(restAt("start.check"), changes, onEdges)
    expect(withAction.edges).toEqual([
      { pattern: "A .gtd/FEEDBACK.md", to: "start.blocked", matched: true, action: "Reject" },
      { pattern: "C", to: "planning", matched: false, action: "Approve" },
    ])

    const withoutAction = buildCurrentStateModel(
      restAt("start.check"),
      [],
      onEdgesAt("start.check"),
    )
    // no source edge carries an action — the key must be OMITTED, not `action: undefined`
    for (const edge of withoutAction.edges) expect(edge).not.toHaveProperty("action")
  })

  it("passes pending changes through", () => {
    const changes: PendingChange[] = [{ status: "A", path: ".gtd/FEEDBACK.md" }]
    expect(
      buildCurrentStateModel(restAt("start.check"), changes, onEdgesAt("start.check")).pending,
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
