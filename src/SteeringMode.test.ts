import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"
import {
  formatAndValidateSteeringFile,
  formatSteeringFile,
  renderSteeringCommands,
  resolveBuiltInMode,
  resolveSteeringMode,
  steeringCapabilities,
  unknownModeMessage,
  validateSteeringFile,
} from "./SteeringMode.js"
import { GtdError } from "./Commentary.js"
import { CommandRunner, type CommandOutcome } from "./CommandRunner.js"
import { EnvVars } from "./EnvVars.js"
import { QA_FORMAT } from "./OpenQuestions.js"
import { REVIEW_FORMAT } from "./ReviewDoc.js"
import { seededValidateCommand } from "./SteeringFormats.js"
import type { TemplateContext } from "./PatternTemplates.js"
import type { WorkflowDefinition } from "./PatternMachine.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-steering-mode-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

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
  vars,
  edges: [],
})

const commandsDef = (modes: NonNullable<WorkflowDefinition["modes"]>): WorkflowDefinition => ({
  modes,
  states: {},
  entries: { default: "x", manual: [] },
})

interface RecordedCall {
  readonly command: string
}

/**
 * A test double `CommandRunner` that records every call and always resolves
 * with `outcome` — no subprocess, no real bash. `src/SteeringMode.test.ts`'s
 * table-driven tests use this instead of shelling out (real-bash edge cases —
 * huge output, a genuine spawn failure — live in `src/CommandRunner.test.ts`
 * against the real `Live` layer instead).
 */
const scriptedRunner = (
  outcome: CommandOutcome,
): { readonly layer: Layer.Layer<CommandRunner>; readonly calls: RecordedCall[] } => {
  const calls: RecordedCall[] = []
  const layer = CommandRunner.layer((command: string) => {
    calls.push({ command })
    return Effect.succeed(outcome)
  })
  return { layer, calls }
}

/** A `CommandRunner` that fails the test if it is ever invoked — proves a code path never runs a command. */
const neverRunner: Layer.Layer<CommandRunner> = CommandRunner.layer(() =>
  Effect.fail(new Error("no command should have run")),
)

/** A fixed `$PATH` — these tests assert on the missing-binary detail carrying it verbatim. */
const TEST_PATH = "/usr/bin:/bin"
const envVarsLayer: Layer.Layer<EnvVars> = EnvVars.layer({ PATH: TEST_PATH })

/** Runs an Effect needing a `CommandRunner` (+ `EnvVars`, for the missing-binary detail) against a scripted/never layer. */
const runWith = <A>(
  eff: Effect.Effect<A, Error, CommandRunner | EnvVars>,
  layer: Layer.Layer<CommandRunner>,
) => Effect.runPromise(eff.pipe(Effect.provide(Layer.merge(layer, envVarsLayer))))

const runExitWith = <A>(
  eff: Effect.Effect<A, Error, CommandRunner | EnvVars>,
  layer: Layer.Layer<CommandRunner>,
) => Effect.runPromiseExit(eff.pipe(Effect.provide(Layer.merge(layer, envVarsLayer))))

describe("resolveSteeringMode", () => {
  it("resolves the two built-in names to their in-process validator, their format, and to no formatter", () => {
    const def: WorkflowDefinition = { states: {}, entries: { default: "x", manual: [] } }
    expect(resolveSteeringMode(def, "qa")).toEqual({
      mode: "qa",
      builtIn: QA_FORMAT,
      validate: { kind: "builtin", format: QA_FORMAT },
    })
    expect(resolveSteeringMode(def, "review")).toEqual({
      mode: "review",
      builtIn: REVIEW_FORMAT,
      validate: { kind: "builtin", format: REVIEW_FORMAT },
    })
  })

  it("resolves a declared mode to its commands", () => {
    const def = commandsDef({ adr: { validate: "adr-lint <%= it.file %>" } })
    expect(resolveSteeringMode(def, "adr")).toEqual({
      mode: "adr",
      validate: { kind: "command", command: "adr-lint <%= it.file %>" },
    })
  })

  it("adds a formatter to a built-in WITHOUT displacing its validation", () => {
    const def = commandsDef({ qa: { format: "npx prettier --write <%= it.file %>" } })
    expect(resolveSteeringMode(def, "qa")).toEqual({
      mode: "qa",
      builtIn: QA_FORMAT,
      formatCommand: "npx prettier --write <%= it.file %>",
      validate: { kind: "builtin", format: QA_FORMAT },
    })
  })

  it("lets a declared `validate:` override a built-in's parser, WITHOUT losing the format identity", () => {
    const def = commandsDef({ qa: { validate: "my-qa-linter <%= it.file %>" } })
    expect(resolveSteeringMode(def, "qa")).toEqual({
      mode: "qa",
      builtIn: QA_FORMAT,
      validate: { kind: "command", command: "my-qa-linter <%= it.file %>" },
    })
  })

  it("resolves a non-built-in mode with only a `format:` to no validator at all", () => {
    const def = commandsDef({ adr: { format: "fmt <%= it.file %>" } })
    expect(resolveSteeringMode(def, "adr")).toEqual({
      mode: "adr",
      formatCommand: "fmt <%= it.file %>",
    })
  })

  it("resolves nothing for an undefined mode, and names what IS known", () => {
    const def = commandsDef({ adr: { validate: "adr-lint" } })
    expect(resolveSteeringMode(def, "nope")).toBeUndefined()
    expect(unknownModeMessage(def, "drafting", "nope")).toBe(
      'state "drafting": mode "nope" is not defined by the active workflow (known modes: adr)',
    )
  })

  it("resolves nothing for `prose` with no declared entry — it is not in the built-in registry", () => {
    const def: WorkflowDefinition = { states: {}, entries: { default: "x", manual: [] } }
    expect(resolveSteeringMode(def, "prose")).toBeUndefined()
  })

  it("resolves a declared `prose` entry with only a `format:` to a formatter-only, validator-less mode", () => {
    const def = commandsDef({ prose: { format: "npx prettier --write <%= it.file %>" } })
    expect(resolveSteeringMode(def, "prose")).toEqual({
      mode: "prose",
      formatCommand: "npx prettier --write <%= it.file %>",
    })
  })
})

describe("resolveBuiltInMode", () => {
  it("resolves the two built-in names against the registry alone, with no definition", () => {
    expect(resolveBuiltInMode("qa")).toEqual({
      mode: "qa",
      builtIn: QA_FORMAT,
      validate: { kind: "builtin", format: QA_FORMAT },
    })
    expect(resolveBuiltInMode("review")).toEqual({
      mode: "review",
      builtIn: REVIEW_FORMAT,
      validate: { kind: "builtin", format: REVIEW_FORMAT },
    })
  })

  it("resolves nothing for a name the registry doesn't know", () => {
    expect(resolveBuiltInMode("prose")).toBeUndefined()
    expect(resolveBuiltInMode("adr")).toBeUndefined()
  })
})

describe("steeringCapabilities", () => {
  it("carries the built-in format and a live validate function for an unoverridden built-in mode", () => {
    const caps = steeringCapabilities(resolveBuiltInMode("qa"))
    expect(caps.format).toBe(QA_FORMAT)
    expect(caps.liveValidate).toBe(QA_FORMAT.validate)
    expect(caps.externalValidate).toBeUndefined()
  })

  it("keeps the format but drops liveValidate, carrying externalValidate instead, when `validate:` is overridden", () => {
    const def = commandsDef({ qa: { validate: "my-qa-linter <%= it.file %>" } })
    const caps = steeringCapabilities(resolveSteeringMode(def, "qa"))
    expect(caps.format).toBe(QA_FORMAT)
    expect(caps.liveValidate).toBeUndefined()
    expect(caps.externalValidate).toBe(true)
  })

  it("carries no format and no validate capability for a declared format-only mode", () => {
    const def = commandsDef({ adr: { format: "fmt <%= it.file %>" } })
    const caps = steeringCapabilities(resolveSteeringMode(def, "adr"))
    expect(caps).toEqual({})
  })

  it("is empty for an unresolved mode", () => {
    expect(steeringCapabilities(undefined)).toEqual({})
  })

  it("keeps liveValidate (using builtIn.validate) and drops externalValidate when a built-in mode's declared `validate:` IS its own seeded command", () => {
    const def = commandsDef({ qa: { validate: seededValidateCommand("qa") } })
    const resolved = resolveSteeringMode(def, "qa")
    expect(resolved).toEqual({
      mode: "qa",
      builtIn: QA_FORMAT,
      validate: { kind: "command", command: seededValidateCommand("qa") },
    })
    const caps = steeringCapabilities(resolved)
    expect(caps.format).toBe(QA_FORMAT)
    expect(caps.liveValidate).toBe(QA_FORMAT.validate)
    expect(caps.externalValidate).toBeUndefined()
  })

  it("recognizes the seeded command for `review` too, keyed to its own mode name", () => {
    const def = commandsDef({ review: { validate: seededValidateCommand("review") } })
    const caps = steeringCapabilities(resolveSteeringMode(def, "review"))
    expect(caps.format).toBe(REVIEW_FORMAT)
    expect(caps.liveValidate).toBe(REVIEW_FORMAT.validate)
    expect(caps.externalValidate).toBeUndefined()
  })

  it("still reports externalValidate for a genuine user override even when the command text merely resembles the seeded one", () => {
    const def = commandsDef({ qa: { validate: `${seededValidateCommand("qa")} --extra` } })
    const caps = steeringCapabilities(resolveSteeringMode(def, "qa"))
    expect(caps.format).toBe(QA_FORMAT)
    expect(caps.liveValidate).toBeUndefined()
    expect(caps.externalValidate).toBe(true)
  })

  it("carries no format and reports externalValidate for a non-built-in mode with a `validate:` command", () => {
    const def = commandsDef({ adr: { validate: "adr-lint <%= it.file %>" } })
    const caps = steeringCapabilities(resolveSteeringMode(def, "adr"))
    expect(caps.format).toBeUndefined()
    expect(caps.liveValidate).toBeUndefined()
    expect(caps.externalValidate).toBe(true)
  })

  it("keeps liveValidate for the LSP's definition-less basename fallback (resolveBuiltInMode)", () => {
    const caps = steeringCapabilities(resolveBuiltInMode("review"))
    expect(caps.format).toBe(REVIEW_FORMAT)
    expect(caps.liveValidate).toBe(REVIEW_FORMAT.validate)
    expect(caps.externalValidate).toBeUndefined()
  })
})

describe("validateSteeringFile — built-in modes", () => {
  it("`qa` reports the open-questions parser's findings, without ever running a command", async () => {
    const content = "Plan.\n\n## Open Questions\n\n###\n\nno question text.\n"
    const errors = await runWith(
      validateSteeringFile(
        { mode: "qa", validate: { kind: "builtin", format: QA_FORMAT } },
        ".gtd/TODO.md",
        content,
        context(),
      ),
      neverRunner,
    )
    expect(errors.map((e) => e.message).join("\n")).toContain("has no question text")
  })

  it("`review` reports the review-doc parser's findings", async () => {
    const errors = await runWith(
      validateSteeringFile(
        { mode: "review", validate: { kind: "builtin", format: REVIEW_FORMAT } },
        ".gtd/REVIEW.md",
        "## Chunk\n",
        context(),
      ),
      neverRunner,
    )
    expect(errors.map((e) => e.message).join("\n")).toContain("# Review: <hash>")
  })

  it("reports no findings for a valid file", async () => {
    const errors = await runWith(
      validateSteeringFile(
        { mode: "qa", validate: { kind: "builtin", format: QA_FORMAT } },
        ".gtd/TODO.md",
        "Just a plan, no questions.\n",
        context(),
      ),
      neverRunner,
    )
    expect(errors).toEqual([])
  })
})

describe("validateSteeringFile — a workflow-declared command", () => {
  it("treats exit 0 as valid and never reads the file itself", async () => {
    const { layer } = scriptedRunner({ status: 0, output: "" })
    const errors = await runWith(
      validateSteeringFile(
        { mode: "adr", validate: { kind: "command", command: "test -f <%= it.file %>" } },
        "present.md",
        "",
        context(),
      ),
      layer,
    )
    expect(errors).toEqual([])
  })

  it("turns a non-zero exit's output into one finding per line, having rendered `it.file` into the command", async () => {
    const { layer, calls } = scriptedRunner({
      status: 3,
      output: "docs/adr.md: missing Status section\non stderr\n",
    })
    const errors = await runWith(
      validateSteeringFile(
        {
          mode: "adr",
          validate: {
            kind: "command",
            command: 'echo "<%= it.file %>: missing Status section"; echo "on stderr" >&2; exit 3',
          },
        },
        "docs/adr.md",
        "",
        context(),
      ),
      layer,
    )
    expect(errors).toEqual([
      { message: "docs/adr.md: missing Status section" },
      { message: "on stderr" },
    ])
    expect(calls).toEqual([
      { command: 'echo "docs/adr.md: missing Status section"; echo "on stderr" >&2; exit 3' },
    ])
  })

  it("synthesizes a finding when a failing command says nothing", async () => {
    const { layer } = scriptedRunner({ status: 2, output: "" })
    const errors = await runWith(
      validateSteeringFile(
        { mode: "adr", validate: { kind: "command", command: "exit 2" } },
        "docs/adr.md",
        "",
        context(),
      ),
      layer,
    )
    expect(errors).toEqual([
      { message: 'mode "adr": validate command exited with status 2 and no output' },
    ])
  })

  it("renders the command as an Eta template over `it.file` and `it.vars` before running it", async () => {
    const { layer, calls } = scriptedRunner({ status: 1, output: "adr-lint saw docs/adr.md\n" })
    const errors = await runWith(
      validateSteeringFile(
        {
          mode: "adr",
          validate: {
            kind: "command",
            command: 'echo "<%= it.vars.linter %> saw <%= it.file %>"; exit 1',
          },
        },
        "docs/adr.md",
        "",
        context({ linter: "adr-lint" }),
      ),
      layer,
    )
    expect(calls[0]?.command).toBe('echo "adr-lint saw docs/adr.md"; exit 1')
    expect(errors).toEqual([{ message: "adr-lint saw docs/adr.md" }])
  })

  it("fails (rather than running anything) when the command template is malformed", async () => {
    const { layer, calls } = scriptedRunner({ status: 0, output: "" })
    const exit = await runExitWith(
      validateSteeringFile(
        { mode: "adr", validate: { kind: "command", command: "check <%= it.file" } },
        "docs/adr.md",
        "",
        context(),
      ),
      layer,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls).toEqual([])
  })

  it("reports no findings for a mode that declares only a `format:` command, without running anything", async () => {
    const errors = await runWith(
      validateSteeringFile({ mode: "adr", formatCommand: "true" }, "docs/adr.md", "", context()),
      neverRunner,
    )
    expect(errors).toEqual([])
  })

  it("a status-127 exit (bash's 'command not found') fails with a GtdError naming the resolved $PATH", async () => {
    const { layer } = scriptedRunner({
      status: 127,
      output: "bash: nonexistent-tool: command not found\n",
    })
    const exit = await runExitWith(
      validateSteeringFile(
        { mode: "adr", validate: { kind: "command", command: "nonexistent-tool" } },
        "docs/adr.md",
        "",
        context(),
      ),
      layer,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(GtdError)
      expect(error).toHaveProperty("message", 'mode "adr": "validate" command not found')
      if (error instanceof GtdError) expect(error.detail).toEqual([`$PATH: ${TEST_PATH}`])
    }
  })
})

describe("formatSteeringFile", () => {
  it("a built-in mode formats NOTHING on its own — gtd ships no formatter", async () => {
    const file = join(tmpDir, "TODO.md")
    const long =
      "This is a deliberately long single prose line that clearly exceeds the eighty character print width, and stays exactly as written.\n"
    writeFileSync(file, long)
    await runWith(
      formatSteeringFile(
        { mode: "qa", validate: { kind: "builtin", format: QA_FORMAT } },
        file,
        context(),
      ),
      neverRunner,
    )
    expect(readFileSync(file, "utf8")).toBe(long)
  })

  it("a formatter plugged into a built-in mode DOES run, rendered against `it.file`", async () => {
    const file = join(tmpDir, "TODO.md")
    const { layer, calls } = scriptedRunner({ status: 0, output: "" })
    await runWith(
      formatSteeringFile(
        {
          mode: "qa",
          formatCommand: "printf '# Plan\\n' > <%= it.file %>",
          validate: { kind: "builtin", format: QA_FORMAT },
        },
        file,
        context(),
      ),
      layer,
    )
    expect(calls).toEqual([{ command: `printf '# Plan\\n' > ${file}` }])
  })

  it("a declared mode's `format:` command is rendered and handed to the runner verbatim", async () => {
    const { layer, calls } = scriptedRunner({ status: 0, output: "" })
    await runWith(
      formatSteeringFile(
        {
          mode: "adr",
          formatCommand: "tr a-z A-Z < <%= it.file %> > tmp && mv tmp <%= it.file %>",
        },
        "adr.md",
        context(),
      ),
      layer,
    )
    expect(calls).toEqual([{ command: "tr a-z A-Z < adr.md > tmp && mv tmp adr.md" }])
  })

  it("fails hard when the `format:` command exits non-zero, reporting its output", async () => {
    const { layer } = scriptedRunner({ status: 4, output: "formatter blew up\n" })
    const exit = await runExitWith(
      formatSteeringFile(
        { mode: "adr", formatCommand: 'echo "formatter blew up" >&2; exit 4' },
        "adr.md",
        context(),
      ),
      layer,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('mode "adr": format command exited with status 4')
      expect(String(exit.cause)).toContain("formatter blew up")
    }
  })

  it("a status-127 exit (bash's 'command not found') fails with a GtdError naming the resolved $PATH", async () => {
    const { layer } = scriptedRunner({
      status: 127,
      output: "bash: nonexistent-tool: command not found\n",
    })
    const exit = await runExitWith(
      formatSteeringFile({ mode: "adr", formatCommand: "nonexistent-tool" }, "adr.md", context()),
      layer,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(GtdError)
      expect(error).toHaveProperty("message", 'mode "adr": "format" command not found')
      if (error instanceof GtdError) expect(error.detail).toEqual([`$PATH: ${TEST_PATH}`])
    }
  })

  it("fails hard with no output suffix at all when the `format:` command's output is empty", async () => {
    const { layer } = scriptedRunner({ status: 4, output: "" })
    const exit = await runExitWith(
      formatSteeringFile({ mode: "adr", formatCommand: "exit 4" }, "adr.md", context()),
      layer,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('mode "adr": format command exited with status 4')
    }
  })

  it("trims only trailing whitespace off the `format:` command's output, keeping leading whitespace intact", async () => {
    const { layer } = scriptedRunner({
      status: 4,
      output: "  keep this leading\ntrailing removed   ",
    })
    const exit = await runExitWith(
      formatSteeringFile({ mode: "adr", formatCommand: "exit 4" }, "adr.md", context()),
      layer,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(
        'mode "adr": format command exited with status 4:\n  keep this leading\ntrailing removed',
      )
    }
  })

  it("formats nothing for a mode that declares only a `validate:` command", async () => {
    await runWith(
      formatSteeringFile(
        { mode: "adr", validate: { kind: "command", command: "true" } },
        "adr.md",
        context(),
      ),
      neverRunner,
    )
  })
})

describe("formatAndValidateSteeringFile", () => {
  it("formats BEFORE validating, so the validate command runs only after format succeeds", async () => {
    const { layer, calls } = scriptedRunner({ status: 0, output: "" })
    const errors = await runWith(
      formatAndValidateSteeringFile(
        {
          mode: "adr",
          formatCommand: "echo formatted > <%= it.file %>",
          validate: {
            kind: "command",
            command: 'grep -q formatted <%= it.file %> || { echo "not formatted"; exit 1; }',
          },
        },
        "adr.md",
        "",
        context(),
      ),
      layer,
    )
    expect(errors).toEqual([])
    expect(calls.map((c) => c.command)).toEqual([
      "echo formatted > adr.md",
      'grep -q formatted adr.md || { echo "not formatted"; exit 1; }',
    ])
  })

  it("never runs `validate:` when `format:` failed", async () => {
    const { layer, calls } = scriptedRunner({ status: 1, output: "" })
    const exit = await runExitWith(
      formatAndValidateSteeringFile(
        {
          mode: "adr",
          formatCommand: "exit 1",
          validate: { kind: "command", command: "touch validated" },
        },
        "adr.md",
        "",
        context(),
      ),
      layer,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls).toHaveLength(1)
  })
})

describe("renderSteeringCommands", () => {
  it("returns just the rendered format command for a format-only mode", async () => {
    const commands = await Effect.runPromise(
      renderSteeringCommands(
        { mode: "adr", formatCommand: "fmt <%= it.file %>" },
        "docs/adr.md",
        context(),
      ),
    )
    expect(commands).toEqual(["fmt docs/adr.md"])
  })

  it("returns just the rendered validate command for a command-validate-only mode", async () => {
    const commands = await Effect.runPromise(
      renderSteeringCommands(
        { mode: "adr", validate: { kind: "command", command: "adr-lint <%= it.file %>" } },
        "docs/adr.md",
        context(),
      ),
    )
    expect(commands).toEqual(["adr-lint docs/adr.md"])
  })

  it("returns format then validate, in that order, when both are declared", async () => {
    const commands = await Effect.runPromise(
      renderSteeringCommands(
        {
          mode: "adr",
          formatCommand: "fmt <%= it.file %>",
          validate: { kind: "command", command: "adr-lint <%= it.file %>" },
        },
        "docs/adr.md",
        context(),
      ),
    )
    expect(commands).toEqual(["fmt docs/adr.md", "adr-lint docs/adr.md"])
  })

  it("returns nothing for a mode with no format and no command-based validator", async () => {
    const noneCommands = await Effect.runPromise(
      renderSteeringCommands({ mode: "adr" }, "adr.md", context()),
    )
    expect(noneCommands).toEqual([])

    const builtInOnlyCommands = await Effect.runPromise(
      renderSteeringCommands(
        { mode: "qa", validate: { kind: "builtin", format: QA_FORMAT } },
        ".gtd/TODO.md",
        context(),
      ),
    )
    expect(builtInOnlyCommands).toEqual([])
  })

  it("fails with the same message `formatSteeringFile` produces for the same malformed template", async () => {
    const malformed = "fmt <%= it.file"
    const renderExit = await Effect.runPromiseExit(
      renderSteeringCommands({ mode: "adr", formatCommand: malformed }, "adr.md", context()),
    )
    const formatExit = await runExitWith(
      formatSteeringFile({ mode: "adr", formatCommand: malformed }, "adr.md", context()),
      neverRunner,
    )
    expect(Exit.isFailure(renderExit)).toBe(true)
    expect(Exit.isFailure(formatExit)).toBe(true)
    if (Exit.isFailure(renderExit) && Exit.isFailure(formatExit)) {
      expect(String(renderExit.cause)).toBe(String(formatExit.cause))
    }
  })

  it("fails on a malformed validate template too, without running anything", async () => {
    const exit = await Effect.runPromiseExit(
      renderSteeringCommands(
        { mode: "adr", validate: { kind: "command", command: "check <%= it.file" } },
        "docs/adr.md",
        context(),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('mode "adr": "validate" command failed to render')
    }
  })

  it("has no CommandRunner requirement — runs to success with no layer provided at all", async () => {
    const commands = await Effect.runPromise(
      renderSteeringCommands(
        { mode: "adr", formatCommand: "fmt <%= it.file %>" },
        "adr.md",
        context(),
      ),
    )
    expect(commands).toEqual(["fmt adr.md"])
  })
})
