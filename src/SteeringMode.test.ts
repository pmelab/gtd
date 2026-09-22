import { describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"
import { resolveMode, validateScriptFor, type ModeResolution } from "./SteeringMode.js"
import { Host } from "./platform/index.js"
import { steeringFormatFor } from "./steering/index.js"
import { seededValidateCommand } from "./SteeringFormats.js"

const QA_FORMAT = steeringFormatFor("qa")!
const REVIEW_FORMAT = steeringFormatFor("review")!
import type { TemplateContext } from "./PatternTemplates.js"
import type { WorkflowDefinition } from "./PatternMachine.js"

const context = (vars: Record<string, string> = {}): TemplateContext => ({
  startCommit: "aaa",
  currentCommit: "bbb",
  previousCommit: "ccc",
  state: "drafting",
  actor: "agent",
  reviewBase: "",
  processBase: "",
  processCost: 0,
  processCostByModel: [],
  read: (path: string) => {
    throw new Error(`unexpected read of ${path}`)
  },
  sections: () => [],
  openQuestions: () => [],
  openQuestionOptions: () => [],
  vars,
  edges: [],
})

const commandsDef = (modes: NonNullable<WorkflowDefinition["modes"]>): WorkflowDefinition => ({
  modes,
  states: {},
  entries: { default: "x", manual: [] },
})

const envVarsLayer = Host.layer({ root: "/repo", home: "/repo", env: { PATH: "/usr/bin:/bin" } })

const runScript = (resolved: ModeResolution, file: string, ctx: TemplateContext) => {
  if (resolved.kind !== "resolved") throw new Error("expected a resolved mode")
  return Effect.runPromise(
    validateScriptFor(resolved, file, ctx).pipe(Effect.provide(envVarsLayer)),
  )
}

const runScriptExit = (resolved: ModeResolution, file: string, ctx: TemplateContext) => {
  if (resolved.kind !== "resolved") throw new Error("expected a resolved mode")
  return Effect.runPromiseExit(
    validateScriptFor(resolved, file, ctx).pipe(Effect.provide(envVarsLayer)),
  )
}

describe("resolveMode", () => {
  it("resolves the two built-in names to their in-process validator, their format, and to no formatter", () => {
    const def: WorkflowDefinition = { states: {}, entries: { default: "x", manual: [] } }
    expect(resolveMode(def, "drafting", "qa")).toEqual({
      kind: "resolved",
      mode: "qa",
      format: QA_FORMAT,
      validate: { kind: "builtin", format: QA_FORMAT },
      capabilities: { format: QA_FORMAT, liveValidate: QA_FORMAT.validate },
    })
    expect(resolveMode(def, "drafting", "review")).toEqual({
      kind: "resolved",
      mode: "review",
      format: REVIEW_FORMAT,
      validate: { kind: "builtin", format: REVIEW_FORMAT },
      capabilities: { format: REVIEW_FORMAT, liveValidate: REVIEW_FORMAT.validate },
    })
  })

  it("resolves a declared mode to its commands", () => {
    const def = commandsDef({ adr: { validate: "adr-lint <%= it.file %>" } })
    expect(resolveMode(def, "drafting", "adr")).toEqual({
      kind: "resolved",
      mode: "adr",
      validate: { kind: "command", command: "adr-lint <%= it.file %>" },
      capabilities: { externalValidate: true },
    })
  })

  it("adds a formatter to a built-in WITHOUT displacing its validation", () => {
    const def = commandsDef({ qa: { format: "npx prettier --write <%= it.file %>" } })
    expect(resolveMode(def, "drafting", "qa")).toEqual({
      kind: "resolved",
      mode: "qa",
      format: QA_FORMAT,
      formatCommand: "npx prettier --write <%= it.file %>",
      validate: { kind: "builtin", format: QA_FORMAT },
      capabilities: { format: QA_FORMAT, liveValidate: QA_FORMAT.validate },
    })
  })

  it("lets a declared `validate:` override a built-in's parser, WITHOUT losing the format identity", () => {
    const def = commandsDef({ qa: { validate: "my-qa-linter <%= it.file %>" } })
    expect(resolveMode(def, "drafting", "qa")).toEqual({
      kind: "resolved",
      mode: "qa",
      format: QA_FORMAT,
      validate: { kind: "command", command: "my-qa-linter <%= it.file %>" },
      capabilities: { format: QA_FORMAT, externalValidate: true },
    })
  })

  it("resolves a non-built-in mode with only a `format:` to no validator at all", () => {
    const def = commandsDef({ adr: { format: "fmt <%= it.file %>" } })
    expect(resolveMode(def, "drafting", "adr")).toEqual({
      kind: "resolved",
      mode: "adr",
      formatCommand: "fmt <%= it.file %>",
      capabilities: {},
    })
  })

  it("resolves nothing for an undefined mode, and names what IS known", () => {
    const def = commandsDef({ adr: { validate: "adr-lint" } })
    expect(resolveMode(def, "drafting", "nope")).toEqual({
      kind: "unknown",
      message:
        'state "drafting": mode "nope" is not defined by the active workflow (known modes: adr)',
    })
  })

  it("resolves nothing for `prose` with no declared entry — it is not in the built-in registry", () => {
    const def: WorkflowDefinition = { states: {}, entries: { default: "x", manual: [] } }
    expect(resolveMode(def, "drafting", "prose").kind).toBe("unknown")
  })

  it("resolves a declared `prose` entry with only a `format:` to a formatter-only, validator-less mode", () => {
    const def = commandsDef({ prose: { format: "npx prettier --write <%= it.file %>" } })
    expect(resolveMode(def, "drafting", "prose")).toEqual({
      kind: "resolved",
      mode: "prose",
      formatCommand: "npx prettier --write <%= it.file %>",
      capabilities: {},
    })
  })

  it("resolves the two built-in names against the registry alone, with no definition (`def: undefined`) — the LSP's basename fallback", () => {
    expect(resolveMode(undefined, "", "qa")).toEqual({
      kind: "resolved",
      mode: "qa",
      format: QA_FORMAT,
      validate: { kind: "builtin", format: QA_FORMAT },
      capabilities: { format: QA_FORMAT, liveValidate: QA_FORMAT.validate },
    })
    expect(resolveMode(undefined, "", "review")).toEqual({
      kind: "resolved",
      mode: "review",
      format: REVIEW_FORMAT,
      validate: { kind: "builtin", format: REVIEW_FORMAT },
      capabilities: { format: REVIEW_FORMAT, liveValidate: REVIEW_FORMAT.validate },
    })
  })

  it("resolves nothing for a name the registry doesn't know, with no definition", () => {
    expect(resolveMode(undefined, "", "prose").kind).toBe("unknown")
    expect(resolveMode(undefined, "", "adr").kind).toBe("unknown")
  })

  it("keeps liveValidate (using format.validate) and drops externalValidate when a built-in mode's declared `validate:` IS its own seeded command", () => {
    const def = commandsDef({ qa: { validate: seededValidateCommand("qa") } })
    const resolved = resolveMode(def, "drafting", "qa")
    expect(resolved).toEqual({
      kind: "resolved",
      mode: "qa",
      format: QA_FORMAT,
      validate: { kind: "command", command: seededValidateCommand("qa") },
      capabilities: { format: QA_FORMAT, liveValidate: QA_FORMAT.validate },
    })
  })

  it("recognizes the seeded command for `review` too, keyed to its own mode name", () => {
    const def = commandsDef({ review: { validate: seededValidateCommand("review") } })
    const resolved = resolveMode(def, "drafting", "review")
    if (resolved.kind !== "resolved") throw new Error("expected resolved")
    expect(resolved.capabilities.format).toBe(REVIEW_FORMAT)
    expect(resolved.capabilities.liveValidate).toBe(REVIEW_FORMAT.validate)
    expect(resolved.capabilities.externalValidate).toBeUndefined()
  })

  it("still reports externalValidate for a genuine user override even when the command text merely resembles the seeded one", () => {
    const def = commandsDef({ qa: { validate: `${seededValidateCommand("qa")} --extra` } })
    const resolved = resolveMode(def, "drafting", "qa")
    if (resolved.kind !== "resolved") throw new Error("expected resolved")
    expect(resolved.capabilities.format).toBe(QA_FORMAT)
    expect(resolved.capabilities.liveValidate).toBeUndefined()
    expect(resolved.capabilities.externalValidate).toBe(true)
  })
})

describe("validateScriptFor — built-in modes", () => {
  it("`qa` embeds a `gtd check` invocation, never a bare execution", async () => {
    const resolved = resolveMode(undefined, "", "qa")
    const { script } = await runScript(resolved, ".gtd/TODO.md", context())
    expect(script).toContain(".gtd/TODO.md")
    expect(script).not.toMatch(/^\s*$/)
  })

  it("a format-only mode with no validator emits just the file-existence guard", async () => {
    const def = commandsDef({ adr: { format: "true" } })
    const resolved = resolveMode(def, "drafting", "adr")
    if (resolved.kind !== "resolved") throw new Error("expected resolved")
    const { script } = await runScript(resolved, "docs/adr.md", context())
    expect(script).toContain("docs/adr.md")
  })
})

describe("validateScriptFor — a workflow-declared command", () => {
  it("renders the validate command as an Eta template over `it.file` and `it.vars`, wrapped with the fix-prompt instruction", async () => {
    const def = commandsDef({
      adr: { validate: 'echo "<%= it.vars.linter %> saw <%= it.file %>"; exit 1' },
    })
    const resolved = resolveMode(def, "drafting", "adr")
    const { script } = await runScript(resolved, "docs/adr.md", context({ linter: "adr-lint" }))
    expect(script).toContain('echo "adr-lint saw docs/adr.md"; exit 1')
    expect(script).toContain("Fix these format violations in docs/adr.md")
  })

  it("renders format THEN validate, in that order", async () => {
    const def = commandsDef({
      adr: {
        format: "fmt <%= it.file %>",
        validate: "adr-lint <%= it.file %>",
      },
    })
    const resolved = resolveMode(def, "drafting", "adr")
    const { script } = await runScript(resolved, "docs/adr.md", context())
    expect(script.indexOf("fmt docs/adr.md")).toBeGreaterThanOrEqual(0)
    expect(script.indexOf("fmt docs/adr.md")).toBeLessThan(script.indexOf("adr-lint docs/adr.md"))
  })

  it("fails (rather than rendering anything) when the validate command template is malformed", async () => {
    const def = commandsDef({ adr: { validate: "check <%= it.file" } })
    const resolved = resolveMode(def, "drafting", "adr")
    const exit = await runScriptExit(resolved, "docs/adr.md", context())
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails on a malformed format template too", async () => {
    const def = commandsDef({ adr: { format: "fmt <%= it.file" } })
    const resolved = resolveMode(def, "drafting", "adr")
    const exit = await runScriptExit(resolved, "docs/adr.md", context())
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("validateScriptFor — the binary-presence guard", () => {
  it("emits a binaryGuard immediately ahead of a plain format: command, naming ITS OWN leading word", async () => {
    const def = commandsDef({ adr: { format: "adr-fmt <%= it.file %>" } })
    const resolved = resolveMode(def, "drafting", "adr")
    const { script } = await runScript(resolved, "docs/adr.md", context())
    const guardIndex = script.indexOf(`command -v 'adr-fmt'`)
    const commandIndex = script.indexOf("adr-fmt docs/adr.md")
    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(guardIndex).toBeLessThan(commandIndex)
    expect(script).toContain('mode "adr": "format" command not found: adr-fmt')
  })

  it("emits a binaryGuard immediately ahead of a plain validate: command, naming ITS OWN leading word", async () => {
    const def = commandsDef({ adr: { validate: "adr-lint <%= it.file %>" } })
    const resolved = resolveMode(def, "drafting", "adr")
    const { script } = await runScript(resolved, "docs/adr.md", context())
    const guardIndex = script.indexOf(`command -v 'adr-lint'`)
    const commandIndex = script.indexOf("adr-lint docs/adr.md")
    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(guardIndex).toBeLessThan(commandIndex)
    expect(script).toContain('mode "adr": "validate" command not found: adr-lint')
  })

  it("guards format AND validate independently, each naming its OWN binary", async () => {
    const def = commandsDef({
      adr: { format: "adr-fmt <%= it.file %>", validate: "adr-lint <%= it.file %>" },
    })
    const resolved = resolveMode(def, "drafting", "adr")
    const { script } = await runScript(resolved, "docs/adr.md", context())
    expect(script).toContain('mode "adr": "format" command not found: adr-fmt')
    expect(script).toContain('mode "adr": "validate" command not found: adr-lint')
  })

  it("emits no guard at all for a pipeline command", async () => {
    const def = commandsDef({ adr: { validate: "adr-lint <%= it.file %> | tee /dev/null" } })
    const resolved = resolveMode(def, "drafting", "adr")
    const { script } = await runScript(resolved, "docs/adr.md", context())
    expect(script).not.toContain("command -v")
  })

  it("emits no guard at all for a VAR=x-prefixed command", async () => {
    const def = commandsDef({ adr: { validate: "FOO=1 adr-lint <%= it.file %>" } })
    const resolved = resolveMode(def, "drafting", "adr")
    const { script } = await runScript(resolved, "docs/adr.md", context())
    expect(script).not.toContain("command -v")
  })
})

describe("validateScriptFor — the mode/format contradiction round-trip", () => {
  it("embeds a contradiction round-trip block when a built-in mode gets its own formatter", async () => {
    const def = commandsDef({ qa: { format: "npx prettier --write <%= it.file %>" } })
    const resolved = resolveMode(def, "drafting", "qa")
    const { script } = await runScript(resolved, ".gtd/TODO.md", context())
    expect(script).toContain("gtd check qa")
    expect(script).toContain("CONFIGURATION BUG")
  })

  it("prints a skip notice instead of a round-trip when the validator is external", async () => {
    const def = commandsDef({
      adr: { format: "fmt <%= it.file %>", validate: "adr-lint <%= it.file %>" },
    })
    const resolved = resolveMode(def, "drafting", "adr")
    const { script } = await runScript(resolved, "docs/adr.md", context())
    expect(script).toContain("skipping the format/validate contradiction check")
  })

  it("has no round-trip at all when there is no `format:` command", async () => {
    const def = commandsDef({ adr: { validate: "adr-lint <%= it.file %>" } })
    const resolved = resolveMode(def, "drafting", "adr")
    const { script } = await runScript(resolved, "docs/adr.md", context())
    expect(script).not.toContain("CONFIGURATION BUG")
    expect(script).not.toContain("skipping the format/validate contradiction check")
  })
})
