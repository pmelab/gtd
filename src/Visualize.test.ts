import { describe, expect, it } from "vitest"
import {
  buildCurrentStateModel,
  buildGraphVizModel,
  handleVizRequest,
  startVizServer,
  type CurrentStateModel,
} from "./Visualize.js"
import type { FlowGraph } from "./analyze/index.js"
import type { ResolvedRest } from "./Edge.js"
import type { PendingChange, WorkflowDefinition } from "./Workflow.js"

const graph: FlowGraph = {
  entries: [
    { name: "default", edges: [{ to: "idle", label: "" }] },
    { name: "fix-precheck", edges: [{ to: "build.check", label: "" }] },
  ],
  nodes: [
    {
      name: "idle",
      kind: "human",
      scope: "",
      options: { file: "TODO.md" },
      file: "c.ts",
      line: 1,
    },
    {
      name: "build.check",
      kind: "run",
      scope: "build",
      options: {},
      content: "npm test",
      file: "c.ts",
      line: 2,
    },
    {
      name: "build.fix",
      kind: "agent",
      scope: "build",
      options: { model: "base", requireProgress: true },
      file: "c.ts",
      line: 3,
    },
  ],
  edges: [
    { from: "idle", to: "build.check", label: "" },
    { from: "build.check", to: "build.fix", label: 'exists(".gtd/FEEDBACK.md")' },
    { from: "build.fix", to: "build.check", label: "" },
    { from: "build.check", to: "$end", label: '!(exists(".gtd/FEEDBACK.md"))' },
  ],
}

const model = buildGraphVizModel(graph, { testCommand: "npm test" })

describe("buildCurrentStateModel", () => {
  const rest: ResolvedRest = {
    def: {} as WorkflowDefinition,
    state: "build.check",
    stepDef: { actor: "check", kind: "script", content: "npm test" },
    actor: "check",
  }
  const edges = [
    { pattern: 'exists(".gtd/FEEDBACK.md")', target: "build.fix" },
    { pattern: '!(exists(".gtd/FEEDBACK.md"))', target: "idle" },
  ]

  it("flags the out-edge leading to the step the pending change replays to", () => {
    const changes: PendingChange[] = [{ status: "A", path: ".gtd/FEEDBACK.md" }]
    const current = buildCurrentStateModel(rest, changes, edges, "build.fix")
    expect(current).toMatchObject({ state: "build.check", actor: "check", kind: "script" })
    expect(current.edges).toEqual([
      { pattern: 'exists(".gtd/FEEDBACK.md")', to: "build.fix", matched: true },
      { pattern: '!(exists(".gtd/FEEDBACK.md"))', to: "idle", matched: false },
    ])
    expect(current.pending).toEqual(changes)
  })

  it("flags nothing when there is no next step", () => {
    const current = buildCurrentStateModel(rest, [], edges, undefined)
    expect(current.edges.every((edge) => !edge.matched)).toBe(true)
  })

  it("carries the group when given one, omits it otherwise", () => {
    expect(buildCurrentStateModel(rest, [], edges, undefined, "build").group).toBe("build")
    expect(buildCurrentStateModel(rest, [], edges, undefined)).not.toHaveProperty("group")
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

describe("buildGraphVizModel", () => {
  it("carries each edge's path label in its pattern and clusters steps by scope", () => {
    expect(model.initial).toBe("idle")
    const check = model.states.find((s) => s.name === "build.check")!
    expect(check.kind).toBe("script")
    expect(check.group).toBe("build")
    expect(check.flags).toEqual(["entry"])
    expect(check.on).toEqual([
      { pattern: 'exists(".gtd/FEEDBACK.md")', to: "build.fix" },
      { pattern: '!(exists(".gtd/FEEDBACK.md"))', to: "idle" },
    ])
    expect(check.incoming).toEqual([
      { from: "idle", pattern: "" },
      { from: "build.fix", pattern: "" },
    ])
    const fix = model.states.find((s) => s.name === "build.fix")!
    expect(fix.flags).toEqual(["requireProgress"])
    expect(fix.model).toBe("base")
    expect(model.groups).toEqual([
      {
        name: "build",
        machine: "build",
        states: ["build.check", "build.fix"],
        depth: 0,
        model: "base",
      },
    ])
  })
})
