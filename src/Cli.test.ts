/**
 * Parse-tier unit tests for src/Cli.ts — `parseArgv` is pure and total, so
 * these need no repo, no layers, and no `Effect.runPromise`. Runtime-tier
 * tests (`runCli` through a capturing `CliIo`) live in the second `describe`
 * block below.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import * as fc from "fast-check"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  cliErrorLine,
  needsOf,
  nodeCliIo,
  parseArgv,
  renderHelp,
  runCli,
  standaloneKinds,
  type CliIo,
  type Command,
  type CommandRequirements,
} from "./Cli.js"

const FLAG_NAMES = [
  "--json",
  "--port",
  "--no-open",
  "--cost",
  "--model",
  "--if-resting",
  "--entry",
  "--var",
  "--dispatch",
]

describe("parseArgv — unknown options", () => {
  it("any `--` token not in the flag table forces kind === 'usage' (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !s.includes("=")),
          {
            maxLength: 6,
          },
        ),
        (words) => {
          const bogus = "--totally-bogus-flag"
          const argv = ["node", "gtd.js", ...words, bogus]
          if (argv.includes("--help") || argv.includes("-h")) return
          if (argv.includes("--version") || argv.includes("-v")) return
          if (FLAG_NAMES.some((f) => argv.includes(f))) return
          const plan = parseArgv(argv)
          expect(plan.kind).toBe("usage")
        },
      ),
    )
  })

  it("parseArgv(['node','gtd.js','status','--jsn']) is the exact usage plan", () => {
    const plan = parseArgv(["node", "gtd.js", "status", "--jsn"])
    expect(plan).toEqual({
      kind: "usage",
      stdout: "",
      message: "gtd: unknown option '--jsn' — see `gtd --help`",
      json: false,
    })
  })
})

describe("parseArgv — arity", () => {
  it("`gtd step` with no actor is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "step"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("missing actor argument")
  })

  it("`gtd next extra` is a usage error (next takes no argument)", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "extra"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })

  it("`gtd status --at` is an unknown-option usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "status", "--at"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("unknown option '--at'")
  })
})

describe("parseArgv — scope", () => {
  it("--cost on status is rejected", () => {
    const plan = parseArgv(["node", "gtd.js", "status", "--cost=5"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd step`")
  })

  it("--json on lsp is rejected", () => {
    const plan = parseArgv(["node", "gtd.js", "lsp", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toBe("gtd lsp does not accept --json")
  })

  it("--port on step is rejected", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "agent", "--port=1234"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd visualize`")
  })

  it("--var without --entry is rejected", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "agent", "--var", "a=1"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toBe("gtd: --var requires --entry")
  })

  it("--cost with --entry is rejected (the deleted cross-check, now via scope)", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human", "--entry", "foo", "--cost=5"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("only valid for `gtd step`")
      expect(plan.message).toContain("without --entry")
    }
  })

  it("--model with --entry is rejected the same way", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human", "--entry", "foo", "--model=gpt"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd step`")
  })

  it("--entry on a command other than step/bare is rejected", () => {
    const plan = parseArgv(["node", "gtd.js", "status", "--entry", "e"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toBe(
        "gtd: --entry is only valid for `gtd step` or the bare `gtd --entry <state>` form",
      )
    }
  })

  it("--model without --cost is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "agent", "--model=opus"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--model requires --cost")
  })

  it("--dispatch on step/status/… is a scope error", () => {
    for (const args of [
      ["step", "agent", "--dispatch"],
      ["status", "--dispatch"],
      ["validate", "--dispatch"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") {
        expect(plan.message).toBe("gtd: --dispatch is only valid for `gtd next`")
      }
    }
  })

  it("--if-resting on status is rejected", () => {
    const plan = parseArgv(["node", "gtd.js", "status", "--if-resting"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("only valid for `gtd step`")
      expect(plan.message).toContain("--if-resting")
    }
  })

  it("--if-resting with --entry is rejected the same way", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human", "--entry", "foo", "--if-resting"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("only valid for `gtd step`")
      expect(plan.message).toContain("--if-resting")
    }
  })

  it("--if-resting=true (arity-0 = form) is an unknown-option usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human", "--if-resting=true"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("unknown option '--if-resting=true'")
  })
})

describe("parseArgv — gtd next --dispatch", () => {
  it("--dispatch without --json is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--dispatch"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toBe("gtd: next --dispatch requires --json")
    }
  })

  it("--dispatch with --json parses to a next command with dispatch: true", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json", "--dispatch"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "next", dispatch: true })
      expect(plan.json).toBe(true)
    }
  })

  it("plain gtd next (no --dispatch) parses to dispatch: false", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "next", dispatch: false })
    }
  })
})

describe("parseArgv — --if-resting", () => {
  it("gtd step human --if-resting parses to a step command with ifResting: true", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human", "--if-resting"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "step", actor: "human", ifResting: true })
    }
  })

  it("gtd step human parses WITHOUT an ifResting key (omit-when-absent)", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "step", actor: "human" })
      expect(plan.command).not.toHaveProperty("ifResting")
    }
  })
})

describe("parseArgv — flag orthogonality", () => {
  it("--version with --json still produces the version output (flags are independent)", () => {
    const plan = parseArgv(["node", "gtd.js", "--version", "--json"])
    expect(plan.kind).toBe("output")
  })

  it("--help with extra args still prints help", () => {
    const plan = parseArgv(["node", "gtd.js", "--help", "--json"])
    expect(plan.kind).toBe("output")
  })
})

describe("parseArgv — bare/unknown command under --json", () => {
  it("bare gtd --json is a usage error with json:true and no full usage block on stdout", () => {
    const plan = parseArgv(["node", "gtd.js", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.json).toBe(true)
      expect(plan.message).toContain("missing command")
    }
  })

  it("bare gtd's missing-command message points at the README's minimal driver, not a bundled loop", () => {
    const plan = parseArgv(["node", "gtd.js"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("missing command")
      expect(plan.message).toContain("gtd decides and prints")
      expect(plan.message).toContain("README")
      expect(plan.message).toContain("A complete minimal driver")
    }
  })

  it("an unknown command under --json carries json:true and names the subcommand", () => {
    const plan = parseArgv(["node", "gtd.js", "bogus", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.json).toBe(true)
      expect(plan.message).toContain("bogus")
    }
  })
})

describe("parseArgv — entry/var flag details (formerly parseEntryFlags/takeFlagValues)", () => {
  it("accepts --entry=<state> (= form)", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human", "--entry=side-entry"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({
        kind: "entry",
        actor: "human",
        state: "side-entry",
        vars: {},
        label: "gtd step human --entry side-entry",
      })
    }
  })

  it("a bare --entry with no value is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human", "--entry"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--entry requires a value")
  })

  it("a second --entry occurrence is a usage error (not last-wins)", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry", "a", "--entry", "b"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--entry may be given at most once")
  })

  it("a duplicate --var NAME is a usage error", () => {
    const plan = parseArgv([
      "node",
      "gtd.js",
      "step",
      "human",
      "--entry",
      "e",
      "--var",
      "a=1",
      "--var",
      "a=2",
    ])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--var a")
  })

  it("a multiline --var value is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human", "--entry", "e", "--var", "a=1\n2"])
    expect(plan.kind).toBe("usage")
  })

  it("`gtd step human --entry foo` parses the actor as exactly 'human', not confusing the --entry value for a stray positional", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human", "--entry", "foo"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") expect(plan.command).toMatchObject({ actor: "human" })
  })
})

describe("parseArgv — the --entry selector", () => {
  it("`gtd step human --entry s` and `gtd --entry s` produce the same entry command modulo actor/label", () => {
    const viaStep = parseArgv(["node", "gtd.js", "step", "human", "--entry", "s"])
    const viaBare = parseArgv(["node", "gtd.js", "--entry", "s"])
    expect(viaStep.kind).toBe("command")
    expect(viaBare.kind).toBe("command")
    if (viaStep.kind === "command" && viaBare.kind === "command") {
      expect(viaStep.command).toEqual({
        kind: "entry",
        actor: "human",
        state: "s",
        vars: {},
        label: "gtd step human --entry s",
      })
      expect(viaBare.command).toEqual({
        kind: "entry",
        actor: "human",
        state: "s",
        vars: {},
        label: "gtd --entry s",
      })
    }
  })

  it("gtd --entry version parses to {kind:'entry', state:'version'} — the regression this RFC fixes", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry", "version"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toMatchObject({ kind: "entry", state: "version" })
    }
  })

  it("gtd --entry help likewise parses to an entry command, not the help text", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry", "help"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toMatchObject({ kind: "entry", state: "help" })
    }
  })
})

describe("parseArgv — gtd check <mode> <file>", () => {
  it("parses to a check command carrying mode and file", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "qa", ".gtd/TODO.md"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "check", mode: "qa", file: ".gtd/TODO.md" })
      expect(plan.json).toBe(false)
    }
  })

  it("--json is in scope for check", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "review", "REVIEW.md", "--json"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") expect(plan.json).toBe(true)
  })

  it("missing both arguments is a usage error naming mode and file", () => {
    const plan = parseArgv(["node", "gtd.js", "check"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("missing mode and file arguments")
    }
  })

  it("missing the file argument (mode only) is a usage error naming file", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "qa"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("missing file argument")
    }
  })

  it("too many arguments is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "qa", "TODO.md", "extra"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("too many arguments")
      expect(plan.message).toContain("extra")
    }
  })

  it("a scoped-out flag (e.g. --cost) is rejected on check", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "qa", "TODO.md", "--cost=5"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd step`")
  })
})

describe("parseArgv — help/version short-circuits", () => {
  it("--help produces an output plan", () => {
    expect(parseArgv(["node", "gtd.js", "--help"]).kind).toBe("output")
  })

  it("--version produces an output plan containing a semver", () => {
    const plan = parseArgv(["node", "gtd.js", "--version"])
    expect(plan.kind).toBe("output")
    if (plan.kind === "output") expect(plan.stdout).toMatch(/\d+\.\d+\.\d+/)
  })

  it("the `version` subcommand produces the same output as --version", () => {
    const a = parseArgv(["node", "gtd.js", "--version"])
    const b = parseArgv(["node", "gtd.js", "version"])
    expect(a).toEqual(b)
  })

  it("the `help` subcommand produces the same output as --help", () => {
    const a = parseArgv(["node", "gtd.js", "--help"])
    const b = parseArgv(["node", "gtd.js", "help"])
    expect(a).toEqual(b)
  })

  it("gtd bogus --help still prints help — help wins over an unknown command", () => {
    const plan = parseArgv(["node", "gtd.js", "bogus", "--help"])
    expect(plan.kind).toBe("output")
  })
})

describe("parseArgv — removed subcommands", () => {
  it("`gtd review <commitish>` points at the --entry replacement", () => {
    const plan = parseArgv(["node", "gtd.js", "review", "abc123"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("gtd review <commitish>")
      expect(plan.message).toContain("gone")
      expect(plan.message).toContain("--entry")
      expect(plan.message).not.toContain("unknown command")
    }
  })

  it("`gtd fix` points at the --entry replacement", () => {
    const plan = parseArgv(["node", "gtd.js", "fix"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("gtd fix")
      expect(plan.message).toContain("gone")
      expect(plan.message).toContain("--entry")
    }
  })

  it("`gtd loop` points at the README's minimal driver — not the old bash loop", () => {
    const plan = parseArgv(["node", "gtd.js", "loop"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("gtd loop")
      expect(plan.message).toContain("gone")
      expect(plan.message).toContain("README")
      expect(plan.message).toContain("A complete minimal driver")
      expect(plan.message).not.toContain("unknown command")
    }
  })
})

describe("standaloneKinds / needsOf", () => {
  it("pins the four standalone kinds", () => {
    expect(standaloneKinds()).toEqual(["lsp", "init", "visualize", "check"])
  })

  it("needsOf matches none/fs/config for the standalone kinds and state for everything else", () => {
    expect(needsOf("lsp")).toBe("none")
    expect(needsOf("check")).toBe("fs")
    expect(needsOf("init")).toBe("fs")
    expect(needsOf("visualize")).toBe("config")
    for (const kind of [
      "step",
      "entry",
      "abandon",
      "restore",
      "next",
      "status",
      "validate",
    ] as const) {
      expect(needsOf(kind)).toBe("state")
    }
  })
})

describe("renderHelp", () => {
  it("mentions every command and flag, and no removed surface", () => {
    const help = renderHelp()
    expect(help).toContain("Usage")
    expect(help).toContain("init ")
    expect(help).toContain("step <actor>")
    expect(help).toContain("--entry <state>")
    expect(help).toContain("--var")
    expect(help).toContain("abandon")
    expect(help).toContain("restore")
    expect(help).toContain("next")
    expect(help).toContain("status")
    expect(help).toContain("validate")
    expect(help).toContain("lsp")
    expect(help).toContain("visualize")
    expect(help).toContain("check <mode> <file>")
    expect(help).toContain("version")
    expect(help).toContain("help")
    expect(help).toContain("--json")
    expect(help).toContain("--port")
    expect(help).toContain("--no-open")
    expect(help).toContain("--cost")
    expect(help).toContain("--model")
    expect(help).toContain("--if-resting")
    expect(help).toContain("--version, -v")
    expect(help).toContain("--help, -h")
    expect(help).not.toContain("review <commitish>")
    expect(help).not.toContain("format <file>")
    expect(help).not.toContain("--verbose")
    expect(help).not.toContain("--debug")
    expect(help).not.toContain("bin/gtd")
    expect(help).not.toContain("(no command), loop")
    expect(help).toMatch(/\n$/)
  })

  it("every flag row's name appears in the Options: block and vice versa", () => {
    const help = renderHelp()
    const optionsBlock = help.slice(help.indexOf("Options:"))
    for (const name of FLAG_NAMES) expect(optionsBlock).toContain(name)
  })

  it("the README Commands fenced block equals renderHelp()", () => {
    const readme = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8")
    const match = readme.match(/## Commands\n\n```\n([\s\S]*?)\n```/)
    expect(match).not.toBeNull()
    expect(match![1] + "\n").toBe(renderHelp())
  })
})

describe("cliErrorLine", () => {
  it("prefixes a bare message with 'gtd: '", () => {
    expect(cliErrorLine(new Error("boom"))).toBe("gtd: boom")
  })

  it("does not double-prefix a message that already starts with 'gtd:'", () => {
    expect(cliErrorLine(new Error("gtd: already prefixed"))).toBe("gtd: already prefixed")
  })

  it("does not double-prefix a message that already starts with 'gtd '", () => {
    expect(cliErrorLine(new Error("gtd step human: out of turn"))).toBe(
      "gtd step human: out of turn",
    )
  })

  it("stringifies a non-Error thrown value", () => {
    expect(cliErrorLine("just a string")).toBe("gtd: just a string")
  })
})

// ---------------------------------------------------------------------------
// Runtime tier — through runCli with a capturing CliIo
// ---------------------------------------------------------------------------

interface Captured {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | undefined
  readonly layersBuilt: number
}

const capturingIo = (
  layers: () => Layer.Layer<CommandRequirements>,
): { io: CliIo; captured: () => Captured } => {
  let stdout = ""
  let stderr = ""
  let exitCode: number | undefined
  let layersBuilt = 0
  const io: CliIo = {
    stdout: (chunk) => {
      stdout += chunk
    },
    stderr: (chunk) => {
      stderr += chunk
    },
    exit: (code) => {
      exitCode = code
    },
    layers: () => {
      layersBuilt++
      return layers()
    },
  }
  return { io, captured: () => ({ stdout, stderr, exitCode, layersBuilt }) }
}

// A GitService/etc.-shaped Proxy whose every property access returns a
// method that fails — proves `layers()` is never even asked to build a real
// service for --version/--help/a usage error, and (for the "never invoked"
// tests) that `layers()` itself is never called.
const throwingLayers = (): Layer.Layer<CommandRequirements> =>
  Layer.effectDiscard(
    Effect.sync(() => {
      throw new Error("layers() must not be called")
    }),
  ) as Layer.Layer<CommandRequirements>

describe("runCli — layers() is never invoked for output/usage plans", () => {
  it("--version", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "--version"], io))
    expect(captured().layersBuilt).toBe(0)
  })

  it("--help", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "--help"], io))
    expect(captured().layersBuilt).toBe(0)
  })

  it("a usage error", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "bogus"], io))
    expect(captured().layersBuilt).toBe(0)
  })
})

describe("runCli — exit codes", () => {
  it("output plan: exit is never called (success)", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "--version"], io))
    expect(captured().exitCode).toBeUndefined()
  })

  it("usage plan: exit(1)", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "bogus"], io))
    expect(captured().exitCode).toBe(1)
  })
})

describe("runCli — --json envelopes", () => {
  it("a usage error under --json writes the envelope on stdout and one gtd: line on stderr", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "bogus", "--json"], io))
    const { stdout, stderr } = captured()
    const parsed = JSON.parse(stdout) as { state: string; prompt: string }
    expect(parsed.state).toBe("error")
    expect(stderr).toMatch(/^gtd: [^\n]*\n$/)
    expect(stderr).not.toContain("gtd: gtd:")
  })
})

describe("nodeCliIo", () => {
  it("exposes stdout/stderr/exit/layers", () => {
    expect(typeof nodeCliIo.stdout).toBe("function")
    expect(typeof nodeCliIo.stderr).toBe("function")
    expect(typeof nodeCliIo.exit).toBe("function")
    expect(typeof nodeCliIo.layers).toBe("function")
  })
})

// Re-exported so downstream test files can build Command values without
// importing from program.js — keeps the type import exercised here too.
export type { Command }
