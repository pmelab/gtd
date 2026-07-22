import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { compileWorkflowConfig } from "./PatternConfig.js"

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The plan's draft/check/revise shape (decision 7): a squashing prompt state feeding a `commit:` final state. */
const draftCheckRevise = {
  states: {
    idle: {
      actor: "human",
      message: "waiting for a draft",
      initial: true,
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
      initial: true,
      on: [
        ["A DRAFT.md", "checking"],
        ["* *", "checking"],
      ],
    })
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
          states: {
            a: { actor: 1, initial: true, message: "hi", on: {} },
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
})

// ── `on` declaration-order preservation ──────────────────────────────────────

describe("compileWorkflowConfig — `on` order preservation", () => {
  it("preserves multi-row declaration order as OnEdge tuples", () => {
    const { definition } = compileWorkflowConfig(
      {
        states: {
          start: {
            actor: "human",
            message: "go",
            initial: true,
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
states:
  start:
    actor: human
    message: go
    initial: true
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
    const raw = parseYaml(yaml) as { states: { start: { on: Record<string, string> } } }
    expect(Object.keys(raw.states.start.on)).toEqual(["A z.md", "A a.md", "C"])

    const { definition } = compileWorkflowConfig(raw, "/config-dir")
    expect(definition.states["start"]!.on).toEqual([
      ["A z.md", "a"],
      ["A a.md", "b"],
      ["C", "c"],
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
        states: {
          checking: {
            actor: "check",
            script: "./check.sh",
            initial: true,
            on: { "* *": "done" },
          },
          done: { commit: "chore: done" },
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
        states: {
          working: {
            actor: "agent",
            prompt: "../shared-prompt.md",
            initial: true,
            on: { "* *": "done" },
          },
          done: { commit: "chore: done" },
        },
      },
      sub,
    )
    expect(definition.states["working"]!.prompt).toBe("Do the thing.\n")
  })

  it("treats any other string as inline template source, verbatim", () => {
    const { definition } = compileWorkflowConfig(
      {
        states: {
          idle: {
            actor: "human",
            message: "hello, this contains a / slash but is not a file ref",
            initial: true,
            on: { "* *": "done" },
          },
          done: { commit: "chore: done" },
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
          states: {
            checking: {
              actor: "check",
              script: "./does-not-exist.sh",
              initial: true,
              on: { "* *": "done" },
            },
            done: { commit: "chore: done" },
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
    expect(() => compileWorkflowConfig({ states: {}, bogus: 1 }, "/dir")).toThrowError(
      /unknown top-level key\(s\) bogus/,
    )
  })

  it("rejects a missing or empty `states` object", () => {
    expect(() => compileWorkflowConfig({}, "/dir")).toThrowError(
      /"states" must be a non-empty object/,
    )
    expect(() => compileWorkflowConfig({ states: {} }, "/dir")).toThrowError(
      /"states" must be a non-empty object/,
    )
  })

  it("rejects a non-object state", () => {
    expect(() => compileWorkflowConfig({ states: { a: "nope" } }, "/dir")).toThrowError(
      /state "a": must be an object, got string/,
    )
  })

  it("rejects an unknown state key", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          states: {
            a: { actor: "human", message: "hi", initial: true, bogusKey: true },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": unknown key\(s\) bogusKey/)
  })

  it("rejects a non-string actor", () => {
    expect(() =>
      compileWorkflowConfig({ states: { a: { actor: 1, message: "hi", initial: true } } }, "/dir"),
    ).toThrowError(/state "a": "actor" must be a string/)
  })

  it("rejects a non-boolean initial", () => {
    expect(() =>
      compileWorkflowConfig(
        { states: { a: { actor: "human", message: "hi", initial: "yes" } } },
        "/dir",
      ),
    ).toThrowError(/state "a": "initial" must be a boolean/)
  })

  it("rejects zero content keys and more than one content key", () => {
    expect(() =>
      compileWorkflowConfig({ states: { a: { actor: "human", initial: true } } }, "/dir"),
    ).toThrowError(
      /state "a": must declare exactly one of script\/prompt\/message\/commit \(found 0\)/,
    )

    expect(() =>
      compileWorkflowConfig(
        {
          states: {
            a: { actor: "human", message: "hi", prompt: "also this", initial: true },
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
        { states: { a: { actor: "human", message: 42, initial: true } } },
        "/dir",
      ),
    ).toThrowError(/state "a": "message" must be a string/)
  })

  it("rejects an `on` value that is not a mapping", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          states: {
            a: { actor: "human", message: "hi", initial: true, on: "nope" },
            b: { commit: "chore: b" },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "on" must be a mapping of pattern -> target state/)
  })

  it("rejects a non-string `on` target", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          states: {
            a: { actor: "human", message: "hi", initial: true, on: { "* *": 1 } },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "on" target for pattern "\* \*" must be a string/)
  })

  it("compiles a `model` string through onto the state", () => {
    const { definition } = compileWorkflowConfig(
      {
        states: {
          working: {
            actor: "agent",
            model: "smart",
            prompt: "do the thing",
            initial: true,
            on: { "* *": "done" },
          },
          done: { commit: "chore: done" },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]!.model).toBe("smart")
  })

  it("omits `model` entirely when the state declares none", () => {
    const { definition } = compileWorkflowConfig(
      {
        states: {
          working: {
            actor: "agent",
            prompt: "do the thing",
            initial: true,
            on: { "* *": "done" },
          },
          done: { commit: "chore: done" },
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
          states: {
            a: { actor: "human", message: "hi", initial: true, model: 42 },
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
          states: {
            a: {
              actor: "human",
              message: "hi",
              initial: true,
              model: 42,
              on: { "* **": "nowhere" },
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

  it("compiles `file`/`mode` strings through onto the state", () => {
    const { definition } = compileWorkflowConfig(
      {
        states: {
          working: {
            actor: "agent",
            file: "<%= it.vars.todoFile %>",
            mode: "qa",
            prompt: "do the thing",
            initial: true,
            on: { "* *": "done" },
          },
          done: { commit: "chore: done" },
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
        states: {
          working: {
            actor: "agent",
            prompt: "do the thing",
            initial: true,
            on: { "* *": "done" },
          },
          done: { commit: "chore: done" },
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
          states: {
            a: { actor: "human", message: "hi", initial: true, file: 42 },
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
          states: {
            a: {
              actor: "human",
              message: "hi",
              initial: true,
              file: ".gtd/TODO.md",
              mode: 42,
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "mode" must be a string/)
  })

  it("surfaces an out-of-vocabulary `mode` string via `validateDefinition`'s aggregated error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          states: {
            a: {
              actor: "human",
              message: "hi",
              initial: true,
              file: ".gtd/TODO.md",
              mode: "yolo",
              on: {},
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/"mode" must be one of qa, review \(got "yolo"\)/)
  })

  it("rejects a malformed `retry` block", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          states: {
            a: {
              actor: "human",
              message: "hi",
              initial: true,
              on: { "* *": "b" },
              retry: { max: "three", bogus: 1 },
            },
            b: { commit: "chore: b" },
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
          states: {
            a: {
              actor: "human",
              message: "hi",
              initial: true,
              on: { "* *": "b" },
              retry: { max: 1, otherwise: "nowhere" },
            },
            b: { commit: "chore: b" },
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
          states: {
            a: { actor: "human", message: "hi", initial: true, on: { "* *": "b" } },
            b: { commit: "chore: b", actor: "human" },
          },
        },
        "/dir",
      ),
    ).toThrowError(/commit state "b" must not declare an actor/)
  })

  it("rejects a workflow with no initial state (surfaced from validateDefinition)", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          states: {
            a: { actor: "human", message: "hi", on: { "* *": "b" } },
            b: { commit: "chore: b" },
          },
        },
        "/dir",
      ),
    ).toThrowError(/workflow must declare exactly one initial state \(found 0\)/)
  })

  it("collects multiple shape errors into one thrown message", () => {
    try {
      compileWorkflowConfig(
        {
          states: {
            a: { actor: 1, initial: "nope" },
          },
        },
        "/dir",
      )
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain('state "a": "actor" must be a string')
      expect(message).toContain('state "a": "initial" must be a boolean')
      expect(message).toContain(
        'state "a": must declare exactly one of script/prompt/message/commit (found 0)',
      )
    }
  })

  it("aggregates a config-shape finding together with a validateDefinition finding (docs' worked example)", () => {
    try {
      compileWorkflowConfig(
        {
          states: {
            idle: {
              actor: "human",
              initial: true,
              message: "start",
              prompt: "also a prompt",
              on: { "* **": "nowhere" },
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
          states: {
            a: {
              actor: "human",
              initial: true,
              message: "start",
              prompt: "also a prompt",
              on: { "* **": "b" },
            },
            b: { actor: "human", message: "hi", on: { "* **": "nowhere" } },
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
