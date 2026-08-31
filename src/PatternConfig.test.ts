import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import {
  assertScopesCoverStates,
  compileState,
  compileWorkflowConfig,
  inlineWorkflowFileRefs,
  type FileRefReader,
} from "./PatternConfig.js"
import { isSeededValidateCommand, seededValidateCommand } from "./SteeringFormats.js"
import { resolveSteeringMode, renderSteeringCommands } from "./SteeringMode.js"
import type { TemplateContext } from "./PatternTemplates.js"

/**
 * The plan's draft/check/revise shape (decision 7). Every state carries an
 * `actor` (required on every state, script/prompt/message alike, per
 * `STATE_FIELDS`) — `done` is a natural terminal `message` state with no
 * `on`, since a message/script rest with no outgoing edges is a legal
 * dead-end (`validateReachability` only checks INCOMING reachability).
 */
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
          actor: "human",
          message: "chore: <%~ it.read('COMMIT_MSG.md') %>",
        },
      },
    },
  },
}

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
    expect(definition.entries).toEqual({ default: "idle", manual: [] })
    expect(definition.states["done"]).toEqual({
      actor: "human",
      message: "chore: <%~ it.read('COMMIT_MSG.md') %>",
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
    // A `./`-prefixed COMMAND is never inlined as a file reference — it's a
    // shell command, kept verbatim. `qa`/`review` are seeded with their own
    // `validate:` even though this workflow never mentions them.
    expect(definition.modes).toEqual({
      qa: { validate: seededValidateCommand("qa") },
      review: { validate: seededValidateCommand("review") },
      adr: { format: "./scripts/fmt-adr.sh <%= it.file %>", validate: "adr-lint <%= it.file %>" },
      spec: { validate: "npx ajv -s spec.schema.json -d <%= it.file %>" },
    })
  })

  it("seeds the built-in registry's names (qa/review) with their own `validate:` command even when no `modes:` is declared", () => {
    const { definition } = compileWorkflowConfig(draftCheckRevise, "/config-dir")
    expect(definition.modes).toEqual({
      qa: { validate: seededValidateCommand("qa") },
      review: { validate: seededValidateCommand("review") },
    })
  })

  it("keeps the seed's `validate:` when a workflow overrides only `format:` for a built-in name", () => {
    const { definition } = compileWorkflowConfig(
      { ...draftCheckRevise, modes: { qa: { format: "npx prettier --write <%= it.file %>" } } },
      "/config-dir",
    )
    expect(definition.modes).toEqual({
      qa: {
        format: "npx prettier --write <%= it.file %>",
        validate: seededValidateCommand("qa"),
      },
      review: { validate: seededValidateCommand("review") },
    })
  })

  it("fully displaces the seed when a workflow declares both halves for a built-in name", () => {
    const { definition } = compileWorkflowConfig(
      {
        ...draftCheckRevise,
        modes: {
          qa: { format: "my-fmt <%= it.file %>", validate: "my-qa-linter <%= it.file %>" },
        },
      },
      "/config-dir",
    )
    const qa = definition.modes?.["qa"]
    expect(qa).toEqual({ format: "my-fmt <%= it.file %>", validate: "my-qa-linter <%= it.file %>" })
    expect(isSeededValidateCommand("qa", qa?.validate ?? "")).toBe(false)
  })

  it("seeds a usable `validate:` command that round-trips through resolveSteeringMode/renderSteeringCommands", async () => {
    const { definition } = compileWorkflowConfig(draftCheckRevise, "/config-dir")
    const resolved = resolveSteeringMode(definition, "qa")
    expect(resolved?.validate).toEqual({ kind: "command", command: seededValidateCommand("qa") })

    const context: TemplateContext = {
      startCommit: "",
      currentCommit: "",
      previousCommit: "",
      state: "",
      actor: "",
      reviewBase: "",
      processBase: "",
      processCost: 0,
      processCostByModel: [],
      read: () => {
        throw new Error("must not be called")
      },
      vars: {},
      edges: [],
    }
    const rendered = await Effect.runPromise(
      renderSteeringCommands(resolved!, ".gtd/TODO.md", context),
    )
    expect(rendered).toEqual([`gtd check qa '.gtd/TODO.md'`])
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

  it("accepts a `modes:` entry declaring neither command — the format-only tier any workflow can use", () => {
    const { definition } = compileWorkflowConfig(
      { ...draftCheckRevise, modes: { adr: {} } },
      "/config-dir",
    )
    expect(definition.modes?.["adr"]).toEqual({})
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
      qa: { validate: seededValidateCommand("qa") },
      review: { validate: seededValidateCommand("review") },
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
    expect(definition.modes).toEqual({
      qa: { validate: seededValidateCommand("qa") },
      review: { validate: seededValidateCommand("review") },
      adr: { validate: "adr-lint <%= it.file %>" },
    })
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
              a: { actor: "human", message: "a" },
              b: { actor: "human", message: "b" },
              c: { actor: "human", message: "c" },
              d: { actor: "human", message: "d" },
              e: { actor: "human", message: "e" },
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
        actor: human
        message: a
      b:
        actor: human
        message: b
      c:
        actor: human
        message: c
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
              accept: { actor: "human", message: "chore: accept" },
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
              done: { actor: "human", message: "chore: done" },
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
              done: { actor: "human", message: "chore: done" },
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
              done: { actor: "human", message: "chore: done" },
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
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        dir,
      ),
    ).toThrowError(/file reference "\.\/does-not-exist\.sh" does not exist/)
  })

  it("an existing but unreadable file reference is a load error naming the read failure", () => {
    writeFileSync(join(dir, "check.sh"), "#!/bin/sh\nnpm test\n")
    const throwingFileRefs: FileRefReader = {
      exists: () => true,
      read: () => {
        throw new Error("EACCES: permission denied")
      },
    }
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
                  script: "./check.sh",
                  on: { "* *": "done" },
                },
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        dir,
        undefined,
        true,
        throwingFileRefs,
      ),
    ).toThrowError(/file reference "\.\/check\.sh" could not be read: EACCES: permission denied/)
  })
})

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

  it("rejects a non-object `machines:` value", () => {
    expect(() =>
      compileWorkflowConfig({ entry: { default: "root" }, machines: "nope" }, "/dir"),
    ).toThrowError(
      /"machines" must be a mapping of machine name -> \{ params\?, entry, states \}, got string/,
    )
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

  it("rejects reviewWindow as an unknown key — the field no longer exists", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", reviewWindow: true } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": unknown key\(s\) reviewWindow/)
  })

  it("compiles reviewBase's boolean-or-template shape: `true` verbatim, a non-blank string verbatim", () => {
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
                reviewBase: "<%= it.vars.base %>",
                on: { C: "a" },
              },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states.a!.reviewBase).toBe(true)
    expect(definition.states.b!.reviewBase).toBe("<%= it.vars.base %>")
  })

  it("rejects `false`, a number, an object, and a blank string for reviewBase", () => {
    const withReviewBase = (reviewBase: unknown) => ({
      entry: { default: "root" },
      machines: {
        root: { entry: "a", states: { a: { actor: "human", message: "hi", reviewBase } } },
      },
    })
    for (const bad of [false, 1, { nested: true }, ""]) {
      expect(() => compileWorkflowConfig(withReviewBase(bad), "/dir")).toThrowError(
        /state "a": "reviewBase" must be a boolean or a non-blank string/,
      )
    }
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
                file: "F.md",
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

  it("compiles a requireRevert boolean onto the StateDef", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "a",
            states: {
              a: { actor: "human", message: "hi", on: { "* *": "b" } },
              b: {
                actor: "check",
                script: "s",
                file: "REVIEW.md",
                requireRevert: true,
                on: { C: "a" },
              },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states.b!.requireRevert).toBe(true)
  })

  it("compiles a state's own `entry: true` into `entries.manual` (empty when none declared)", () => {
    const shape = (withEntry: boolean) => ({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: { actor: "human", message: "hi", on: { "* *": "b" } },
            b: { actor: "human", message: "review", entry: withEntry, on: { C: "a" } },
          },
        },
      },
    })
    const { definition: withTrue } = compileWorkflowConfig(shape(true), "/dir")
    expect(withTrue.entries).toEqual({ default: "a", manual: ["b"] })
    // `entry: true` is authoring-only — never lands on the compiled StateDef.
    expect("entry" in withTrue.states.b!).toBe(false)

    const { definition: withFalse } = compileWorkflowConfig(shape(false), "/dir")
    expect(withFalse.entries).toEqual({ default: "a", manual: [] })
  })

  it("rejects a non-boolean `entry` flag on a state", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", entry: "yes" } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "entry" must be a boolean/)
  })

  it("collects `entry: true` from all three instantiations of a machine referenced three times, sorted", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "start",
            states: {
              start: { actor: "human", message: "hi", on: { "* *": "start" } },
              c: { machine: "leaf" },
              b: { machine: "leaf" },
              a: { machine: "leaf" },
            },
          },
          leaf: {
            entry: "check",
            states: { check: { actor: "human", message: "hi", entry: true, on: { C: "check" } } },
          },
        },
      },
      "/dir",
    )
    expect(definition.entries).toEqual({
      default: "start",
      manual: ["a.check", "b.check", "c.check"],
    })
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
    ).toThrowError(/state "a": must declare exactly one of script\/prompt\/message \(found 0\)/)

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
    ).toThrowError(/state "a": must declare exactly one of script\/prompt\/message \(found 2\)/)
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
                b: { actor: "human", message: "chore: b" },
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
                b: { actor: "human", message: "chore: b" },
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
                b: { actor: "human", message: "chore: b" },
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
              accept: { actor: "human", message: "chore: accept" },
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
              accept: { actor: "human", message: "chore: accept" },
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
                b: { actor: "human", message: "chore: b" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "on.\* \*.action" must be a string/)
  })

  it("rejects a state-level `model`, naming the machine to move it to", () => {
    expect(() =>
      compileWorkflowConfig(
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
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(
      /machine "root": state "working": unknown key\(s\) model \("model" is no longer a state key — declare it once on the machine that owns this state \("machines\.root\.model"\)\)/,
    )
  })

  it("omits `model` entirely when the owning machine declares none", () => {
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
              done: { actor: "human", message: "chore: done" },
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

  it("rejects a state-level `memory`, explaining scopes are positional", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", memory: "plan" } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(
      /state "a": unknown key\(s\) memory \("memory" no longer exists — a machine's memory scope is derived from its position in the tree and starts fresh on every entry\)/,
    )
  })

  it("rejects a state-level `commit`, explaining the squash finale was removed", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { commit: "chore: <%~ it.read('COMMIT_MSG.md') %>" } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(
      /state "a": unknown key\(s\) commit \("commit" no longer exists — the automatic squash finale was removed; a review sign-off lands an ordinary commit entering the workflow's initial state, and `gtd summary` prints a prompt for the process's own closing message instead\)/,
    )
  })

  it("aggregates a state-level `commit` finding alongside an unrelated bad `on` target in another state", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: "human", message: "hi", on: { "* **": "nowhere" } },
                b: { commit: "chore: b" },
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
        'state "b": unknown key(s) commit ("commit" no longer exists — the automatic squash finale was removed; a review sign-off lands an ordinary commit entering the workflow\'s initial state, and `gtd summary` prints a prompt for the process\'s own closing message instead)',
      )
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
              done: { actor: "human", message: "chore: done" },
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
              done: { actor: "human", message: "chore: done" },
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
              done: { actor: "human", message: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]!.file).toBe(".gtd/<%= it.vars.todoFile %>")
    expect(definition.states["working"]!.mode).toBe("qa")
  })
})

describe("compileWorkflowConfig — validateDefinition warnings (package 03)", () => {
  it("a workflow with warnings but no errors compiles successfully, surfacing the warning on the result rather than throwing", () => {
    const { definition, warnings } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "idle",
            states: {
              idle: {
                actor: "human",
                message: "waiting",
                on: { "* **": "checking" },
              },
              // Non-prompt, non-initial, non-human, no `C` row — the exact
              // shape `validateHasCRow` warns on.
              checking: {
                actor: "check",
                script: "npm run lint",
                on: { "A FEEDBACK.md": "idle" },
              },
            },
          },
        },
      },
      "/config-dir",
    )
    expect(definition.states["checking"]).toBeDefined()
    expect(warnings).toEqual(['state "checking" declares no "C" row'])
  })

  it("a workflow with no such state compiles with an empty warnings array", () => {
    const { warnings } = compileWorkflowConfig(draftCheckRevise, "/config-dir")
    expect(warnings).toEqual([])
  })
})

describe("the `stateFile` compiler — `file:` prepend and its four rejections", () => {
  const workflowWithFile = (file: string): Record<string, unknown> => ({
    entry: { default: "root" },
    machines: {
      root: {
        entry: "working",
        states: {
          working: { actor: "agent", prompt: "do the thing", file, on: { "* *": "done" } },
          done: { actor: "human", message: "chore: done" },
        },
      },
    },
  })

  it("accepts a subdirectory path and prepends `.gtd/`", () => {
    const { definition } = compileWorkflowConfig(workflowWithFile("packages/x.md"), "/dir")
    expect(definition.states["working"]!.file).toBe(".gtd/packages/x.md")
  })

  it("rejects a `..` segment with the exact message", () => {
    expect(() => compileWorkflowConfig(workflowWithFile("../REVIEW.md"), "/dir")).toThrowError(
      /state "working": "file" must not contain a "\.\." segment \(got "\.\.\/REVIEW\.md"\)/,
    )
  })

  it("rejects an absolute path with the exact message", () => {
    expect(() => compileWorkflowConfig(workflowWithFile("/REVIEW.md"), "/dir")).toThrowError(
      /state "working": "file" must not be an absolute path \(a leading "\/"\) \(got "\/REVIEW\.md"\)/,
    )
  })

  it("rejects a declared `.gtd/` prefix with the exact message", () => {
    expect(() => compileWorkflowConfig(workflowWithFile(".gtd/REVIEW.md"), "/dir")).toThrowError(
      /state "working": "file" is resolved under "\.gtd\/" automatically — drop the "\.gtd\/" prefix \(got "\.gtd\/REVIEW\.md"\)/,
    )
  })

  it("leaves a blank `file:` blank (not prepended), so the field's own non-empty rule still catches it", () => {
    expect(() => compileWorkflowConfig(workflowWithFile(""), "/dir")).toThrowError(
      /state "working": "file" must be a non-empty string/,
    )
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
              done: { actor: "human", message: "chore: done" },
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
                  file: "TODO.md",
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
                  file: "TODO.md",
                  mode: "yolo",
                  on: {},
                },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/"mode" must name a mode this workflow knows \(qa, review\).*\(got "yolo"\)/)
  })

  it("rejects a non-object `retry` value", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: { a: { actor: "human", message: "hi", retry: "nope" } },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/state "a": "retry" must be an object with "max" and "otherwise"/)
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
                b: { actor: "human", message: "chore: b" },
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
                b: { actor: "human", message: "chore: b" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/retry\.otherwise "nowhere" is not a defined state/)
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
        'state "a": must declare exactly one of script/prompt/message (found 0)',
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
        'state "idle": must declare exactly one of script/prompt/message (found 2)',
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
        'state "a": must declare exactly one of script/prompt/message (found 2)',
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

  it("a top-level `entry.review` key throws the migration message standalone, not merged with unrelated `detectLegacyShape` findings", () => {
    try {
      compileWorkflowConfig({ entry: { default: "root", review: "b" } }, "/dir")
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toBe(
        `workflow config:\n  - entry.review is no longer supported — declare \`entry: true\` on that state and enter it with \`gtd --entry <state>\``,
      )
    }
  })

  it("a top-level `entry.fix` key throws its own migration message", () => {
    expect(() => compileWorkflowConfig({ entry: { default: "root", fix: "b" } }, "/dir")).toThrow(
      "entry.fix is no longer supported — declare `entry: true` on that state and enter it with `gtd --entry <state>`",
    )
  })

  it("both `entry.review` and `entry.fix` present together throw both migration messages in one error", () => {
    try {
      compileWorkflowConfig({ entry: { default: "root", review: "b", fix: "c" } }, "/dir")
      expect.unreachable("expected compileWorkflowConfig to throw")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      expect(message).toContain(
        "entry.review is no longer supported — declare `entry: true` on that state and enter it with `gtd --entry <state>`",
      )
      expect(message).toContain(
        "entry.fix is no longer supported — declare `entry: true` on that state and enter it with `gtd --entry <state>`",
      )
    }
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

  it("a state-level `reviewEntry:`/`fixEntry:` key each surface the new `entry: true` hint instead of a bare unknown-key error", () => {
    try {
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "a",
              states: {
                a: { actor: "human", message: "hi", reviewEntry: true, on: { "* *": "b" } },
                b: { actor: "human", message: "hi", fixEntry: true, on: { "* *": "a" } },
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
        'state "a": unknown key(s) reviewEntry ("reviewEntry" no longer exists — declare "entry: true" on this state instead)',
      )
      expect(message).toContain(
        'state "b": unknown key(s) fixEntry ("fixEntry" no longer exists — declare "entry: true" on this state instead)',
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
        'state "b": must declare exactly one of script/prompt/message (found 2)',
      )
    }
  })
})

describe("compileWorkflowConfig — machine-level `model`", () => {
  it("stamps a machine-level `model` onto its own `prompt` state", () => {
    const { definition } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            model: "smart",
            entry: "working",
            states: {
              working: { actor: "agent", prompt: "do the thing", on: { "* *": "done" } },
              done: { actor: "human", message: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(definition.states["working"]!.model).toBe("smart")
    expect(definition.states["done"]).not.toHaveProperty("model")
  })

  it("rejects a non-string machine-level `model` as a config-shape error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              model: 42,
              entry: "working",
              states: {
                working: { actor: "agent", prompt: "do the thing", on: { "* *": "done" } },
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/machines\.root: "model" must be a non-empty string/)
  })

  it("rejects a blank machine-level `model` as a config-shape error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              model: "",
              entry: "working",
              states: {
                working: { actor: "agent", prompt: "do the thing", on: { "* *": "done" } },
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/machines\.root: "model" must be a non-empty string/)
  })

  it("rejects a machine declaring `model` with no `prompt` state anywhere in its own states", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              model: "smart",
              entry: "working",
              states: {
                working: { actor: "check", script: "npm test", on: { C: "done" } },
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/machine "root": declares "model" but has no "prompt" state/)
  })
})

describe("compileWorkflowConfig — machine-level `system`", () => {
  it("accepts `system:` as a known machine key (a typo is still an unknown-key error)", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              system: "You are a careful agent.",
              entry: "working",
              states: {
                working: { actor: "agent", prompt: "do the thing", on: { "* *": "done" } },
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        "/dir",
      ),
    ).not.toThrow()

    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              systemm: "typo",
              entry: "working",
              states: {
                working: { actor: "agent", prompt: "do the thing", on: { "* *": "done" } },
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/machine "root": unknown key\(s\) systemm/)
  })

  it("rejects a blank machine-level `system` as a config-shape error", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              system: "",
              entry: "working",
              states: {
                working: { actor: "agent", prompt: "do the thing", on: { "* *": "done" } },
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/machines\.root: "system" must be a non-empty string/)
  })

  it("rejects a machine declaring `system` with no `prompt` state anywhere in its own states", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              system: "You are a careful agent.",
              entry: "working",
              states: {
                working: { actor: "check", script: "npm test", on: { C: "done" } },
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(/machine "root": declares "system" but has no "prompt" state/)
  })

  it("rejects a state-level `system`, naming the machine to move it to", () => {
    expect(() =>
      compileWorkflowConfig(
        {
          entry: { default: "root" },
          machines: {
            root: {
              entry: "working",
              states: {
                working: {
                  actor: "agent",
                  prompt: "do the thing",
                  system: "You are a careful agent.",
                  on: { "* *": "done" },
                },
                done: { actor: "human", message: "chore: done" },
              },
            },
          },
        },
        "/dir",
      ),
    ).toThrowError(
      /machine "root": state "working": unknown key\(s\) system \("system" is no longer a state key — declare it once on the machine that owns this state \("machines\.root\.system"\)\)/,
    )
  })
})

describe("inlineWorkflowFileRefs — machine-level `system`/`model` file references", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gtd-pattern-config-machine-fileref-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("inlines a `./`-relative machine-level `system` from the declaring config file's directory", () => {
    writeFileSync(join(dir, "persona.md"), "You are a careful agent.\n")
    const errors: string[] = []
    const result = inlineWorkflowFileRefs(
      { machines: { root: { system: "./persona.md" } } },
      dir,
      errors,
    ) as { machines: { root: { system: string } } }
    expect(errors).toEqual([])
    expect(result.machines.root.system).toBe("You are a careful agent.\n")
  })

  it("resolves a `../`-relative machine-level `system` from the declaring config file's directory, not the process directory", () => {
    writeFileSync(join(dir, "persona.md"), "You are a careful agent.\n")
    const sub = join(dir, "sub")
    mkdirSync(sub)
    const errors: string[] = []
    const result = inlineWorkflowFileRefs(
      { machines: { root: { system: "../persona.md" } } },
      sub,
      errors,
    ) as { machines: { root: { system: string } } }
    expect(errors).toEqual([])
    expect(result.machines.root.system).toBe("You are a careful agent.\n")
  })

  it("a missing machine-level `system` file reference is a load error naming the machine and key", () => {
    const errors: string[] = []
    inlineWorkflowFileRefs({ machines: { root: { system: "./missing-persona.md" } } }, dir, errors)
    expect(errors).toEqual([
      `machine "root" (system): file reference "./missing-persona.md" does not exist (resolved to "${join(dir, "missing-persona.md")}")`,
    ])
  })

  it("still resolves a machine's `system` file reference (and reports its missing-file error) when the same machine's `states:` is malformed", () => {
    const errors: string[] = []
    const result = inlineWorkflowFileRefs(
      { machines: { root: { system: "./missing-persona.md", states: "not an object" } } },
      dir,
      errors,
    ) as { machines: { root: { states: unknown } } }
    expect(errors).toEqual([
      `machine "root" (system): file reference "./missing-persona.md" does not exist (resolved to "${join(dir, "missing-persona.md")}")`,
    ])
    // The malformed `states:` passes through untouched — `compileWorkflowConfig`/`validateDefinition` own that finding.
    expect(result.machines.root.states).toBe("not an object")
  })

  it("`model: ./m.txt` stays the literal string — `model` gains no file-ref inlining", () => {
    const errors: string[] = []
    const result = inlineWorkflowFileRefs(
      { machines: { root: { model: "./m.txt" } } },
      dir,
      errors,
    ) as { machines: { root: { model: string } } }
    expect(errors).toEqual([])
    expect(result.machines.root.model).toBe("./m.txt")
  })

  it("a non-object state entry inside an otherwise-well-formed `states:` passes through untouched", () => {
    const errors: string[] = []
    const result = inlineWorkflowFileRefs(
      { machines: { root: { states: { a: "nope" } } } },
      dir,
      errors,
    ) as { machines: { root: { states: Record<string, unknown> } } }
    expect(errors).toEqual([])
    expect(result.machines.root.states["a"]).toBe("nope")
  })
})

describe("inlineWorkflowFileRefs — top-level `summary` file reference", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gtd-pattern-config-summary-fileref-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("inlines a `./`-relative top-level `summary` from the declaring config file's directory", () => {
    writeFileSync(join(dir, "summary.md"), "Wrap it up.\n")
    const errors: string[] = []
    const result = inlineWorkflowFileRefs({ summary: "./summary.md" }, dir, errors) as {
      summary: string
    }
    expect(errors).toEqual([])
    expect(result.summary).toBe("Wrap it up.\n")
  })

  it("a missing top-level `summary` file reference is a load error", () => {
    const errors: string[] = []
    inlineWorkflowFileRefs({ summary: "./missing.md" }, dir, errors)
    expect(errors).toEqual([
      `"summary": file reference "./missing.md" does not exist (resolved to "${join(dir, "missing.md")}")`,
    ])
  })
})

describe("compileWorkflowConfig — `scopes`", () => {
  it("populates `scopes` from the flattener's instance paths, covering every state including check/human/commit states", () => {
    const { scopes } = compileWorkflowConfig(draftCheckRevise, "/config-dir")
    expect(scopes).toEqual({
      idle: "",
      checking: "",
      revising: "",
      squashing: "",
      done: "",
    })
  })

  it("gives a referenced child machine's states a scope distinct from the root's", () => {
    const { scopes } = compileWorkflowConfig(
      {
        entry: { default: "root" },
        machines: {
          root: {
            entry: "child",
            states: {
              child: { machine: "leaf" },
            },
          },
          leaf: {
            entry: "working",
            states: {
              working: { actor: "agent", prompt: "do the thing", on: { "* *": "done" } },
              done: { actor: "human", message: "chore: done" },
            },
          },
        },
      },
      "/dir",
    )
    expect(scopes).toEqual({ "child.working": "child", "child.done": "child" })
  })
})

describe("compileState — non-object `raw` guard", () => {
  it("pushes a finding and compiles to an empty StateDef when `raw` isn't an object — unreachable via compileWorkflowConfig itself, since src/Machines.ts's emitState already normalizes a non-object state to {} before compileState ever sees it", () => {
    const errors: string[] = []
    const def = compileState("bogus", "nope", "/dir", errors, true)
    expect(def).toEqual({})
    expect(errors).toEqual(['state "bogus": must be an object, got string'])
  })
})

describe("assertScopesCoverStates — compiler invariant", () => {
  it("pushes no finding when every state has a scope", () => {
    const errors: string[] = []
    assertScopesCoverStates(["a", "b"], { a: "", b: "child" }, errors)
    expect(errors).toEqual([])
  })

  it("pushes an internal-error finding naming the compiler, not the author, when a state is missing from `scopes`", () => {
    const errors: string[] = []
    assertScopesCoverStates(["a", "b"], { a: "" }, errors)
    expect(errors).toEqual([
      'internal error: scopes map produced by the flattener is missing state "b"',
    ])
  })
})

describe("compileWorkflowConfig — top-level `summary:`", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gtd-pattern-config-summary-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("is `undefined` when absent, and compilation succeeds", () => {
    const { definition } = compileWorkflowConfig(draftCheckRevise, "/config-dir")
    expect(definition.summary).toBeUndefined()
  })

  it("compiles a valid non-blank string verbatim", () => {
    const { definition } = compileWorkflowConfig(
      { ...draftCheckRevise, summary: "Write the process's closing message." },
      "/config-dir",
    )
    expect(definition.summary).toBe("Write the process's closing message.")
  })

  it("rejects a blank string", () => {
    for (const blank of ["", "   "]) {
      expect(() =>
        compileWorkflowConfig({ ...draftCheckRevise, summary: blank }, "/config-dir"),
      ).toThrowError(/"summary" must not be blank/)
    }
  })

  it("rejects a non-string value", () => {
    for (const bad of [42, { nested: true }]) {
      expect(() =>
        compileWorkflowConfig({ ...draftCheckRevise, summary: bad }, "/config-dir"),
      ).toThrowError(/"summary" must be a string/)
    }
  })

  it("inlines a `./`-relative file reference at load time", () => {
    writeFileSync(join(dir, "summary.md"), "Write the process's closing message.\n")
    const { definition } = compileWorkflowConfig(
      { ...draftCheckRevise, summary: "./summary.md" },
      dir,
    )
    expect(definition.summary).toBe("Write the process's closing message.\n")
  })

  it("a blank inlined file is a load error, same as an inline blank string", () => {
    writeFileSync(join(dir, "summary.md"), "   \n")
    expect(() =>
      compileWorkflowConfig({ ...draftCheckRevise, summary: "./summary.md" }, dir),
    ).toThrowError(/"summary" must not be blank/)
  })

  it("a missing file reference is a load error naming the file reference", () => {
    expect(() =>
      compileWorkflowConfig({ ...draftCheckRevise, summary: "./does-not-exist.md" }, dir),
    ).toThrowError(/"summary": file reference "\.\/does-not-exist\.md" does not exist/)
  })

  it("is accepted as a known top-level key alongside entry/machines/vars/modes", () => {
    expect(() =>
      compileWorkflowConfig({ ...draftCheckRevise, summary: "Wrap it up." }, "/config-dir"),
    ).not.toThrowError(/unknown top-level key/)
  })
})
