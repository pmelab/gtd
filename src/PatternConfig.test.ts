import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { compileWorkflowConfig, inlineWorkflowFileRefs, type ReadFile } from "./PatternConfig.js"
import { isSeededValidateCommand, seededValidateCommand } from "./SteeringFormats.js"
import { resolveMode, validateScriptFor } from "./SteeringMode.js"
import { Host } from "./platform/index.js"
import type { TemplateContext } from "./PatternTemplates.js"
import type { Diagnostic } from "./workflow/index.js"

/**
 * `inlineWorkflowFileRefs`/`resolveContent` etc. no longer default to a
 * built-in `nodeReadFile` (that was a production-dead back door around
 * `WorkflowFiles` — `src/workflow/compile.ts` is the one real caller, and it
 * always injects `files.read`) — `readFile` is a required parameter now, so
 * these tests (which write real files to a real `mkdtempSync` directory)
 * pass this real-`fs` reader explicitly, the same shape `nodeReadFile` was.
 */
const realReadFile: ReadFile = (path) => {
  try {
    return readFileSync(path, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw e
  }
}

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

/** Every error-severity diagnostic's message from a `compileWorkflowConfig` call — `compileWorkflowConfig` itself never throws. */
const compileErrors = (...args: Parameters<typeof compileWorkflowConfig>): string[] =>
  compileWorkflowConfig(...args)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => d.message)

describe("compileWorkflowConfig — realistic multi-state workflow", () => {
  it("compiles every state with its content kind, actor, and on-edges", () => {
    const { definition } = compileWorkflowConfig(draftCheckRevise)
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
    const { vars } = compileWorkflowConfig({
      ...draftCheckRevise,
      vars: { greeting: "hi", attempts: 3, strict: true },
    })
    expect(vars).toEqual({ greeting: "hi", attempts: "3", strict: "true" })
  })

  it("`vars` is `{}` when no `vars:` key is given", () => {
    const { vars } = compileWorkflowConfig(draftCheckRevise)
    expect(vars).toEqual({})
  })

  it("rejects a non-object `vars:` value", () => {
    const messages = compileErrors({ ...draftCheckRevise, vars: ["nope"] })
    expect(
      messages.some((m) => /"vars" must be a mapping of name -> scalar value, got array/.test(m)),
    ).toBe(true)
  })

  it("rejects an object/array value nested inside `vars:`, dropping just that key", () => {
    const messages = compileErrors({
      ...draftCheckRevise,
      vars: { good: "ok", bad: { nested: true }, alsoBad: [1, 2] },
    })
    expect(messages).toContain('"vars.bad" must be a string, number, or boolean, got object')
    expect(messages).toContain('"vars.alsoBad" must be a string, number, or boolean, got array')
  })

  it("aggregates a bad `vars:` entry alongside an unrelated config-shape error", () => {
    const messages = compileErrors({
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
    })
    expect(messages).toContain('state "a": "actor" must be a string')
    expect(messages).toContain('"vars.bad" must be a string, number, or boolean, got object')
  })

  it("the `modes:` key compiles onto the definition, verbatim commands and all", () => {
    const { definition } = compileWorkflowConfig({
      ...draftCheckRevise,
      modes: {
        adr: {
          format: "./scripts/fmt-adr.sh <%= it.file %>",
          validate: "adr-lint <%= it.file %>",
        },
        spec: { validate: "npx ajv -s spec.schema.json -d <%= it.file %>" },
      },
    })
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
    const { definition } = compileWorkflowConfig(draftCheckRevise)
    expect(definition.modes).toEqual({
      qa: { validate: seededValidateCommand("qa") },
      review: { validate: seededValidateCommand("review") },
    })
  })

  it("keeps the seed's `validate:` when a workflow overrides only `format:` for a built-in name", () => {
    const { definition } = compileWorkflowConfig({
      ...draftCheckRevise,
      modes: { qa: { format: "npx prettier --write <%= it.file %>" } },
    })
    expect(definition.modes).toEqual({
      qa: {
        format: "npx prettier --write <%= it.file %>",
        validate: seededValidateCommand("qa"),
      },
      review: { validate: seededValidateCommand("review") },
    })
  })

  it("fully displaces the seed when a workflow declares both halves for a built-in name", () => {
    const { definition } = compileWorkflowConfig({
      ...draftCheckRevise,
      modes: {
        qa: { format: "my-fmt <%= it.file %>", validate: "my-qa-linter <%= it.file %>" },
      },
    })
    const qa = definition.modes?.["qa"]
    expect(qa).toEqual({ format: "my-fmt <%= it.file %>", validate: "my-qa-linter <%= it.file %>" })
    expect(isSeededValidateCommand("qa", qa?.validate ?? "")).toBe(false)
  })

  it("seeds a usable `validate:` command that round-trips through resolveMode/validateScriptFor", async () => {
    const { definition } = compileWorkflowConfig(draftCheckRevise)
    const resolved = resolveMode(definition, "drafting", "qa")
    if (resolved.kind !== "resolved") throw new Error("expected a resolved mode")
    expect(resolved.validate).toEqual({ kind: "command", command: seededValidateCommand("qa") })

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
    const { script } = await Effect.runPromise(
      validateScriptFor(resolved, ".gtd/TODO.md", context).pipe(
        Effect.provide(Host.layer({ root: "/repo", home: "/repo", env: {} })),
      ),
    )
    expect(script).toContain(`gtd check qa '.gtd/TODO.md'`)
  })

  it("rejects a non-object `modes:` value", () => {
    const messages = compileErrors({ ...draftCheckRevise, modes: ["nope"] })
    expect(
      messages.some((m) =>
        /"modes" must be a mapping of mode name -> \{ format, validate \}, got array/.test(m),
      ),
    ).toBe(true)
  })

  it("rejects a non-object mode entry, an unknown key inside one, and a non-string command", () => {
    const messages = compileErrors({
      ...draftCheckRevise,
      modes: {
        scalar: "adr-lint",
        extra: { validate: "ok", lint: "nope" },
        typed: { format: 42 },
      },
    })
    expect(messages).toContain(
      'mode "scalar": must be an object with "format" and/or "validate", got string',
    )
    expect(messages.some((m) => m.includes('mode "extra": unknown key(s) lint'))).toBe(true)
    expect(messages).toContain('mode "typed": "format" must be a shell command (string)')
  })

  it("accepts a `modes:` entry declaring neither command — the format-only tier any workflow can use", () => {
    const { definition } = compileWorkflowConfig({ ...draftCheckRevise, modes: { adr: {} } })
    expect(definition.modes?.["adr"]).toEqual({})
  })

  it("layers the `rcModes` argument over the workflow's own `modes:`, per half", () => {
    const { definition } = compileWorkflowConfig(
      {
        ...draftCheckRevise,
        modes: { adr: { format: "workflow-fmt", validate: "adr-lint <%= it.file %>" } },
      },
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
      { adr: { validate: "adr-lint <%= it.file %>" } },
    )
    expect(definition.modes).toEqual({
      qa: { validate: seededValidateCommand("qa") },
      review: { validate: seededValidateCommand("review") },
      adr: { validate: "adr-lint <%= it.file %>" },
    })
  })

  it("accepts a state whose `mode:` names a declared mode", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["a"]!.mode).toBe("adr")
  })
})

describe("compileWorkflowConfig — `on` order preservation", () => {
  it("preserves multi-row declaration order as OnEdge tuples", () => {
    const { definition } = compileWorkflowConfig({
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
    })
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

    const { definition } = compileWorkflowConfig(raw)
    expect(definition.states["start"]!.on).toEqual([
      ["A z.md", "a"],
      ["A a.md", "b"],
      ["C", "c"],
    ])
  })

  it("compiles the { to, describe } object form, carrying describe as the edge's third element, while the string form stays a two-element edge", () => {
    const { definition } = compileWorkflowConfig({
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
    })
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
    const { value: inlined } = inlineWorkflowFileRefs(
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
      realReadFile,
    )
    const { definition } = compileWorkflowConfig(inlined)
    expect(definition.states["checking"]!.script).toBe("#!/bin/sh\nnpm test\n")
  })

  it("inlines a `../`-relative file reference resolved from configDir", () => {
    writeFileSync(join(dir, "shared-prompt.md"), "Do the thing.\n")
    const sub = join(dir, "sub")
    mkdirSync(sub)
    const { value: inlined } = inlineWorkflowFileRefs(
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
      realReadFile,
    )
    const { definition } = compileWorkflowConfig(inlined)
    expect(definition.states["working"]!.prompt).toBe("Do the thing.\n")
  })

  it("treats any other string as inline template source, verbatim", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["idle"]!.message).toBe(
      "hello, this contains a / slash but is not a file ref",
    )
  })

  it("a missing file reference is a load error, never silently inline text", () => {
    const { diagnostics: refDiagnostics } = inlineWorkflowFileRefs(
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
      realReadFile,
    )
    const messages = refDiagnostics.map((d) => d.message)
    expect(
      messages.some((m) => /file reference "\.\/does-not-exist\.sh" does not exist/.test(m)),
    ).toBe(true)
  })

  it("an existing but unreadable file reference is a load error naming the read failure", () => {
    writeFileSync(join(dir, "check.sh"), "#!/bin/sh\nnpm test\n")
    const throwingFileRefs: ReadFile = () => {
      throw new Error("EACCES: permission denied")
    }
    const { diagnostics: refDiagnostics } = inlineWorkflowFileRefs(
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
      throwingFileRefs,
    )
    const messages = refDiagnostics.map((d) => d.message)
    expect(
      messages.some((m) =>
        /file reference "\.\/check\.sh" could not be read: EACCES: permission denied/.test(m),
      ),
    ).toBe(true)
  })
})

describe("compileWorkflowConfig — config-shape validation", () => {
  it("rejects a non-object top-level value", () => {
    expect(compileErrors("nope").some((m) => /must be an object/.test(m))).toBe(true)
    expect(compileErrors(null).some((m) => /must be an object/.test(m))).toBe(true)
    expect(compileErrors(["nope"]).some((m) => /must be an object/.test(m))).toBe(true)
  })

  it("rejects an unknown top-level key", () => {
    const messages = compileErrors({ machines: {}, bogus: 1 })
    expect(messages.some((m) => /unknown top-level key\(s\) bogus/.test(m))).toBe(true)
  })

  it("rejects a missing entry.default or one that names an undeclared machine", () => {
    expect(compileErrors({}).some((m) => /"entry\.default" must name a machine/.test(m))).toBe(true)
    expect(
      compileErrors({ entry: { default: "root" }, machines: {} }).some((m) =>
        /entry\.default: unknown machine "root"/.test(m),
      ),
    ).toBe(true)
  })

  it("rejects a non-object `machines:` value", () => {
    const messages = compileErrors({ entry: { default: "root" }, machines: "nope" })
    expect(
      messages.some((m) =>
        /"machines" must be a mapping of machine name -> \{ params\?, entry, states \}, got string/.test(
          m,
        ),
      ),
    ).toBe(true)
  })

  it("rejects a non-object state", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: { root: { entry: "a", states: { a: "nope" } } },
    })
    expect(
      messages.some((m) => /machines\.root\.a: state must be an object, got string/.test(m)),
    ).toBe(true)
  })

  it("rejects an unknown state key", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: { actor: "human", message: "hi", bogusKey: true },
          },
        },
      },
    })
    expect(messages.some((m) => /state "a": unknown key\(s\) bogusKey/.test(m))).toBe(true)
  })

  it("rejects a non-string actor", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: { root: { entry: "a", states: { a: { actor: 1, message: "hi" } } } },
    })
    expect(messages.some((m) => /state "a": "actor" must be a string/.test(m))).toBe(true)
  })

  it("rejects reviewWindow as an unknown key — the field no longer exists", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: { a: { actor: "human", message: "hi", reviewWindow: true } },
        },
      },
    })
    expect(messages.some((m) => /state "a": unknown key\(s\) reviewWindow/.test(m))).toBe(true)
  })

  it("compiles reviewBase's boolean-or-template shape: `true` verbatim, a non-blank string verbatim", () => {
    const { definition } = compileWorkflowConfig({
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
    })
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
      const messages = compileErrors(withReviewBase(bad))
      expect(
        messages.some((m) =>
          /state "a": "reviewBase" must be a boolean or a non-blank string/.test(m),
        ),
      ).toBe(true)
    }
  })

  it("compiles a requireProgress boolean onto the StateDef", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states.b!.requireProgress).toBe(true)
  })

  it("compiles a requireRevert boolean onto the StateDef", () => {
    const { definition } = compileWorkflowConfig({
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
    })
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
    const { definition: withTrue } = compileWorkflowConfig(shape(true))
    expect(withTrue.entries).toEqual({ default: "a", manual: ["b"] })
    // `entry: true` is authoring-only — never lands on the compiled StateDef.
    expect("entry" in withTrue.states.b!).toBe(false)

    const { definition: withFalse } = compileWorkflowConfig(shape(false))
    expect(withFalse.entries).toEqual({ default: "a", manual: [] })
  })

  it("rejects a non-boolean `entry` flag on a state", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: { a: { actor: "human", message: "hi", entry: "yes" } },
        },
      },
    })
    expect(messages.some((m) => /state "a": "entry" must be a boolean/.test(m))).toBe(true)
  })

  it("collects `entry: true` from all three instantiations of a machine referenced three times, sorted", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.entries).toEqual({
      default: "start",
      manual: ["a.check", "b.check", "c.check"],
    })
  })

  it("rejects zero content keys and more than one content key", () => {
    const zeroMessages = compileErrors({
      entry: { default: "root" },
      machines: { root: { entry: "a", states: { a: { actor: "human" } } } },
    })
    expect(
      zeroMessages.some((m) =>
        /state "a": must declare exactly one of script\/prompt\/message \(found 0\)/.test(m),
      ),
    ).toBe(true)

    const twoMessages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: { actor: "human", message: "hi", prompt: "also this" },
          },
        },
      },
    })
    expect(
      twoMessages.some((m) =>
        /state "a": must declare exactly one of script\/prompt\/message \(found 2\)/.test(m),
      ),
    ).toBe(true)
  })

  it("rejects a non-string content value", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: { root: { entry: "a", states: { a: { actor: "human", message: 42 } } } },
    })
    expect(messages.some((m) => /state "a": "message" must be a string/.test(m))).toBe(true)
  })

  it("rejects an `on` value that is not a mapping", () => {
    const messages = compileErrors({
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
    })
    expect(
      messages.some((m) => /state "a": "on" must be a mapping of pattern -> target state/.test(m)),
    ).toBe(true)
  })

  it("rejects an `on` value that is neither a target string nor a { to, describe } object", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: { actor: "human", message: "hi", on: { "* *": 1 } },
          },
        },
      },
    })
    expect(
      messages.some((m) =>
        /state "a": "on" entry for pattern "\* \*" must be a target state name \(string\) or a \{ to, describe \} object/.test(
          m,
        ),
      ),
    ).toBe(true)
  })

  it('rejects an object `on` entry whose "to" is not a string', () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: { actor: "human", message: "hi", on: { "* *": { to: 1 } } },
          },
        },
      },
    })
    expect(
      messages.some((m) =>
        /state "a": "on.\* \*.to" must be a target state name \(string\)/.test(m),
      ),
    ).toBe(true)
  })

  it('rejects an object `on` entry whose "describe" is not a string', () => {
    const messages = compileErrors({
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
    })
    expect(messages.some((m) => /state "a": "on.\* \*.describe" must be a string/.test(m))).toBe(
      true,
    )
  })

  it("rejects an unknown key inside an object `on` entry", () => {
    const messages = compileErrors({
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
    })
    expect(
      messages.some((m) =>
        /state "a": "on" entry for pattern "\* \*" has unknown key\(s\) explain/.test(m),
      ),
    ).toBe(true)
  })

  it("compiles the `action` field through onto the edge's fourth element, alongside `describe`", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["gate"]!.on).toEqual([
      ["C", "accept", "Change nothing to accept and proceed.", "Accept plan"],
      ["* **", "revise"],
    ])
  })

  it("compiles an `action`-without-`describe` edge, placing an explicit `undefined` in the third slot", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["gate"]!.on).toEqual([["C", "accept", undefined, "Accept plan"]])
  })

  it('rejects an object `on` entry whose "action" is not a string', () => {
    const messages = compileErrors({
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
    })
    expect(messages.some((m) => /state "a": "on.\* \*.action" must be a string/.test(m))).toBe(true)
  })

  it("rejects a state-level `model`, naming the machine to move it to", () => {
    const messages = compileErrors({
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
    })
    expect(
      messages.some((m) =>
        /machine "root": state "working": unknown key\(s\) model \("model" is no longer a state key — declare it once on the machine that owns this state \("machines\.root\.model"\)\)/.test(
          m,
        ),
      ),
    ).toBe(true)
  })

  it("omits `model` entirely when the owning machine declares none", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["working"]).not.toHaveProperty("model")
  })

  it("rejects a non-string `model` as a config-shape error", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: { a: { actor: "human", message: "hi", model: 42 } },
        },
      },
    })
    expect(messages.some((m) => /state "a": "model" must be a string/.test(m))).toBe(true)
  })

  it("aggregates a bad `model` alongside an unrelated config-shape error", () => {
    const messages = compileErrors({
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
    })
    expect(messages).toContain('state "a": "model" must be a string')
    expect(messages).toContain('state "a": "on" target "nowhere" is not a defined state')
  })

  it("rejects a state-level `memory`, explaining scopes are positional", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: { a: { actor: "human", message: "hi", memory: "plan" } },
        },
      },
    })
    expect(
      messages.some((m) =>
        /state "a": unknown key\(s\) memory \("memory" no longer exists — a machine's memory scope is derived from its position in the tree and starts fresh on every entry\)/.test(
          m,
        ),
      ),
    ).toBe(true)
  })

  it("rejects a state-level `commit`, explaining the squash finale was removed", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: { a: { commit: "chore: <%~ it.read('COMMIT_MSG.md') %>" } },
        },
      },
    })
    expect(
      messages.some((m) =>
        /state "a": unknown key\(s\) commit \("commit" no longer exists — the automatic squash finale was removed; a review sign-off lands an ordinary commit entering the workflow's initial state, and `gtd summary` prints a prompt for the process's own closing message instead\)/.test(
          m,
        ),
      ),
    ).toBe(true)
  })

  it("aggregates a state-level `commit` finding alongside an unrelated bad `on` target in another state", () => {
    const messages = compileErrors({
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
    })
    expect(messages).toContain(
      'state "b": unknown key(s) commit ("commit" no longer exists — the automatic squash finale was removed; a review sign-off lands an ordinary commit entering the workflow\'s initial state, and `gtd summary` prints a prompt for the process\'s own closing message instead)',
    )
    expect(messages).toContain('state "a": "on" target "nowhere" is not a defined state')
  })

  it("compiles a `label` string through onto the state", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["working"]!.label).toBe("Build")
  })

  it("omits `label` entirely when the state declares none", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["working"]).not.toHaveProperty("label")
  })

  it("rejects a non-string `label` as a config-shape error", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: { a: { actor: "human", message: "hi", label: 42 } },
        },
      },
    })
    expect(messages.some((m) => /state "a": "label" must be a string/.test(m))).toBe(true)
  })

  it("aggregates a bad `label` alongside an unrelated config-shape error", () => {
    const messages = compileErrors({
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
    })
    expect(messages).toContain('state "a": "label" must be a string')
    expect(messages).toContain('state "a": "on" target "nowhere" is not a defined state')
  })

  it("compiles `file`/`mode` strings through onto the state", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["working"]!.file).toBe(".gtd/<%= it.vars.todoFile %>")
    expect(definition.states["working"]!.mode).toBe("qa")
  })
})

describe("compileWorkflowConfig — validateDefinition warnings (package 03)", () => {
  it('a workflow with warnings but no errors compiles successfully, surfacing the warning as a `severity: "warning"` diagnostic rather than throwing', () => {
    const { definition, diagnostics } = compileWorkflowConfig({
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
    })
    expect(definition.states["checking"]).toBeDefined()
    const warnings = diagnostics.filter((d) => d.severity === "warning").map((d) => d.message)
    expect(warnings).toEqual(['state "checking" declares no "C" row'])
  })

  it("a workflow with no such state compiles with no warning diagnostics", () => {
    const { diagnostics } = compileWorkflowConfig(draftCheckRevise)
    expect(diagnostics.filter((d) => d.severity === "warning")).toEqual([])
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
    const { definition } = compileWorkflowConfig(workflowWithFile("packages/x.md"))
    expect(definition.states["working"]!.file).toBe(".gtd/packages/x.md")
  })

  it("rejects a `..` segment with the exact message", () => {
    const messages = compileErrors(workflowWithFile("../REVIEW.md"))
    expect(
      messages.some((m) =>
        /state "working": "file" must not contain a "\.\." segment \(got "\.\.\/REVIEW\.md"\)/.test(
          m,
        ),
      ),
    ).toBe(true)
  })

  it("rejects an absolute path with the exact message", () => {
    const messages = compileErrors(workflowWithFile("/REVIEW.md"))
    expect(
      messages.some((m) =>
        /state "working": "file" must not be an absolute path \(a leading "\/"\) \(got "\/REVIEW\.md"\)/.test(
          m,
        ),
      ),
    ).toBe(true)
  })

  it("rejects a declared `.gtd/` prefix with the exact message", () => {
    const messages = compileErrors(workflowWithFile(".gtd/REVIEW.md"))
    expect(
      messages.some((m) =>
        /state "working": "file" is resolved under "\.gtd\/" automatically — drop the "\.gtd\/" prefix \(got "\.gtd\/REVIEW\.md"\)/.test(
          m,
        ),
      ),
    ).toBe(true)
  })

  it("leaves a blank `file:` blank (not prepended), so the field's own non-empty rule still catches it", () => {
    const messages = compileErrors(workflowWithFile(""))
    expect(messages.some((m) => /state "working": "file" must be a non-empty string/.test(m))).toBe(
      true,
    )
  })

  it("omits `file`/`mode` entirely when the state declares neither", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["working"]).not.toHaveProperty("file")
    expect(definition.states["working"]).not.toHaveProperty("mode")
  })

  it("rejects a non-string `file` as a config-shape error", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: { a: { actor: "human", message: "hi", file: 42 } },
        },
      },
    })
    expect(messages.some((m) => /state "a": "file" must be a string/.test(m))).toBe(true)
  })

  it("rejects a non-string `mode` as a config-shape error", () => {
    const messages = compileErrors({
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
    })
    expect(messages.some((m) => /state "a": "mode" must be a string/.test(m))).toBe(true)
  })

  it("surfaces an undefined `mode` string via `validateDefinition`'s aggregated error", () => {
    const messages = compileErrors({
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
    })
    expect(
      messages.some((m) =>
        /"mode" must name a mode this workflow knows \(qa, review\).*\(got "yolo"\)/.test(m),
      ),
    ).toBe(true)
  })

  it("rejects a non-object `retry` value", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: { a: { actor: "human", message: "hi", retry: "nope" } },
        },
      },
    })
    expect(
      messages.some((m) =>
        /state "a": "retry" must be an object with "max" and "otherwise"/.test(m),
      ),
    ).toBe(true)
  })

  it("rejects a malformed `retry` block", () => {
    const messages = compileErrors({
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
    })
    expect(messages.some((m) => /state "a": "retry" has unknown key\(s\) bogus/.test(m))).toBe(true)
  })

  it("rejects retry.otherwise naming an undeclared state (surfaced from validateDefinition)", () => {
    const messages = compileErrors({
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
    })
    expect(messages.some((m) => /retry\.otherwise "nowhere" is not a defined state/.test(m))).toBe(
      true,
    )
  })

  it("collects multiple shape errors into one thrown message", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: {
          entry: "a",
          states: {
            a: { actor: 1, model: 42 },
          },
        },
      },
    })
    expect(messages).toContain('state "a": "actor" must be a string')
    expect(messages).toContain('state "a": "model" must be a string')
    expect(messages).toContain(
      'state "a": must declare exactly one of script/prompt/message (found 0)',
    )
  })

  it("aggregates a config-shape finding together with a validateDefinition finding (docs' worked example)", () => {
    const messages = compileErrors({
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
    })
    expect(messages).toContain(
      'state "idle": must declare exactly one of script/prompt/message (found 2)',
    )
    expect(messages).toContain('state "idle": "on" target "nowhere" is not a defined state')
  })

  it("aggregates a content-kind finding in one state with an unrelated bad `on` target in another", () => {
    const messages = compileErrors({
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
    })
    expect(messages).toContain(
      'state "a": must declare exactly one of script/prompt/message (found 2)',
    )
    expect(messages).toContain('state "b": "on" target "nowhere" is not a defined state')
  })
})

describe("compileWorkflowConfig — legacy shape detection & error sequencing", () => {
  it("each legacy top-level key throws its own migration message", () => {
    expect(
      compileErrors({ states: {} }).some((m) =>
        /top-level "states:" is no longer supported — declare a machine under "machines:" and name it in "entry\.default:"/.test(
          m,
        ),
      ),
    ).toBe(true)
    expect(
      compileErrors({ submachines: {} }).some((m) =>
        /top-level "submachines:" is no longer supported — declare machines directly under "machines:"/.test(
          m,
        ),
      ),
    ).toBe(true)
    expect(
      compileErrors({ use: {} }).some((m) => /top-level "use:" is no longer supported/.test(m)),
    ).toBe(true)
  })

  it("a top-level `entry.review` key throws the migration message standalone, not merged with unrelated `detectLegacyShape` findings", () => {
    const messages = compileErrors({ entry: { default: "root", review: "b" } })
    expect(messages).toEqual([
      "entry.review is no longer supported — declare `entry: true` on that state and enter it with `gtd --entry <state>`",
    ])
  })

  it("a top-level `entry.fix` key throws its own migration message", () => {
    const messages = compileErrors({ entry: { default: "root", fix: "b" } })
    expect(messages).toContain(
      "entry.fix is no longer supported — declare `entry: true` on that state and enter it with `gtd --entry <state>`",
    )
  })

  it("both `entry.review` and `entry.fix` present together throw both migration messages in one error", () => {
    const messages = compileErrors({ entry: { default: "root", review: "b", fix: "c" } })
    expect(messages).toContain(
      "entry.review is no longer supported — declare `entry: true` on that state and enter it with `gtd --entry <state>`",
    )
    expect(messages).toContain(
      "entry.fix is no longer supported — declare `entry: true` on that state and enter it with `gtd --entry <state>`",
    )
  })

  it("a state-level `initial:` key surfaces its replacement hint instead of a bare unknown-key error", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: { entry: "a", states: { a: { actor: "human", message: "hi", initial: true } } },
      },
    })
    expect(messages).toContain(
      'state "a": unknown key(s) initial ("initial" no longer exists — declare this state\'s qualified path in the top-level "entry.default" instead)',
    )
  })

  it("a state-level `reviewEntry:`/`fixEntry:` key each surface the new `entry: true` hint instead of a bare unknown-key error", () => {
    const messages = compileErrors({
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
    })
    expect(messages).toContain(
      'state "a": unknown key(s) reviewEntry ("reviewEntry" no longer exists — declare "entry: true" on this state instead)',
    )
    expect(messages).toContain(
      'state "b": unknown key(s) fixEntry ("fixEntry" no longer exists — declare "entry: true" on this state instead)',
    )
  })

  it("a reference's legacy `as`/`name`/`set` keys each surface a replacement hint instead of a bare unknown-key error", () => {
    const messages = compileErrors({
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
    })
    expect(messages).toContain(
      'machine "root": reference "child1": unknown key(s) as ("as" no longer exists — a reference\'s local name (the key itself) IS the concrete name; there is nothing left to rename)',
    )
    expect(messages).toContain(
      'machine "root": reference "child2": unknown key(s) name ("name" no longer exists — a reference\'s local name (the key itself) names the instance)',
    )
    expect(messages).toContain(
      'machine "root": reference "child3": unknown key(s) set ("set" no longer exists — bind extra per-instance values via "with:" instead)',
    )
  })

  it("the legacy-detection short-circuit throws only the migration finding, never mixed with downstream noise from a missing `entry`/`machines`", () => {
    const messages = compileErrors({ states: { a: { actor: "human", message: "hi" } } })
    expect(messages).toEqual([
      'top-level "states:" is no longer supported — declare a machine under "machines:" and name it in "entry.default:"',
    ])
  })

  it("an unassemblable config (entry.default names something unresolvable) throws before compileState/validateDefinition ever run, even though flattening already emitted a real state", () => {
    const messages = compileErrors({
      entry: { default: "root" },
      machines: {
        root: { entry: "bogus", states: { a: { actor: 1 } } },
      },
    })
    // Only the flattener's entry.default finding — never compileState's
    // "actor must be a string" (which would fire on state "a" if the
    // per-state compile loop or validateDefinition ever ran).
    expect(messages).toEqual([
      '"entry.default" names "bogus", which is not a state or machine reference',
    ])
  })

  it("the merge rule: a flattener-level sideways-target finding in one state and a validateDefinition content-kind finding in another both surface in one thrown error", () => {
    const messages = compileErrors({
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
    })
    expect(messages).toContain(
      'machines.root.a: "on" target "nowhere" is not a state or reference of machine "root" — declare a "params:" entry and bind it at the reference site',
    )
    expect(messages).toContain(
      'state "b": must declare exactly one of script/prompt/message (found 2)',
    )
  })
})

describe("compileWorkflowConfig — machine-level `params:`", () => {
  const baseMachine = (params: unknown) => ({
    entry: { default: "root" },
    machines: {
      root: {
        params,
        entry: "working",
        states: {
          working: { actor: "human", message: "hi", on: {} },
        },
      },
    },
  })

  it("rejects a non-array `params` as a config-shape error", () => {
    const messages = compileErrors(baseMachine("onDone"))
    expect(
      messages.some((m) =>
        /machine "root": "params" must be an array of strings, got string/.test(m),
      ),
    ).toBe(true)
  })

  it("rejects a non-string params entry, naming its own numeric index in the path", () => {
    const diagnostics = compileWorkflowConfig(baseMachine(["onDone", 42])).diagnostics
    const found = diagnostics.find(
      (d) => d.severity === "error" && /params\.1.*must be a string/.test(d.message),
    )
    expect(found).toBeDefined()
    // The one place this compiler's own config path is genuinely
    // array-shaped rather than object-keyed — `["machines","root","params",1]`.
    expect(found?.path).toEqual(["machines", "root", "params", 1])
  })

  it("accepts an all-string `params` array with no finding", () => {
    const messages = compileErrors(baseMachine(["onDone", "onGreen"]))
    expect(messages.some((m) => /params/.test(m))).toBe(false)
  })
})

describe("compileWorkflowConfig — machine-level `model`", () => {
  it("stamps a machine-level `model` onto its own `prompt` state", () => {
    const { definition } = compileWorkflowConfig({
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
    })
    expect(definition.states["working"]!.model).toBe("smart")
    expect(definition.states["done"]).not.toHaveProperty("model")
  })

  it("rejects a non-string machine-level `model` as a config-shape error", () => {
    const messages = compileErrors({
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
    })
    expect(messages.some((m) => /machines\.root: "model" must be a non-empty string/.test(m))).toBe(
      true,
    )
  })

  it("rejects a blank machine-level `model` as a config-shape error", () => {
    const messages = compileErrors({
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
    })
    expect(messages.some((m) => /machines\.root: "model" must be a non-empty string/.test(m))).toBe(
      true,
    )
  })

  it("rejects a machine declaring `model` with no `prompt` state anywhere in its own states", () => {
    const messages = compileErrors({
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
    })
    expect(
      messages.some((m) => /machine "root": declares "model" but has no "prompt" state/.test(m)),
    ).toBe(true)
  })
})

describe("compileWorkflowConfig — machine-level `system`", () => {
  it("accepts `system:` as a known machine key (a typo is still an unknown-key error)", () => {
    const okMessages = compileErrors({
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
    })
    expect(okMessages).toEqual([])

    const typoMessages = compileErrors({
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
    })
    expect(typoMessages.some((m) => /machine "root": unknown key\(s\) systemm/.test(m))).toBe(true)
  })

  it("rejects a blank machine-level `system` as a config-shape error", () => {
    const messages = compileErrors({
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
    })
    expect(
      messages.some((m) => /machines\.root: "system" must be a non-empty string/.test(m)),
    ).toBe(true)
  })

  it("rejects a machine declaring `system` with no `prompt` state anywhere in its own states", () => {
    const messages = compileErrors({
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
    })
    expect(
      messages.some((m) => /machine "root": declares "system" but has no "prompt" state/.test(m)),
    ).toBe(true)
  })

  it("rejects a state-level `system`, naming the machine to move it to", () => {
    const messages = compileErrors({
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
    })
    expect(
      messages.some((m) =>
        /machine "root": state "working": unknown key\(s\) system \("system" is no longer a state key — declare it once on the machine that owns this state \("machines\.root\.system"\)\)/.test(
          m,
        ),
      ),
    ).toBe(true)
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
    const { value: result, diagnostics } = inlineWorkflowFileRefs(
      { machines: { root: { system: "./persona.md" } } },
      dir,
      realReadFile,
    ) as { value: { machines: { root: { system: string } } }; diagnostics: readonly unknown[] }
    expect(diagnostics).toEqual([])
    expect(result.machines.root.system).toBe("You are a careful agent.\n")
  })

  it("resolves a `../`-relative machine-level `system` from the declaring config file's directory, not the process directory", () => {
    writeFileSync(join(dir, "persona.md"), "You are a careful agent.\n")
    const sub = join(dir, "sub")
    mkdirSync(sub)
    const { value: result, diagnostics } = inlineWorkflowFileRefs(
      { machines: { root: { system: "../persona.md" } } },
      sub,
      realReadFile,
    ) as { value: { machines: { root: { system: string } } }; diagnostics: readonly unknown[] }
    expect(diagnostics).toEqual([])
    expect(result.machines.root.system).toBe("You are a careful agent.\n")
  })

  it("a missing machine-level `system` file reference is a load error naming the machine and key", () => {
    const { diagnostics } = inlineWorkflowFileRefs(
      { machines: { root: { system: "./missing-persona.md" } } },
      dir,
      realReadFile,
    )
    expect(diagnostics.map((d) => d.message)).toEqual([
      `machine "root" (system): file reference "./missing-persona.md" does not exist (resolved to "${join(dir, "missing-persona.md")}")`,
    ])
  })

  it("still resolves a machine's `system` file reference (and reports its missing-file error) when the same machine's `states:` is malformed", () => {
    const { value: result, diagnostics } = inlineWorkflowFileRefs(
      { machines: { root: { system: "./missing-persona.md", states: "not an object" } } },
      dir,
      realReadFile,
    ) as { value: { machines: { root: { states: unknown } } }; diagnostics: readonly Diagnostic[] }
    expect(diagnostics.map((d) => d.message)).toEqual([
      `machine "root" (system): file reference "./missing-persona.md" does not exist (resolved to "${join(dir, "missing-persona.md")}")`,
    ])
    // The malformed `states:` passes through untouched — `compileWorkflowConfig`/`validateDefinition` own that finding.
    expect(result.machines.root.states).toBe("not an object")
  })

  it("`model: ./m.txt` stays the literal string — `model` gains no file-ref inlining", () => {
    const { value: result, diagnostics } = inlineWorkflowFileRefs(
      { machines: { root: { model: "./m.txt" } } },
      dir,
      realReadFile,
    ) as { value: { machines: { root: { model: string } } }; diagnostics: readonly unknown[] }
    expect(diagnostics).toEqual([])
    expect(result.machines.root.model).toBe("./m.txt")
  })

  it("a non-object state entry inside an otherwise-well-formed `states:` passes through untouched", () => {
    const { value: result, diagnostics } = inlineWorkflowFileRefs(
      { machines: { root: { states: { a: "nope" } } } },
      dir,
      realReadFile,
    ) as {
      value: { machines: { root: { states: Record<string, unknown> } } }
      diagnostics: readonly unknown[]
    }
    expect(diagnostics).toEqual([])
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
    const { value: result, diagnostics } = inlineWorkflowFileRefs(
      { summary: "./summary.md" },
      dir,
      realReadFile,
    ) as { value: { summary: string }; diagnostics: readonly unknown[] }
    expect(diagnostics).toEqual([])
    expect(result.summary).toBe("Wrap it up.\n")
  })

  it("a missing top-level `summary` file reference is a load error", () => {
    const { diagnostics } = inlineWorkflowFileRefs({ summary: "./missing.md" }, dir, realReadFile)
    expect(diagnostics.map((d) => d.message)).toEqual([
      `"summary": file reference "./missing.md" does not exist (resolved to "${join(dir, "missing.md")}")`,
    ])
  })
})

describe("compileWorkflowConfig — `scopes`", () => {
  it("populates `scopes` from the flattener's instance paths, covering every state including check/human/commit states", () => {
    const { scopes } = compileWorkflowConfig(draftCheckRevise)
    expect(scopes).toEqual({
      idle: "",
      checking: "",
      revising: "",
      squashing: "",
      done: "",
    })
  })

  it("gives a referenced child machine's states a scope distinct from the root's", () => {
    const { scopes } = compileWorkflowConfig({
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
    })
    expect(scopes).toEqual({ "child.working": "child", "child.done": "child" })
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
    const { definition } = compileWorkflowConfig(draftCheckRevise)
    expect(definition.summary).toBeUndefined()
  })

  it("compiles a valid non-blank string verbatim", () => {
    const { definition } = compileWorkflowConfig({
      ...draftCheckRevise,
      summary: "Write the process's closing message.",
    })
    expect(definition.summary).toBe("Write the process's closing message.")
  })

  it("rejects a blank string", () => {
    for (const blank of ["", "   "]) {
      const messages = compileErrors({ ...draftCheckRevise, summary: blank })
      expect(messages.some((m) => /"summary" must not be blank/.test(m))).toBe(true)
    }
  })

  it("rejects a non-string value", () => {
    for (const bad of [42, { nested: true }]) {
      const messages = compileErrors({ ...draftCheckRevise, summary: bad })
      expect(messages.some((m) => /"summary" must be a string/.test(m))).toBe(true)
    }
  })

  it("inlines a `./`-relative file reference at load time", () => {
    writeFileSync(join(dir, "summary.md"), "Write the process's closing message.\n")
    const { value: inlined } = inlineWorkflowFileRefs(
      { ...draftCheckRevise, summary: "./summary.md" },
      dir,
      realReadFile,
    )
    const { definition } = compileWorkflowConfig(inlined)
    expect(definition.summary).toBe("Write the process's closing message.\n")
  })

  it("a blank inlined file is a load error, same as an inline blank string", () => {
    writeFileSync(join(dir, "summary.md"), "   \n")
    const { value: inlined } = inlineWorkflowFileRefs(
      { ...draftCheckRevise, summary: "./summary.md" },
      dir,
      realReadFile,
    )
    const messages = compileErrors(inlined)
    expect(messages.some((m) => /"summary" must not be blank/.test(m))).toBe(true)
  })

  it("a missing file reference is a load error naming the file reference", () => {
    const { diagnostics: refDiagnostics } = inlineWorkflowFileRefs(
      { ...draftCheckRevise, summary: "./does-not-exist.md" },
      dir,
      realReadFile,
    )
    const messages = refDiagnostics.map((d) => d.message)
    expect(
      messages.some((m) =>
        /"summary": file reference "\.\/does-not-exist\.md" does not exist/.test(m),
      ),
    ).toBe(true)
  })

  it("is accepted as a known top-level key alongside entry/machines/vars/modes", () => {
    const messages = compileErrors({ ...draftCheckRevise, summary: "Wrap it up." })
    expect(messages.some((m) => /unknown top-level key/.test(m))).toBe(false)
  })
})
