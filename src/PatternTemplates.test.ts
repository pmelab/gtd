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
  read: (path: string) => {
    if (path.endsWith("missing.md"))
      throw new Error(`ENOENT: no such file or directory, open '${path}'`)
    return `contents of ${path}`
  },
  config: { greeting: "hi" },
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

  it("renders the config passthrough, any shape", () => {
    const out = renderStateTemplate("greeting=<%= it.config.greeting %>", baseContext())
    expect(out).toBe("greeting=hi")
  })

  it("config passthrough may be undefined and is usable via typeof checks", () => {
    const out = renderStateTemplate(
      "config=<%= typeof it.config === 'undefined' ? 'none' : 'present' %>",
      baseContext({ config: undefined }),
    )
    expect(out).toBe("config=none")
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
      renderStateTemplate("<%= it.config.nonexistent.deeper %>", baseContext({ config: {} })),
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
