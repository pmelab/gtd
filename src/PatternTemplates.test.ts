import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import {
  createRenderLedger,
  renderSkillsPreamble,
  renderStateTemplate,
  varsOnlyContext,
  type TemplateContext,
} from "./PatternTemplates.js"
import { compileTemplate } from "./workflows/index.js"
import { Workspace, templateRead, templateReadCommitted, templateTail } from "./platform/index.js"
import { InMemRepo, makeInMemoryWorkspaceOps } from "./testing/index.js"
import { headingSections } from "./steering/index.js"

const baseContext = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  startCommit: "aaa111",
  currentCommit: "ccc333",
  previousCommit: "bbb222",
  state: "building",
  actor: "agent",
  reviewBase: "rev999",
  processBase: "ret888",
  processCost: 0,
  processCostByModel: [],
  read: (path: string) => {
    if (path.endsWith("missing.md"))
      throw new Error(`ENOENT: no such file or directory, open '${path}'`)
    return `contents of ${path}`
  },
  diff: (base: string) => `diff of ${base}`,
  sections: () => [],
  tail: () => {
    throw new Error("tail() must be stubbed by the test that calls it.tail")
  },
  diffTail: () => {
    throw new Error("diffTail() must be stubbed by the test that calls it.diffTail")
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

  it("renders reviewBase and processBase verbatim — bases, never diff content", () => {
    const out = renderStateTemplate(
      "REVIEW:<%= it.reviewBase %> RETAINED:<%= it.processBase %>",
      baseContext(),
    )
    expect(out).toBe("REVIEW:rev999 RETAINED:ret888")
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

describe("varsOnlyContext", () => {
  it("carries the given vars and empty/inert everything else", () => {
    const ctx = varsOnlyContext({ feedbackFile: ".gtd/FEEDBACK.md" })
    expect(ctx.vars).toEqual({ feedbackFile: ".gtd/FEEDBACK.md" })
    expect(ctx.state).toBe("")
    expect(ctx.actor).toBe("")
    expect(ctx.startCommit).toBe("")
    expect(ctx.currentCommit).toBe("")
    expect(ctx.previousCommit).toBe("")
    expect(ctx.reviewBase).toBe("")
    expect(ctx.processBase).toBe("")
    expect(ctx.processCost).toBe(0)
    expect(ctx.processCostByModel).toEqual([])
    expect(ctx.edges).toEqual([])
  })

  it("accepts an optional state name", () => {
    const ctx = varsOnlyContext({}, "picking")
    expect(ctx.state).toBe("picking")
  })

  it("renders a pattern template against it.vars", () => {
    const out = renderStateTemplate(
      "A <%= it.vars.feedbackFile %>",
      varsOnlyContext({ feedbackFile: ".gtd/FEEDBACK.md" }),
    )
    expect(out).toBe("A .gtd/FEEDBACK.md")
  })

  it("its read() throws — no working tree at this layer", () => {
    expect(() => varsOnlyContext({}).read("anything")).toThrow()
  })
})

describe("renderSkillsPreamble", () => {
  it("renders it.skills alongside it.vars", () => {
    const out = renderSkillsPreamble("Load: <%= it.skills %> (<%= it.vars.greeting %>)", {
      ...baseContext(),
      skills: "code-review, testing",
    })
    expect(out).toBe("Load: code-review, testing (hi)")
  })

  it("throws for a malformed template — the caller refuses the step, never half-renders", () => {
    expect(() =>
      renderSkillsPreamble("<%= it.skills %", { ...baseContext(), skills: "x" }),
    ).toThrow()
  })
})

describe("renderStateTemplate — no filesystem template resolution", () => {
  it("a plain string template never triggers an include()/readFile — it is rendered as the literal source", () => {
    const out = renderStateTemplate("just <%= it.actor %> text, no includes", baseContext())
    expect(out).toBe("just agent text, no includes")
  })
})

describe("renderStateTemplate — bundled `script` states render to valid bash", () => {
  // Regression: Eta's default autoTrim slurps the newline after every
  // `<%~ %>` tag. A `script` line ending in an interpolation therefore glued
  // the next line's `else`/`fi` onto it (e.g. `rm -f .gtd/FEEDBACK.mdfi`),
  // leaving the enclosing `if` unterminated — the driver died with
  // "syntax error: unexpected end of file" and the check turn never ran. Every
  // bundled `script` must survive `bash -n` after rendering with real vars.
  const { definition, vars } = compileTemplate()
  const scriptStates = Object.entries(definition.states).filter(([, s]) => s.script)

  it("covers every bundled script state (guards against a state being dropped)", () => {
    expect(scriptStates.map(([name]) => name).sort()).toEqual([
      "architecture-promote",
      "architecture.gate.check",
      "build.health.check",
      "build.health.escalate",
      "build.quality.picking",
      "build.quality.seeding",
      "build.review.deciding",
      "build.review.triaging",
      "design.gate.check",
      "fix-precheck",
      "packages.item.closing",
      "packages.item.health.check",
      "packages.item.health.escalate",
      "packages.item.spec.scoping",
      "packages.picking",
      "re-unwind",
      "review-gate.check",
      "start-gate.check",
      "unwind",
    ])
  })

  for (const [name, state] of scriptStates) {
    it(`\`${name}\` renders to syntactically valid bash`, () => {
      const rendered = renderStateTemplate(state.script!, baseContext({ state: name, vars }))
      expect(() => execFileSync("bash", ["-n"], { input: rendered })).not.toThrow()
    })
  }
})

describe("renderStateTemplate — it.read through a real Workspace", () => {
  const makeWorkspace = () => {
    const root = "/repo"
    const repo = new InMemRepo()
    const workspaceOps = makeInMemoryWorkspaceOps(repo, root)
    return {
      repo,
      provide: <A>(eff: Effect.Effect<A, Error, Workspace>): Promise<A> =>
        Effect.runPromise(eff.pipe(Effect.provide(Layer.succeed(Workspace, workspaceOps)))),
    }
  }

  it("resolves a computed (non-literal) path the same as a literal one — no pre-scan to miss it", async () => {
    // Regression pin for the amendment in `.gtd/packages/03-platform-ports.md`:
    // `Workspace.readSync` is a plain function call at render time, not a
    // pre-warmed cache keyed off literal template text — so a computed
    // argument (`it.read(it.vars.file)`) resolves exactly like a literal one.
    const { repo, provide } = makeWorkspace()
    repo.writeFile("computed.md", "computed content\n")
    const rendered = await provide(
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const read = templateRead(workspace)
        return renderStateTemplate("<%~ it.read(it.vars.file) %>", {
          startCommit: "",
          currentCommit: "",
          previousCommit: "",
          state: "",
          actor: "",
          reviewBase: "",
          processBase: "",
          processCost: 0,
          processCostByModel: [],
          read,
          diff: () => {
            throw new Error("must not be called")
          },
          sections: (path: string) => headingSections(read(path)),
          tail: () => {
            throw new Error("must not be called")
          },
          diffTail: () => {
            throw new Error("must not be called")
          },
          vars: { file: "computed.md" },
          edges: [],
        })
      }),
    )
    expect(rendered).toBe("computed content\n")
  })

  it("a template's it.read of a missing path still throws and refuses the render", async () => {
    const { provide } = makeWorkspace()
    const renderResult = provide(
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const read = templateRead(workspace)
        return renderStateTemplate("<%~ it.read('missing.md') %>", {
          startCommit: "",
          currentCommit: "",
          previousCommit: "",
          state: "",
          actor: "",
          reviewBase: "",
          processBase: "",
          processCost: 0,
          processCostByModel: [],
          read,
          diff: () => {
            throw new Error("must not be called")
          },
          sections: (path: string) => headingSections(read(path)),
          tail: () => {
            throw new Error("must not be called")
          },
          diffTail: () => {
            throw new Error("must not be called")
          },
          vars: {},
          edges: [],
        })
      }),
    )
    await expect(renderResult).rejects.toThrow()
  })
})

describe("renderStateTemplate — it.read through templateReadCommitted (the evidence-rule read, judge:'s own)", () => {
  const makeWorkspace = () => {
    const root = "/repo"
    const repo = new InMemRepo()
    const workspaceOps = makeInMemoryWorkspaceOps(repo, root)
    return {
      repo,
      provide: <A>(eff: Effect.Effect<A, Error, Workspace>): Promise<A> =>
        Effect.runPromise(eff.pipe(Effect.provide(Layer.succeed(Workspace, workspaceOps)))),
    }
  }

  it("resolves a committed path's content", async () => {
    const { repo, provide } = makeWorkspace()
    repo.writeFile("a.md", "committed\n")
    repo.commitAllWithPrefix("chore: commit a.md")
    const rendered = await provide(
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const read = templateReadCommitted(workspace)
        return renderStateTemplate("<%~ it.read('a.md') %>", {
          startCommit: "",
          currentCommit: "",
          previousCommit: "",
          state: "",
          actor: "",
          reviewBase: "",
          processBase: "",
          processCost: 0,
          processCostByModel: [],
          read,
          diff: () => {
            throw new Error("must not be called")
          },
          sections: (path: string) => headingSections(read(path)),
          tail: () => {
            throw new Error("must not be called")
          },
          diffTail: () => {
            throw new Error("must not be called")
          },
          vars: {},
          edges: [],
        })
      }),
    )
    expect(rendered).toBe("committed\n")
  })

  it("a template's it.read of a NEVER-committed (working-tree-only) path throws and refuses the render, unlike templateRead", async () => {
    const { repo, provide } = makeWorkspace()
    repo.writeFile("scratch.md", "freshly gathered, ungoverned\n")
    const renderResult = provide(
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const read = templateReadCommitted(workspace)
        return renderStateTemplate("<%~ it.read('scratch.md') %>", {
          startCommit: "",
          currentCommit: "",
          previousCommit: "",
          state: "",
          actor: "",
          reviewBase: "",
          processBase: "",
          processCost: 0,
          processCostByModel: [],
          read,
          diff: () => {
            throw new Error("must not be called")
          },
          sections: (path: string) => headingSections(read(path)),
          tail: () => {
            throw new Error("must not be called")
          },
          diffTail: () => {
            throw new Error("must not be called")
          },
          vars: {},
          edges: [],
        })
      }),
    )
    await expect(renderResult).rejects.toThrow(/ENOENT/)
  })

  it("still returns the COMMITTED content for a path since edited in the working tree — never the pending edit", async () => {
    const { repo, provide } = makeWorkspace()
    repo.writeFile("a.md", "committed\n")
    repo.commitAllWithPrefix("chore: commit a.md")
    // Edited after committing — pending, uncommitted content.
    repo.writeFile("a.md", "an uncommitted edit\n")
    const rendered = await provide(
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const read = templateReadCommitted(workspace)
        return renderStateTemplate("<%~ it.read('a.md') %>", {
          startCommit: "",
          currentCommit: "",
          previousCommit: "",
          state: "",
          actor: "",
          reviewBase: "",
          processBase: "",
          processCost: 0,
          processCostByModel: [],
          read,
          diff: () => {
            throw new Error("must not be called")
          },
          sections: (path: string) => headingSections(read(path)),
          tail: () => {
            throw new Error("must not be called")
          },
          diffTail: () => {
            throw new Error("must not be called")
          },
          vars: {},
          edges: [],
        })
      }),
    )
    expect(rendered).toBe("committed\n")
  })
})

describe("createRenderLedger — the byte-budget accounting", () => {
  it("returns content shorter than the budget untouched, not truncated", () => {
    const ledger = createRenderLedger(100)
    expect(ledger.tail("short content\n", 1)).toBe("short content\n")
    expect(ledger.truncated()).toBe(false)
  })

  it("cuts content longer than the budget on a line boundary, dropping the leading partial line", () => {
    const ledger = createRenderLedger(20)
    // Last 20 bytes of the content below land mid-way through "bbbbbbbbbb\n" —
    // that partial line is dropped, leaving only the whole line(s) after it.
    const content = "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n"
    const out = ledger.tail(content, 1)
    expect(out).toBe("cccccccccc\n")
    expect(ledger.truncated()).toBe(true)
  })

  it("a bound leaving room for no whole line returns the empty string and still counts as truncated", () => {
    const ledger = createRenderLedger(100)
    const out = ledger.tail("some content that is definitely longer than one byte\n", 0.01)
    expect(out).toBe("")
    expect(ledger.truncated()).toBe(true)
  })

  it("truncated() stays sticky across renders, once set", () => {
    const ledger = createRenderLedger(20)
    ledger.tail("aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n", 1)
    expect(ledger.truncated()).toBe(true)
    ledger.beginRender()
    ledger.tail("short\n", 1)
    expect(ledger.truncated()).toBe(true)
  })

  it("beginRender() resets the share accumulator, so the same share is legal again on the next render", () => {
    const ledger = createRenderLedger(100)
    ledger.tail("a\n", 0.6)
    ledger.beginRender()
    expect(() => ledger.tail("b\n", 0.6)).not.toThrow()
  })

  it("a cumulative share over 1 within one render throws", () => {
    const ledger = createRenderLedger(100)
    ledger.tail("a\n", 0.6)
    expect(() => ledger.tail("b\n", 0.6)).toThrow(/sum to more than 1/)
  })

  it("two 0.51 shares against a 3-byte budget are refused — flooring each share before summing let this through", () => {
    const ledger = createRenderLedger(3)
    ledger.tail("a\n", 0.51)
    expect(() => ledger.tail("b\n", 0.51)).toThrow(/sum to more than 1/)
  })

  it("0.1 + 0.2 + 0.7 (a raw sum of 1.0000000000000002) renders against a 32768-byte budget without being refused", () => {
    const ledger = createRenderLedger(32768)
    expect(() => {
      ledger.tail("x\n", 0.1)
      ledger.tail("x\n", 0.2)
      ledger.tail("x\n", 0.7)
    }).not.toThrow()
  })

  it("nine it.tail(p, 1/9) calls in one render pass sum to 1.0000000000000002 and still clear the 1e-9 tolerance", () => {
    const ledger = createRenderLedger(900)
    expect(() => {
      for (let i = 0; i < 9; i++) ledger.tail("x\n", 1 / 9)
    }).not.toThrow()
  })

  it("0.33 + 0.56 + 0.11 (a raw sum of 1.0000000000000002) passes as an exact split", () => {
    const ledger = createRenderLedger(300)
    expect(() => {
      ledger.tail("x\n", 0.33)
      ledger.tail("x\n", 0.56)
      ledger.tail("x\n", 0.11)
    }).not.toThrow()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("a share of %p throws", (share) => {
    const ledger = createRenderLedger(100)
    expect(() => ledger.tail("content\n", share)).toThrow()
  })

  it("sectionsBound cuts the same way as tail but is exempt from the share accumulator", () => {
    const ledger = createRenderLedger(20)
    ledger.tail("a\n", 1)
    // `tail` above already spent the whole render's share (1) — `sectionsBound`
    // must not throw as "over budget" on top of it, since it inlines nothing.
    expect(() => ledger.sectionsBound("aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n", 1)).not.toThrow()
  })
})

describe("it.tail through templateTail — the real production binding (Workspace.ts)", () => {
  const makeWorkspace = () => {
    const root = "/repo"
    const repo = new InMemRepo()
    const workspaceOps = makeInMemoryWorkspaceOps(repo, root)
    return {
      repo,
      provide: <A>(eff: Effect.Effect<A, Error, Workspace>): Promise<A> =>
        Effect.runPromise(eff.pipe(Effect.provide(Layer.succeed(Workspace, workspaceOps)))),
    }
  }

  it("bounds a real workspace read the same way createRenderLedger's own unit tests pin, and shares the read binding's evidence rule", async () => {
    const { repo, provide } = makeWorkspace()
    repo.writeFile("f.md", "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n")
    const rendered = await provide(
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const read = templateRead(workspace)
        const ledger = createRenderLedger(20)
        return renderStateTemplate(
          "<%~ it.tail('f.md', 1) %>",
          baseContext({ read, tail: templateTail(read, ledger) }),
        )
      }),
    )
    expect(rendered).toBe("cccccccccc\n")
  })
})

describe("it.sections(path, share) — a real markdown parse over the same ledger-bounded tail", () => {
  it("parses only the ## headings inside the bound, spending no share of its own", () => {
    const ledger = createRenderLedger(20)
    const md = "## dropped\nfiller\n## kept\nbody\n"
    const read = () => md
    const context = baseContext({
      read,
      sections: (path: string, share?: number) =>
        headingSections(share === undefined ? read() : ledger.sectionsBound(read(), share)),
    })
    expect(renderStateTemplate("<%~ JSON.stringify(it.sections('f.md', 1)) %>", context)).toBe(
      JSON.stringify(["kept"]),
    )
    // The same render's `it.tail` still has the WHOLE share available —
    // `sectionsBound` above spent none of it.
    expect(() =>
      renderStateTemplate("<%~ it.tail('f.md', 1) %>", {
        ...context,
        tail: () => ledger.tail(md, 1),
      }),
    ).not.toThrow()
  })
})
