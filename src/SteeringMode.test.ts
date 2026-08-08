import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NodeContext } from "@effect/platform-node"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"
import {
  formatAndValidateSteeringFile,
  formatSteeringFile,
  resolveSteeringMode,
  unknownModeMessage,
  validateSteeringFile,
} from "./SteeringMode.js"
import { CommandRunner } from "./CommandRunner.js"
import { Cwd } from "./Cwd.js"
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
  retainedBase: "",
  processCost: 0,
  processCostByModel: [],
  read: (path: string) => {
    throw new Error(`unexpected read of ${path}`)
  },
  vars,
  edges: [],
})

/** Runs an Effect needing a real `CommandRunner` (real bash, scoped to `tmpDir`) — proves the production adapter matches the old `spawnSync` semantics. */
const runWithBash = <A>(eff: Effect.Effect<A, Error, CommandRunner>): Promise<A> =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(CommandRunner.Live),
      Effect.provide(Cwd.layer(tmpDir)),
      Effect.provide(NodeContext.layer),
    ),
  )

/** Run an Effect that needs a real filesystem, returning its Exit so a failure can be asserted on. */
const runExit = <A>(eff: Effect.Effect<A, Error, CommandRunner>) =>
  Effect.runPromiseExit(
    eff.pipe(
      Effect.provide(CommandRunner.Live),
      Effect.provide(Cwd.layer(tmpDir)),
      Effect.provide(NodeContext.layer),
    ),
  )

const commandsDef = (modes: NonNullable<WorkflowDefinition["modes"]>): WorkflowDefinition => ({
  modes,
  states: {},
  entries: { default: "x", manual: [] },
})

describe("resolveSteeringMode", () => {
  it("resolves the two built-in names to their in-process validator, and to no formatter", () => {
    const def: WorkflowDefinition = { states: {}, entries: { default: "x", manual: [] } }
    expect(resolveSteeringMode(def, "qa")).toEqual({
      mode: "qa",
      validate: { kind: "builtin", mode: "qa" },
    })
    expect(resolveSteeringMode(def, "review")).toEqual({
      mode: "review",
      validate: { kind: "builtin", mode: "review" },
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
      format: "npx prettier --write <%= it.file %>",
      validate: { kind: "builtin", mode: "qa" },
    })
  })

  it("lets a declared `validate:` override a built-in's parser", () => {
    const def = commandsDef({ qa: { validate: "my-qa-linter <%= it.file %>" } })
    expect(resolveSteeringMode(def, "qa")).toEqual({
      mode: "qa",
      validate: { kind: "command", command: "my-qa-linter <%= it.file %>" },
    })
  })

  it("resolves a non-built-in mode with only a `format:` to no validator at all", () => {
    const def = commandsDef({ adr: { format: "fmt <%= it.file %>" } })
    expect(resolveSteeringMode(def, "adr")).toEqual({
      mode: "adr",
      format: "fmt <%= it.file %>",
    })
  })

  it("resolves nothing for an undefined mode, and names what IS known", () => {
    const def = commandsDef({ adr: { validate: "adr-lint" } })
    expect(resolveSteeringMode(def, "nope")).toBeUndefined()
    expect(unknownModeMessage(def, "drafting", "nope")).toBe(
      'state "drafting": mode "nope" is not defined by the active workflow (known modes: qa, review, prose, adr)',
    )
  })

  it("resolves `prose` with no declared mode to a validator-less, formatter-less mode", () => {
    const def: WorkflowDefinition = { states: {}, entries: { default: "x", manual: [] } }
    expect(resolveSteeringMode(def, "prose")).toEqual({ mode: "prose" })
  })

  it("adds a formatter to `prose` without adding any validation", () => {
    const def = commandsDef({ prose: { format: "npx prettier --write <%= it.file %>" } })
    expect(resolveSteeringMode(def, "prose")).toEqual({
      mode: "prose",
      format: "npx prettier --write <%= it.file %>",
    })
  })
})

describe("validateSteeringFile — built-in modes", () => {
  it("`qa` reports the open-questions parser's findings", async () => {
    const content = "Plan.\n\n## Open Questions\n\n###\n\nno question text.\n"
    const errors = await runWithBash(
      validateSteeringFile(
        { mode: "qa", validate: { kind: "builtin", mode: "qa" } },
        ".gtd/TODO.md",
        content,
        context(),
      ),
    )
    expect(errors.join("\n")).toContain("has no question text")
  })

  it("`review` reports the review-doc parser's findings", async () => {
    const errors = await runWithBash(
      validateSteeringFile(
        { mode: "review", validate: { kind: "builtin", mode: "review" } },
        ".gtd/REVIEW.md",
        "## Chunk\n",
        context(),
      ),
    )
    expect(errors.join("\n")).toContain("# Review: <hash>")
  })

  it("reports no findings for a valid file", async () => {
    const errors = await runWithBash(
      validateSteeringFile(
        { mode: "qa", validate: { kind: "builtin", mode: "qa" } },
        ".gtd/TODO.md",
        "Just a plan, no questions.\n",
        context(),
      ),
    )
    expect(errors).toEqual([])
  })
})

describe("validateSteeringFile — a workflow-declared command", () => {
  it("treats exit 0 as valid and never reads the file itself", async () => {
    writeFileSync(join(tmpDir, "present.md"), "x\n")
    const errors = await runWithBash(
      validateSteeringFile(
        { mode: "adr", validate: { kind: "command", command: "test -f <%= it.file %>" } },
        "present.md",
        "content is irrelevant to a command validator",
        context(),
      ),
    )
    expect(errors).toEqual([])
  })

  it("turns a non-zero exit's output into one finding per line", async () => {
    const errors = await runWithBash(
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
    )
    expect(errors).toEqual(["docs/adr.md: missing Status section", "on stderr"])
  })

  it("synthesizes a finding when a failing command says nothing", async () => {
    const errors = await runWithBash(
      validateSteeringFile(
        { mode: "adr", validate: { kind: "command", command: "exit 2" } },
        "docs/adr.md",
        "",
        context(),
      ),
    )
    expect(errors).toEqual(['mode "adr": validate command exited with status 2 and no output'])
  })

  it("renders the command as an Eta template over `it.file` and `it.vars`", async () => {
    const errors = await runWithBash(
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
    )
    expect(errors).toEqual(["adr-lint saw docs/adr.md"])
  })

  it("fails (rather than running anything) when the command template is malformed", async () => {
    const exit = await runExit(
      validateSteeringFile(
        { mode: "adr", validate: { kind: "command", command: "check <%= it.file" } },
        "docs/adr.md",
        "",
        context(),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("reports no findings for a mode that declares only a `format:` command", async () => {
    const errors = await runWithBash(
      validateSteeringFile({ mode: "adr", format: "true" }, "docs/adr.md", "", context()),
    )
    expect(errors).toEqual([])
  })
})

describe("formatSteeringFile", () => {
  it("a built-in mode formats NOTHING on its own — gtd ships no formatter", async () => {
    const file = join(tmpDir, "TODO.md")
    const long =
      "This is a deliberately long single prose line that clearly exceeds the eighty character print width, and stays exactly as written.\n"
    writeFileSync(file, long)
    await runWithBash(
      formatSteeringFile(
        { mode: "qa", validate: { kind: "builtin", mode: "qa" } },
        file,
        context(),
      ),
    )
    expect(readFileSync(file, "utf8")).toBe(long)
  })

  it("a formatter plugged into a built-in mode DOES run", async () => {
    const file = join(tmpDir, "TODO.md")
    writeFileSync(file, "plan\n")
    await runWithBash(
      formatSteeringFile(
        {
          mode: "qa",
          format: "printf '# Plan\\n' > <%= it.file %>",
          validate: { kind: "builtin", mode: "qa" },
        },
        file,
        context(),
      ),
    )
    expect(readFileSync(file, "utf8")).toBe("# Plan\n")
  })

  it("a declared mode's `format:` command rewrites the file, relative to the given cwd", async () => {
    writeFileSync(join(tmpDir, "adr.md"), "status: draft\n")
    await runWithBash(
      formatSteeringFile(
        { mode: "adr", format: "tr a-z A-Z < <%= it.file %> > tmp && mv tmp <%= it.file %>" },
        "adr.md",
        context(),
      ),
    )
    expect(readFileSync(join(tmpDir, "adr.md"), "utf8")).toBe("STATUS: DRAFT\n")
  })

  it("fails hard when the `format:` command exits non-zero, reporting its output", async () => {
    const exit = await runExit(
      formatSteeringFile(
        { mode: "adr", format: 'echo "formatter blew up" >&2; exit 4' },
        "adr.md",
        context(),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('mode "adr": format command exited with status 4')
      expect(String(exit.cause)).toContain("formatter blew up")
    }
  })

  it("formats nothing for a mode that declares only a `validate:` command", async () => {
    writeFileSync(join(tmpDir, "adr.md"), "unchanged\n")
    await runWithBash(
      formatSteeringFile(
        { mode: "adr", validate: { kind: "command", command: "true" } },
        "adr.md",
        context(),
      ),
    )
    expect(readFileSync(join(tmpDir, "adr.md"), "utf8")).toBe("unchanged\n")
  })
})

describe("formatAndValidateSteeringFile", () => {
  it("formats BEFORE validating, so the validator judges the formatted file", async () => {
    writeFileSync(join(tmpDir, "adr.md"), "draft\n")
    const errors = await runWithBash(
      formatAndValidateSteeringFile(
        {
          mode: "adr",
          format: "echo formatted > <%= it.file %>",
          validate: {
            kind: "command",
            command: 'grep -q formatted <%= it.file %> || { echo "not formatted"; exit 1; }',
          },
        },
        "adr.md",
        "",
        context(),
      ),
    )
    expect(errors).toEqual([])
    expect(readFileSync(join(tmpDir, "adr.md"), "utf8")).toBe("formatted\n")
  })

  it("never runs `validate:` when `format:` failed", async () => {
    const marker = join(tmpDir, "validated")
    const exit = await runExit(
      formatAndValidateSteeringFile(
        {
          mode: "adr",
          format: "exit 1",
          validate: { kind: "command", command: `touch ${marker}` },
        },
        "adr.md",
        "",
        context(),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(() => readFileSync(marker, "utf8")).toThrow()
  })
})
