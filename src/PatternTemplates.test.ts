import { describe, expect, it } from "vitest"
import { renderStateTemplate, type TemplateContext } from "./PatternTemplates.js"

const baseContext = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  startCommit: "aaa111",
  currentCommit: "ccc333",
  previousCommit: "bbb222",
  state: "building",
  actor: "agent",
  processDiff: "diff --git a/x.ts b/x.ts\n+added\n",
  lastDiff: "diff --git a/y.ts b/y.ts\n+last\n",
  processCost: 0,
  processCostByModel: [],
  read: (path: string) => {
    if (path.endsWith("missing.md"))
      throw new Error(`ENOENT: no such file or directory, open '${path}'`)
    return `contents of ${path}`
  },
  vars: { greeting: "hi" },
  edges: [],
  ...overrides,
})

describe("renderStateTemplate — the full variable set", () => {
  it("renders every scalar variable", () => {
    const out = renderStateTemplate(
      [
        "start=<%= it.startCommit %>",
        "current=<%= it.currentCommit %>",
        "previous=<%= it.previousCommit %>",
        "state=<%= it.state %>",
        "actor=<%= it.actor %>",
      ].join(" "),
      baseContext(),
    )
    expect(out).toBe("start=aaa111 current=ccc333 previous=bbb222 state=building actor=agent")
  })

  it("renders processDiff and lastDiff verbatim via the raw (`<%~ %>`) tag", () => {
    const out = renderStateTemplate(
      "PROCESS:\n<%~ it.processDiff %>\nLAST:\n<%~ it.lastDiff %>",
      baseContext(),
    )
    expect(out).toBe(
      "PROCESS:\ndiff --git a/x.ts b/x.ts\n+added\nLAST:\ndiff --git a/y.ts b/y.ts\n+last\n",
    )
  })

  it("renders the merged `it.vars` map by name", () => {
    const out = renderStateTemplate("greeting=<%= it.vars.greeting %>", baseContext())
    expect(out).toBe("greeting=hi")
  })

  it("renders it.processCost — the accumulated token cost (e.g. for a squash commit message)", () => {
    const out = renderStateTemplate(
      "Total tokens: <%= it.processCost %>",
      baseContext({ processCost: 8421 }),
    )
    expect(out).toBe("Total tokens: 8421")
  })

  it("iterates it.processCostByModel — the per-model breakdown (e.g. for a squash commit message)", () => {
    const out = renderStateTemplate(
      "<% it.processCostByModel.forEach(function(m){ %><%= m.model %>=<%= m.cost %>;<% }) %>",
      baseContext({
        processCostByModel: [
          { model: "haiku", cost: 300 },
          { model: "opus", cost: 200 },
        ],
      }),
    )
    expect(out).toBe("haiku=300;opus=200;")
  })

  it("`it.vars` is always a plain object, even when empty — usable via `in` checks", () => {
    const out = renderStateTemplate(
      "greeting=<%= 'greeting' in it.vars ? 'present' : 'none' %>",
      baseContext({ vars: {} }),
    )
    expect(out).toBe("greeting=none")
  })

  it("renders a human-gate route list from `it.edges`, skipping edges without a describe", () => {
    const out = renderStateTemplate(
      [
        "What each change does next:",
        "<% it.edges.forEach(function (e) { if (e.describe) { %>",
        '<%~ "- " + e.describe + "\\n" %>',
        "<% } }) %>",
      ].join("\n"),
      baseContext({
        edges: [
          { pattern: "C", target: "building", describe: "Change nothing to accept and build." },
          { pattern: "* **", target: "grilling", describe: "Edit the plan to grill again." },
          { pattern: "M .gtd/X.md", target: "elsewhere" },
        ],
      }),
    )
    expect(out).toBe(
      "What each change does next:\n- Change nothing to accept and build.\n- Edit the plan to grill again.\n",
    )
  })

  it("the route list collapses to just its heading when no edge carries a describe", () => {
    const out = renderStateTemplate(
      [
        "Heading:",
        "<% it.edges.forEach(function (e) { if (e.describe) { %>",
        '<%~ "- " + e.describe + "\\n" %>',
        "<% } }) %>",
      ].join("\n"),
      baseContext({ edges: [{ pattern: "* **", target: "x" }] }),
    )
    expect(out).toBe("Heading:\n")
  })
})

describe("renderStateTemplate — read(path)", () => {
  it("calls through to the injected read for a resolvable path", () => {
    const out = renderStateTemplate("<%~ it.read('COMMIT_MSG.md') %>", baseContext())
    expect(out).toBe("contents of COMMIT_MSG.md")
  })

  it("propagates a read() failure (missing file) as a thrown render error", () => {
    expect(() => renderStateTemplate("<%~ it.read('missing.md') %>", baseContext())).toThrowError(
      /ENOENT.*missing\.md/,
    )
  })

  it("the plan's commit-state shape: `commit: <%~ it.read(...) %>` renders the read file's content", () => {
    const out = renderStateTemplate("chore: <%~ it.read('COMMIT_MSG.md') %>", baseContext())
    expect(out).toBe("chore: contents of COMMIT_MSG.md")
  })
})

describe("renderStateTemplate — render-error propagation", () => {
  it("throws for a template with a syntax error rather than swallowing it", () => {
    expect(() => renderStateTemplate("<%= it.state %", baseContext())).toThrow()
  })

  it("throws when the template references an undefined property chain", () => {
    expect(() =>
      renderStateTemplate("<%= it.vars.nonexistent.deeper %>", baseContext({ vars: {} })),
    ).toThrow()
  })

  it("does not swallow an error thrown deep inside a helper call", () => {
    expect(() =>
      renderStateTemplate("<%~ it.read('a/b/missing.md') %>", baseContext()),
    ).toThrowError(/ENOENT/)
  })
})

describe("renderStateTemplate — no filesystem template resolution", () => {
  it("a plain string template never triggers an include()/readFile — it is rendered as the literal source", () => {
    const out = renderStateTemplate("just <%= it.actor %> text, no includes", baseContext())
    expect(out).toBe("just agent text, no includes")
  })
})
