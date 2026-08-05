import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { compileWorkflowConfig } from "./PatternConfig.js"

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The plan's draft/check/revise shape (decision 7): a squashing prompt state feeding a `commit:` final state. */
const draftCheckRevise = {
  entry: { default: "root" },
  machines: {
    root: {
      entry: "idle",
      states: {
        idle: {
          actor: "human",
          message: "waiting for a draft",
          on: {
            "A DRAFT.md": "checking",
            "* *": "checking",
          },
        },
        checking: {
          actor: "check",
          script: "npm run lint DRAFT.md",
          on: {
            "A FEEDBACK.md": "revising",
            C: "squashing",
          },
        },
        revising: {
          actor: "agent",
          prompt: "Address the feedback in FEEDBACK.md, then delete it.",
          on: {
            "* *": "checking",
          },
        },
        squashing: {
          actor: "agent",
          prompt: "Write a commit message to COMMIT_MSG.md.",
          on: {
            "A COMMIT_MSG.md": "done",
          },
        },
        done: {
          commit: "chore: <%~ it.read('COMMIT_MSG.md') %>",
        },
      },
    },
  },
}

// ── Compilation of a realistic multi-state workflow ──────────────────────────

describe("compileWorkflowConfig — realistic multi-state workflow", () => {
  it("compiles every state with its content kind, actor, and on-edges", () => {
    const { definition } = compileWorkflowConfig(draftCheckRevise, "/config-dir")
    expect(Object.keys(definition.states).sort()).toEqual(
      ["checking", "done", "idle", "revising", "squashing"].sort(),
    )
    expect(definition.states["idle"]).toEqual({
      actor: "human",
      message: "waiting for a draft",
      on: [
        ["A DRAFT.md", "checking"],
        ["* *", "checking"],
      ],
    })
    expect(definition.entries).toEqual({ default: "idle" })
    expect(definition.states["done"]).toEqual({
      commit: "chore: <%~ it.read('COMMIT_MSG.md') %>",
    })
  })

  it("the `vars:` key compiles to a scalar-coerced `Record<string, string>`", () => {
    const { vars } = compileWorkflowConfig(
      { ...draftCheckRevise, vars: { greeting: "hi", attempts: 3, strict: true } },
      "/config-dir",
    )
    expect(vars).toEqual({ greeting: "hi", attempts: "3", strict: "true" })
  })

  it("`vars` is `{}` when no `vars:` key is given", () => {
    const { vars } = compileWorkflowConfig(draftCheckRevise, "/config-dir")
    expect(vars).toEqual({})
  })

  it("rejects a non-object `vars:` value", () => {
    expect(() =>
      compileWorkflowConfig({ ...draftCheckRevise, vars: ["nope"] }, "/config-dir"),
    ).toThrowError(/"vars" must be a mapping of name -> scalar value, got array/)
  })

  it("rejects an object/array value nested inside `vars:`, dropping just that key", () => {
    try {
      compileWorkflowConfig(
        { ...draftCheckRevise, vars: { good: "ok", bad: { nested: true }, alsoBad: [1, 2] } },
        "/config-dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain('"vars.bad" must be a string, number, or boolean, got object')
      expect(message).toContain('"vars.alsoBad" must be a string, number, or boolean, got array')
    }
  })

  it("aggregates a bad `vars:` entry alongside an unrelated config-shape error", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: 1, message: "hi", on: {} },
              },
            },
          },
          vars: { bad: { nested: true } },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain('state "a": "actor" must be a string')
      expect(message).toContain('"vars.bad" must be a string, number, or boolean, got object')
    }
  })

  it("the `modes:` key compiles onto the definition, verbatim commands and all", () => {
    const { definition } = compileWorkflowConfig(
      {
        ...draftCheckRevise,
        modes: {
          adr: {
            format: "./scripts/fmt-adr.sh <%= it.file %>",
            validate: "adr-lint <%= it.file %>",
          },
          spec: { validate: "npx ajv -s spec.schema.json -d <%= it.file %>" },
        },
      },
      "/config-dir",
    )
    // A `./`-prefixed COMMAND is never inlined as a file reference the way a
    // content string is — it is a shell command, kept verbatim.
    expect(definition.modes).toEqual({
      adr: { format: "./scripts/fmt-adr.sh <%= it.file %>", validate: "adr-lint <%= it.file %>" },
      spec: { validate: "npx ajv -s spec.schema.json -d <%= it.file %>" },
    })
  })

  it("carries no `modes` key at all when none is declared", () => {
    const { definition } = compileWorkflowConfig(draftCheckRevise, "/config-dir")
    expect(definition.modes).toBeUndefined()
  })

  it("rejects a non-object `modes:` value", () => {
    expect(() =>
      compileWorkflowConfig({ ...draftCheckRevise, modes: ["nope"] }, "/config-dir"),
    ).toThrowError(/"modes" must be a mapping of mode name -> \{ format, validate \}, got array/)
  })

  it("rejects a non-object mode entry, an unknown key inside one, and a non-string command", () => {
    try {
      compileWorkflowConfig(
        {
          ...draftCheckRevise,
          modes: {
            scalar: "adr-lint",
            extra: { validate: "ok", lint: "nope" },
            typed: { format: 42 },
          },
        },
        "/config-dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain(
        'mode "scalar": must be an object with "format" and/or "validate", got string',
      )
      expect(message).toContain('mode "extra": unknown key(s) lint')
      expect(message).toContain('mode "typed": "format" must be a shell command (string)')
    }
  })

  it("surfaces a mode declaring no command via `validateDefinition`'s aggregated error", () => {
    expect(() =>
      compileWorkflowConfig({ ...draftCheckRevise, modes: { adr: {} } }, "/config-dir"),
    ).toThrowError(/mode "adr": must declare at least one of "format"\/"validate"/)
  })

  it("layers the `rcModes` argument over the workflow's own `modes:`, per half", () => {
    const { definition } = compileWorkflowConfig(
      {
        ...draftCheckRevise,
        modes: { adr: { format: "workflow-fmt", validate: "adr-lint <%= it.file %>" } },
      },
      "/config-dir",
      { adr: { format: "project-fmt <%= it.file %>" }, spec: { validate: "spec-lint" } },
    )
    expect(definition.modes).toEqual({
      adr: { format: "project-fmt <%= it.file %>", validate: "adr-lint <%= it.file %>" },
      spec: { validate: "spec-lint" },
    })
  })

  it("accepts a state whose `mode:` is declared only by `rcModes`", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "a",
            states: {
              a: {
                actor: "agent",
                prompt: "write the ADR",
                file: "docs/adr/0001.md",
                mode: "adr",
                on: { "* *": "a" },
              },
            },
          },
        },
      },
      "/config-dir",
      { adr: { validate: "adr-lint <%= it.file %>" } },
    )
    expect(definition.modes).toEqual({ adr: { validate: "adr-lint <%= it.file %>" } })
  })

  it("accepts a state whose `mode:` names a declared mode", () => {
    const { definition } = compileWorkflowConfig(
      {
        modes: { adr: { validate: "adr-lint <%= it.file %>" } },
        entry: { default: "root" },
        machines: {
          root: {
            entry: "a",
            states: {
              a: {
                actor: "agent",
                prompt: "write the ADR",
                file: "docs/adr/0001.md",
                mode: "adr",
                on: { "* *": "a" },
              },
            },
          },
        },
      },
      "/config-dir",
    )
    expect(definition.states["a"]!.mode).toBe("adr")
  })
})

// ── `on` declaration-order preservation ──────────────────────────────────────

describe("compileWorkflowConfig — `on` order preservation", () => {
  it("preserves multi-row declaration order as OnEdge tuples", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "start",
            states: {
              start: {
                actor: "human",
                message: "go",
                on: {
                  "A z.md": "a",
                  "A a.md": "b",
                  "M m.md": "c",
                  "D d.md": "d",
                  "* *": "e",
                },
              },
              a: { commit: "a" },
              b: { commit: "b" },
              c: { commit: "c" },
              d: { commit: "d" },
              e: { commit: "e" },
            },
          },
        },
      },
      "/config-dir",
    )
    expect(definition.states["start"]!.on).toEqual([
      ["A z.md", "a"],
      ["A a.md", "b"],
      ["M m.md", "c"],
      ["D d.md", "d"],
      ["* *", "e"],
    ])
  })

  it("pins that this repo's YAML library preserves mapping order through parse()", () => {
    // Guards the assumption `compileOn` depends on: `yaml`'s `parse()` must
    // hand back a plain object whose key iteration order matches the
    // document's declaration order (not, say, alphabetical or Map-based).
    const yaml = `
entry:
  default: root
machines:
  root:
    entry: start
    states:
      start:
        actor: human
        message: go
        on:
          "A z.md": a
          "A a.md": b
          C: c
      a:
        commit: a
      b:
        commit: b
      c:
        commit: c
`
    const raw = parseYaml(yaml) as {
      machines: { root: { states: { start: { on: Record<string, string> } } } }
    }
    expect(Object.keys(raw.machines.root.states.start.on)).toEqual(["A z.md", "A a.md", "C"])

    const { definition } = compileWorkflowConfig(raw, "/config-dir")
    expect(definition.states["start"]!.on).toEqual([
      ["A z.md", "a"],
      ["A a.md", "b"],
      ["C", "c"],
    ])
  })

  it("compiles the { to, describe } object form, carrying describe as the edge's third element, while the string form stays a two-element edge", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "gate",
            states: {
              gate: {
                actor: "human",
                message: "choose",
                on: {
                  C: { to: "accept", describe: "Change nothing to accept and proceed." },
                  "* **": "revise",
                },
              },
              accept: { commit: "chore: accept" },
              revise: {
                actor: "agent",
                prompt: "revise",
                on: { "* **": "gate" },
              },
            },
          },
        },
      },
      "/config-dir",
    )
    expect(definition.states["gate"]!.on).toEqual([
      ["C", "accept", "Change nothing to accept and proceed."],
      ["* **", "revise"],
    ])
  })
})

// ── File references ──────────────────────────────────────────────────────────

describe("compileWorkflowConfig — file references", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gtd-pattern-config-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("inlines a `./`-relative file reference at load time", () => {
    writeFileSync(join(dir, "check.sh"), "#!/bin/sh\nnpm test\n")
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "checking",
            states: {
              checking: {
                actor: "check",
                script: "./check.sh",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      dir,
    )
    expect(definition.states["checking"]!.script).toBe("#!/bin/sh\nnpm test\n")
  })

  it("inlines a `../`-relative file reference resolved from configDir", () => {
    writeFileSync(join(dir, "shared-prompt.md"), "Do the thing.\n")
    const sub = join(dir, "sub")
    mkdirSync(sub)
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "working",
            states: {
              working: {
                actor: "agent",
                prompt: "../shared-prompt.md",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      sub,
    )
    expect(definition.states["working"]!.prompt).toBe("Do the thing.\n")
  })

  it("treats any other string as inline template source, verbatim", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "idle",
            states: {
              idle: {
                actor: "human",
                message: "hello, this contains a / slash but is not a file ref",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      dir,
    )
    expect(definition.states["idle"]!.message).toBe(
      "hello, this contains a / slash but is not a file ref",
    )
  })

  it("a missing file reference is a load error, never silently inline text", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "checking",
              states: {
                checking: {
                  actor: "check",
                  script: "./does-not-exist.sh",
                  on: { "* *": "done" },
                },
                done: { commit: "chore: done" },
              },
            },
          },
        },
        dir,
      ),
    ).toThrowError(/file reference "\.\/does-not-exist\.sh" does not exist/)
  })
})

// ── Config-shape validation errors ───────────────────────────────────────────

describe("compileWorkflowConfig — config-shape validation", () => {
  it("rejects a non-object top-level value", () => {
    expect(() => compileWorkflowConfig("nope", "/dir")).toThrowError(/must be an object/)
    expect(() => compileWorkflowConfig(null, "/dir")).toThrowError(/must be an object/)
    expect(() => compileWorkflowConfig(["nope"], "/dir")).toThrowError(/must be an object/)
  })

  it("rejects an unknown top-level key", () => {
    expect(() => compileWorkflowConfig({ machines: {}, bogus: 1 }, "/dir")).toThrowError(
      /unknown top-level key\(s\) bogus/,
    )
  })

  it("rejects a missing entry.default or one that names an undeclared machine", () => {
    expect(() => compileWorkflowConfig({}, "/dir")).toThrowError(
      /"entry\.default" must name a machine/,
    )
    expect(() =>
      compileWorkflowConfig({ entry: { default: "root" }, machines: {} }, "/dir"),
    ).toThrowError(/entry\.default: unknown machine "root"/)
  })

  it("rejects a non-object state", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: { root: { entry: "a", states: { a: "nope" } } },
        },
        "/dir",
      ),
    ).toThrowError(/machines\.root\.a: state must be an object, got string/)
  })

  it("rejects an unknown state key", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: "human", message: "hi", bogusKey: true },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": unknown key\(s\) bogusKey/)
  })

  it("rejects a non-string actor", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: { root: { entry: "a", states: { a: { actor: 1, message: "hi" } } } },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "actor" must be a string/)
  })

  it("rejects a non-boolean reviewWindow/reviewBase", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", reviewWindow: "yes" } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "reviewWindow" must be a boolean/)
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", reviewBase: 1 } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "reviewBase" must be a boolean/)
  })

  it("compiles reviewWindow/reviewBase booleans onto the StateDef (false omitted)", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "a",
            states: {
              a: {
                actor: "human",
                message: "hi",
                reviewBase: true,
                on: { "* *": "b" },
              },
              b: {
                actor: "human",
                message: "review",
                reviewWindow: true,
                reviewBase: false,
                on: { C: "a" },
              },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states.a!.reviewBase).toBe(true)
    expect(definition.states.b!.reviewWindow).toBe(true)
    // `false` compiles away — never lands on the StateDef.
    expect("reviewBase" in definition.states.b!).toBe(false)
  })

  it("compiles a requireProgress boolean onto the StateDef", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "a",
            states: {
              a: { actor: "human", message: "hi", on: { "* *": "b" } },
              b: {
                actor: "agent",
                prompt: "p",
                file: ".gtd/F.md",
                requireProgress: true,
                on: { "* **": "a" },
              },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states.b!.requireProgress).toBe(true)
  })

  it("compiles `entry.review` into `entries.review` (absent when not declared)", () => {
    const shape = (withReview: boolean) => ({
      entry: withReview ? { default: "root", review: "b" } : { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: { actor: "human", message: "hi", on: { "* *": "b" } },
            b: { actor: "human", message: "review", on: { C: "a" } },
          },
        },
      },
    })
    const { definition: withTrue } = compileWorkflowConfig(shape(true), "/dir")
    expect(withTrue.entries.review).toBe("b")

    const { definition: withFalse } = compileWorkflowConfig(shape(false), "/dir")
    // Absent from `entry:` — never becomes an entry.
    expect(withFalse.entries.review).toBeUndefined()
  })

  it("rejects zero content keys and more than one content key", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: { root: { entry: "a", states: { a: { actor: "human" } } } },
        },
        "/dir",
      ),
    ).toThrowError(
      /state "a": must declare exactly one of script\/prompt\/message\/commit \(found 0\)/,
    )

    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: "human", message: "hi", prompt: "also this" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(
      /state "a": must declare exactly one of script\/prompt\/message\/commit \(found 2\)/,
    )
  })

  it("rejects a non-string content value", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: { root: { entry: "a", states: { a: { actor: "human", message: 42 } } } },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "message" must be a string/)
  })

  it("rejects an `on` value that is not a mapping", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: "human", message: "hi", on: "nope" },
                b: { commit: "chore: b" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "on" must be a mapping of pattern -> target state/)
  })

  it("rejects an `on` value that is neither a target string nor a { to, describe } object", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: "human", message: "hi", on: { "* *": 1 } },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(
      /state "a": "on" entry for pattern "\* \*" must be a target state name \(string\) or a \{ to, describe \} object/,
    )
  })

  it('rejects an object `on` entry whose "to" is not a string', () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: "human", message: "hi", on: { "* *": { to: 1 } } },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "on.\* \*.to" must be a target state name \(string\)/)
  })

  it('rejects an object `on` entry whose "describe" is not a string', () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  on: { "* *": { to: "b", describe: 5 } },
                },
                b: { commit: "chore: b" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "on.\* \*.describe" must be a string/)
  })

  it("rejects an unknown key inside an object `on` entry", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  on: { "* *": { to: "b", explain: "nope" } },
                },
                b: { commit: "chore: b" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "on" entry for pattern "\* \*" has unknown key\(s\) explain/)
  })

  it("compiles the `action` field through onto the edge's fourth element, alongside `describe`", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "gate",
            states: {
              gate: {
                actor: "human",
                message: "choose",
                on: {
                  C: {
                    to: "accept",
                    describe: "Change nothing to accept and proceed.",
                    action: "Accept plan",
                  },
                  "* **": "revise",
                },
              },
              accept: { commit: "chore: accept" },
              revise: {
                actor: "agent",
                prompt: "revise",
                on: { "* **": "gate" },
              },
            },
          },
        },
      },
      "/config-dir",
    )
    expect(definition.states["gate"]!.on).toEqual([
      ["C", "accept", "Change nothing to accept and proceed.", "Accept plan"],
      ["* **", "revise"],
    ])
  })

  it("compiles an `action`-without-`describe` edge, placing an explicit `undefined` in the third slot", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "gate",
            states: {
              gate: {
                actor: "human",
                message: "choose",
                on: { C: { to: "accept", action: "Accept plan" } },
              },
              accept: { commit: "chore: accept" },
            },
          },
        },
      },
      "/config-dir",
    )
    expect(definition.states["gate"]!.on).toEqual([["C", "accept", undefined, "Accept plan"]])
  })

  it('rejects an object `on` entry whose "action" is not a string', () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  on: { "* *": { to: "b", action: 5 } },
                },
                b: { commit: "chore: b" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "on.\* \*.action" must be a string/)
  })

  it("compiles a `model` string through onto the state", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "working",
            states: {
              working: {
                actor: "agent",
                model: "smart",
                prompt: "do the thing",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]!.model).toBe("smart")
  })

  it("omits `model` entirely when the state declares none", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "working",
            states: {
              working: {
                actor: "agent",
                prompt: "do the thing",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]).not.toHaveProperty("model")
  })

  it("rejects a non-string `model` as a config-shape error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", model: 42 } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "model" must be a string/)
  })

  it("aggregates a bad `model` alongside an unrelated config-shape error", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  model: 42,
                  on: { "* **": "nowhere" },
                },
              },
            },
          },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain('state "a": "model" must be a string')
      expect(message).toContain('state "a": "on" target "nowhere" is not a defined state')
    }
  })

  it("compiles a `memory` string through onto the state", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "working",
            states: {
              working: {
                actor: "agent",
                memory: "plan",
                prompt: "do the thing",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]!.memory).toBe("plan")
  })

  it("omits `memory` entirely when the state declares none", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "working",
            states: {
              working: {
                actor: "agent",
                prompt: "do the thing",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]).not.toHaveProperty("memory")
  })

  it("rejects a non-string `memory` as a config-shape error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", memory: 42 } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "memory" must be a string/)
  })

  it("aggregates a bad `memory` alongside an unrelated config-shape error", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  memory: 42,
                  on: { "* **": "nowhere" },
                },
              },
            },
          },
        },
        "/dir",
      )
      throw new Error("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain('state "a": "memory" must be a string')
      expect(message).toContain('state "a": "on" target "nowhere" is not a defined state')
    }
  })

  it("compiles a `label` string through onto the state", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "working",
            states: {
              working: {
                actor: "agent",
                label: "Build",
                prompt: "do the thing",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]!.label).toBe("Build")
  })

  it("omits `label` entirely when the state declares none", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "working",
            states: {
              working: {
                actor: "agent",
                prompt: "do the thing",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]).not.toHaveProperty("label")
  })

  it("rejects a non-string `label` as a config-shape error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", label: 42 } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "label" must be a string/)
  })

  it("aggregates a bad `label` alongside an unrelated config-shape error", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  label: 42,
                  on: { "* **": "nowhere" },
                },
              },
            },
          },
        },
        "/dir",
      )
      throw new Error("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain('state "a": "label" must be a string')
      expect(message).toContain('state "a": "on" target "nowhere" is not a defined state')
    }
  })

  it("compiles `file`/`mode` strings through onto the state", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "working",
            states: {
              working: {
                actor: "agent",
                file: "<%= it.vars.todoFile %>",
                mode: "qa",
                prompt: "do the thing",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]!.file).toBe("<%= it.vars.todoFile %>")
    expect(definition.states["working"]!.mode).toBe("qa")
  })

  it("omits `file`/`mode` entirely when the state declares neither", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "working",
            states: {
              working: {
                actor: "agent",
                prompt: "do the thing",
                on: { "* *": "done" },
              },
              done: { commit: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]).not.toHaveProperty("file")
    expect(definition.states["working"]).not.toHaveProperty("mode")
  })

  it("rejects a non-string `file` as a config-shape error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", file: 42 } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "file" must be a string/)
  })

  it("rejects a non-string `mode` as a config-shape error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  file: ".gtd/TODO.md",
                  mode: 42,
                },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "mode" must be a string/)
  })

  it("surfaces an undefined `mode` string via `validateDefinition`'s aggregated error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  file: ".gtd/TODO.md",
                  mode: "yolo",
                  on: {},
                },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/"mode" must name a built-in mode \(qa, review, prose\).*\(got "yolo"\)/)
  })

  it("rejects a malformed `retry` block", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  on: { "* *": "b" },
                  retry: { max: "three", bogus: 1 },
                },
                b: { commit: "chore: b" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "retry" has unknown key\(s\) bogus/)
  })

  it("rejects retry.otherwise naming an undeclared state (surfaced from validateDefinition)", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "hi",
                  on: { "* *": "b" },
                  retry: { max: 1, otherwise: "nowhere" },
                },
                b: { commit: "chore: b" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/retry\.otherwise "nowhere" is not a defined state/)
  })

  it("rejects a commit state that also declares an actor or on (surfaced from validateDefinition)", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: "human", message: "hi", on: { "* *": "b" } },
                b: { commit: "chore: b", actor: "human" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/commit state "b" must not declare an actor/)
  })

  it("collects multiple shape errors into one thrown message", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: 1, model: 42 },
              },
            },
          },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain('state "a": "actor" must be a string')
      expect(message).toContain('state "a": "model" must be a string')
      expect(message).toContain(
        'state "a": must declare exactly one of script/prompt/message/commit (found 0)',
      )
    }
  })

  it("aggregates a config-shape finding together with a validateDefinition finding (docs' worked example)", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "idle",
              states: {
                idle: {
                  actor: "human",
                  message: "start",
                  prompt: "also a prompt",
                  on: { "* **": "nowhere" },
                },
              },
            },
          },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain(
        'state "idle": must declare exactly one of script/prompt/message/commit (found 2)',
      )
      expect(message).toContain('state "idle": "on" target "nowhere" is not a defined state')
    }
  })

  it("aggregates a content-kind finding in one state with an unrelated bad `on` target in another", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: {
                  actor: "human",
                  message: "start",
                  prompt: "also a prompt",
                  on: { "* **": "b" },
                },
                b: { actor: "human", message: "hi", on: { "* **": "nowhere" } },
              },
            },
          },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain(
        'state "a": must declare exactly one of script/prompt/message/commit (found 2)',
      )
      expect(message).toContain('state "b": "on" target "nowhere" is not a defined state')
    }
  })
})

describe("compileWorkflowConfig — legacy shape detection & error sequencing", () => {
  it("each legacy top-level key throws its own migration message", () => {
    expect(() => compileWorkflowConfig({ states: {} }, "/dir")).toThrowError(
      /top-level "states:" is no longer supported — declare a machine under "machines:" and name it in "entry\.default:"/,
    )
    expect(() => compileWorkflowConfig({ submachines: {} }, "/dir")).toThrowError(
      /top-level "submachines:" is no longer supported — declare machines directly under "machines:"/,
    )
    expect(() => compileWorkflowConfig({ use: {} }, "/dir")).toThrowError(
      /top-level "use:" is no longer supported/,
    )
  })

  it("a state-level `initial:` key surfaces its replacement hint instead of a bare unknown-key error", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: { entry: "a", states: { a: { actor: "human", message: "hi", initial: true } } },
          },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain(
        'state "a": unknown key(s) initial ("initial" no longer exists — declare this state\'s qualified path in the top-level "entry.default" instead)',
      )
    }
  })

  it("a reference's legacy `as`/`name`/`set` keys each surface a replacement hint instead of a bare unknown-key error", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "child1",
              states: {
                child1: { machine: "leaf", as: "x" },
                child2: { machine: "leaf", name: "y" },
                child3: { machine: "leaf", set: { z: 1 } },
              },
            },
            leaf: { entry: "s", states: { s: { actor: "human", message: "hi" } } },
          },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain(
        'machine "root": reference "child1": unknown key(s) as ("as" no longer exists — a reference\'s local name (the key itself) IS the concrete name; there is nothing left to rename)',
      )
      expect(message).toContain(
        'machine "root": reference "child2": unknown key(s) name ("name" no longer exists — a reference\'s local name (the key itself) names the instance)',
      )
      expect(message).toContain(
        'machine "root": reference "child3": unknown key(s) set ("set" no longer exists — bind extra per-instance values via "with:" instead)',
      )
    }
  })

  it("the legacy-detection short-circuit throws only the migration finding, never mixed with downstream noise from a missing `entry`/`machines`", () => {
    try {
      compileWorkflowConfig({ states: { a: { actor: "human", message: "hi" } } }, "/dir")
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toBe(
        'workflow config:\n  - top-level "states:" is no longer supported — declare a machine under "machines:" and name it in "entry.default:"',
      )
    }
  })

  it("an unassemblable config (entry.default names something unresolvable) throws before compileState/validateDefinition ever run, even though flattening already emitted a real state", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: { entry: "bogus", states: { a: { actor: 1 } } },
          },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // Only the flattener's entry.default finding — never compileState's
      // "actor must be a string" (which would fire on state "a" if the
      // per-state compile loop or validateDefinition ever ran).
      expect(message).toBe(
        'workflow config:\n  - "entry.default" names "bogus", which is not a state or machine reference',
      )
    }
  })

  it("the merge rule: a flattener-level sideways-target finding in one state and a validateDefinition content-kind finding in another both surface in one thrown error", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: "human", message: "hi", on: { "* **": "nowhere" } },
                b: { actor: "human", message: "hi", prompt: "also a prompt" },
              },
            },
          },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain(
        'machines.root.a: "on" target "nowhere" is not a state or reference of machine "root" — declare a "params:" entry and bind it at the reference site',
      )
      expect(message).toContain(
        'state "b": must declare exactly one of script/prompt/message/commit (found 2)',
      )
    }
  })
})
