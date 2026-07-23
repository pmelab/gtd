import { describe, expect, it } from "vitest"
import { renderMermaid } from "./Mermaid.js"
import { defaultWorkflowDefinition } from "./workflows/default.js"
import type { WorkflowDefinition } from "./PatternMachine.js"

const simpleWorkflow: WorkflowDefinition = {
  states: {
    idle: {
      actor: "human",
      message: "waiting",
      initial: true,
      on: [["* **", "working"]],
    },
    working: {
      actor: "agent",
      prompt: "do the thing",
      on: [["A DONE.md", "done"]],
    },
    done: {
      commit: "chore: done",
    },
  },
}

describe("renderMermaid", () => {
  it("opens with the stateDiagram-v2 header", () => {
    expect(renderMermaid(simpleWorkflow)).toMatch(/^stateDiagram-v2\n/)
  })

  it("declares every state with its exact name, aliased", () => {
    const out = renderMermaid(simpleWorkflow)
    expect(out).toContain('state "idle" as idle')
    expect(out).toContain('state "working" as working')
    expect(out).toContain('state "done" as done')
  })

  it("marks the initial state", () => {
    expect(renderMermaid(simpleWorkflow)).toContain("[*] --> idle")
  })

  it("emits one edge per on row, labeled with the raw pattern", () => {
    const out = renderMermaid(simpleWorkflow)
    expect(out).toContain("idle --> working : * **")
    expect(out).toContain("working --> done : A DONE.md")
  })

  it("routes a commit state to the final marker instead of an on row", () => {
    expect(renderMermaid(simpleWorkflow)).toContain("done --> [*]")
  })

  it("notes each rest's actor and content kind, but never a commit state", () => {
    const out = renderMermaid(simpleWorkflow)
    expect(out).toContain("note right of idle : human · message")
    expect(out).toContain("note right of working : agent · prompt")
    expect(out).not.toContain("note right of done")
  })

  it("notes a retry cap alongside actor/content kind", () => {
    const withRetry: WorkflowDefinition = {
      states: {
        ...simpleWorkflow.states,
        working: {
          ...simpleWorkflow.states["working"]!,
          retry: { max: 3, otherwise: "idle" },
        },
      },
    }
    expect(renderMermaid(withRetry)).toContain(
      "note right of working : agent · prompt · retry 3→idle",
    )
  })

  it("aliases a hyphenated state name while preserving its label", () => {
    const hyphenated: WorkflowDefinition = {
      states: {
        "todo-validating": {
          actor: "check",
          script: "true",
          initial: true,
          on: [["C", "todo-validating"]],
        },
      },
    }
    const out = renderMermaid(hyphenated)
    expect(out).toContain('state "todo-validating" as todo_validating')
    expect(out).toContain("[*] --> todo_validating")
    expect(out).toContain("todo_validating --> todo_validating : C")
  })

  it("prefixes an alias when the folded name would start with a digit", () => {
    const digitLed: WorkflowDefinition = {
      states: {
        "3rd-pass": {
          actor: "human",
          message: "go",
          initial: true,
          on: [["C", "3rd-pass"]],
        },
      },
    }
    expect(renderMermaid(digitLed)).toContain('state "3rd-pass" as s_3rd_pass')
  })

  it("escapes a double quote inside a label so the quoted declaration stays valid", () => {
    const quoted: WorkflowDefinition = {
      states: {
        idle: {
          actor: "human",
          message: "go",
          initial: true,
          on: [['A "weird".md', "idle"]],
        },
      },
    }
    expect(renderMermaid(quoted)).toContain("idle --> idle : A 'weird'.md")
  })

  it("renders the bundled default workflow without throwing, covering every state", () => {
    const out = renderMermaid(defaultWorkflowDefinition)
    for (const name of Object.keys(defaultWorkflowDefinition.states)) {
      expect(out).toContain(`"${name}"`)
    }
    expect(out).toContain("[*] -->")
  })
})
