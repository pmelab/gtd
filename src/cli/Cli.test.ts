/**
 * Parse-tier unit tests for src/cli/Cli.ts — `parseArgv` is pure and total, so
 * these need no repo, no layers, and no `Effect.runPromise`. Runtime-tier
 * tests (`runCli` through a capturing `CliIo`) live in the second `describe`
 * block below.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import * as fc from "fast-check"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  needsOf,
  nodeCliIo,
  normalizeTrailingNewline,
  parseArgv,
  renderHelp,
  runCli,
  standaloneKinds,
  type CliIo,
  type Command,
  type CliPlan,
  ToolCommands,
} from "./index.js"
import { EXIT_CODES, EXIT_RUNTIME_ERROR, EXIT_USAGE_ERROR } from "../wire/index.js"
import { Host } from "../platform/index.js"
import { type CommandRequirements } from "./Cli.js"
import { InMemRepo, makeCapturingCliIo, testLayers } from "../twins/index.js"

const FLAG_NAMES = [
  "--json",
  "--port",
  "--host",
  "--self-signed",
  "--dev",
  "--cost",
  "--model",
  "--var",
  "--threshold",
  "--open-questions",
  "--open-threads",
  "--verbose",
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
          if (argv.includes("--version") || argv.includes("-V")) return
          if (argv.includes("-v")) return
          if (FLAG_NAMES.some((f) => argv.includes(f))) return
          const plan: CliPlan = parseArgv(argv)
          expect(plan.kind).toBe("usage")
        },
      ),
    )
  })

  it("parseArgv(['node','gtd.js','next','--jsn']) is the exact usage plan", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--jsn"])
    expect(plan).toEqual({
      kind: "usage",
      stdout: "",
      message:
        "gtd: unknown option '--jsn' — did you mean `--json`? Run `gtd help <command>` for its options",
      json: false,
    })
  })
})

describe("parseArgv — arity", () => {
  it("`gtd land human` is an arity error (land takes no positional)", () => {
    const plan = parseArgv(["node", "gtd.js", "land", "human"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })

  it("`gtd next extra` is a usage error (next takes no argument)", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "extra"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })

  it("`gtd next --at` is an unknown-option usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--at"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("unknown option '--at'")
  })
})

describe("parseArgv — scope", () => {
  it("--cost on an unknown command reports the flag's own scope error, not the unknown command", () => {
    const plan = parseArgv(["node", "gtd.js", "frobnicate", "--cost=5"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd land`")
  })

  it("--json is in scope for next, land, the judge and script commands and the listings — every other command usage-errors on it", () => {
    for (const args of [
      ["next", "--json"],
      ["land", "--json"],
      ["judge", "--json"],
      ["judge", "answer", "--json"],
      ["validate", "--json"],
      ["abandon", "--json"],
      ["restore", "--json"],
      ["start", "--json"],
      ["start", "fix", "--json"],
      ["history", "fetch", "--json"],
    ]) {
      const ok = parseArgv(["node", "gtd.js", ...args])
      expect(ok.kind).toBe("command")
      if (ok.kind === "command") expect(ok.json).toEqual({ kind: "document" })
    }

    for (const args of [
      ["lsp", "--json"],
      ["check", "qa", "TODO.md", "--json"],
      ["guide", "--json"],
      ["summary", "--json"],
      ["base", "--json"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") {
        expect(plan.message).toContain("only valid for `gtd next`/`gtd land`")
        expect(plan.message).toContain("gtd guide")
      }
    }
  })

  it("--sh is gone: a bare unknown-option usage error on next and land, exit 2", () => {
    for (const args of [
      ["next", "--sh"],
      ["land", "--sh"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") {
        expect(plan.message).toContain("unknown option '--sh'")
      }
    }
  })

  it("--port on land is rejected", () => {
    const plan = parseArgv(["node", "gtd.js", "land", "--port=1234"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd ui`")
  })

  it("--port is accepted by gtd ui", () => {
    expect(parseArgv(["node", "gtd.js", "ui", "--port", "3000"]).kind).toBe("command")
  })

  it("--host on any other command (e.g. next) is a scope violation", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--host", "x"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toBe("gtd: --host is only valid for `gtd ui`")
    }
  })

  it("--var outside `gtd start` is rejected", () => {
    for (const args of [
      ["land", "--var", "a=1"],
      ["history", "judges", "--var", "qualityTriageMinP=0.9"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage")
        expect(plan.message).toBe("gtd: --var is only valid for `gtd start <name>`")
    }
  })

  it("--cost and --model on `gtd start` are rejected (landing and starting are different verbs)", () => {
    for (const flag of ["--cost=5", "--model=gpt"]) {
      const plan = parseArgv(["node", "gtd.js", "start", "foo", flag])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd land`")
    }
  })

  it("--workflow is gone: an unknown option on its own and after any command", () => {
    for (const args of [["--workflow", "e"], ["--workflow=e"], ["land", "--workflow", "e"]]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") expect(plan.message).toContain("unknown option '--workflow")
    }
  })

  it("--model without --cost is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "land", "--model=opus"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--model requires --cost")
  })

  it("--dispatch is gone: an unknown-option usage error everywhere, `gtd next` included", () => {
    for (const args of [
      ["land", "--dispatch"],
      ["validate", "--dispatch"],
      ["next", "--json", "--dispatch"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") {
        expect(plan.message).toContain("unknown option '--dispatch'")
      }
    }
  })
})

describe("parseArgv — gtd next", () => {
  it("parses to a bare next command — there is no separate claiming form any more", () => {
    const plan = parseArgv(["node", "gtd.js", "next"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "next" })
    }
  })

  it("gtd next --json parses to a next command with json set", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "next" })
      expect(plan.json).toEqual({ kind: "document" })
    }
  })

  it("gtd next --json=kind parses to JsonMode select with path 'kind'", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json=kind"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "next" })
      expect(plan.json).toEqual({ kind: "select", path: "kind" })
    }
  })

  it("gtd next with no --json parses to JsonMode off", () => {
    const plan = parseArgv(["node", "gtd.js", "next"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") expect(plan.json).toEqual({ kind: "off" })
  })

  it("gtd next --json=session.id parses to a dotted selector path verbatim", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json=session.id"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") expect(plan.json).toEqual({ kind: "select", path: "session.id" })
  })

  it("gtd next --json= is a usage error naming only the legal --json=<path> form — never the rejected empty form or the illegal space form", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json="])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toBe("gtd: --json requires a value — use --json=<path>")
      expect(plan.json).toBe(true)
    }
  })

  it("gtd next --json kind (space form) leaves kind as a positional — next takes none, so this is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json", "kind"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })

  it("--json is non-repeatable: a second bare occurrence is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--json may be given at most once")
  })

  it("--json is non-repeatable: two selector occurrences are a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json=a", "--json=b"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--json may be given at most once")
  })

  it("--json is non-repeatable across mixed bare/selector forms", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json", "--json=b"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--json may be given at most once")
  })
})

describe("parseArgv — gtd land", () => {
  it("gtd land parses to a bare land command", () => {
    const plan = parseArgv(["node", "gtd.js", "land"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "land" })
    }
  })

  it("gtd land --cost=5 --model=opus carries both, omitting neither key", () => {
    const plan = parseArgv(["node", "gtd.js", "land", "--cost=5", "--model=opus"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "land", cost: 5, model: "opus" })
    }
  })

  it("gtd land --json parses to a land command with json set", () => {
    const plan = parseArgv(["node", "gtd.js", "land", "--json"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "land" })
      expect(plan.json).toEqual({ kind: "document" })
    }
  })

  it("gtd land --json=script parses to JsonMode select with path 'script'", () => {
    const plan = parseArgv(["node", "gtd.js", "land", "--json=script"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") expect(plan.json).toEqual({ kind: "select", path: "script" })
  })

  it("gtd land --json=model and gtd land --model=<name> do not collide — different tokens", () => {
    const readBack = parseArgv(["node", "gtd.js", "land", "--json=model"])
    expect(readBack.kind).toBe("command")
    if (readBack.kind === "command") {
      expect(readBack.json).toEqual({ kind: "select", path: "model" })
      expect(readBack.command).toEqual({ kind: "land" })
    }

    const record = parseArgv(["node", "gtd.js", "land", "--model=opus", "--cost=1"])
    expect(record.kind).toBe("command")
    if (record.kind === "command") {
      expect(record.json).toEqual({ kind: "off" })
      expect(record.command).toEqual({ kind: "land", cost: 1, model: "opus" })
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
  // With no command resolved, `kind` is `undefined` — `--json`'s scope is
  // violated just like any other scoped flag used standalone, so its scope
  // error takes priority over "missing command"/"unknown command" here.
  it("bare gtd --json is a usage error with json:true, naming --json's own scope error", () => {
    const plan = parseArgv(["node", "gtd.js", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.json).toBe(true)
      expect(plan.message).toContain("only valid for `gtd next`")
    }
  })

  it("bare gtd prints a short usage, not the overview, and points at gtd help and gtd guide", () => {
    const plan = parseArgv(["node", "gtd.js"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("missing command")
      expect(plan.message).toContain("`gtd help`")
      expect(plan.message).toContain("gtd guide")
      expect(plan.stdout).toMatch(/^Usage: gtd <command>/)
      expect(plan.stdout.split("\n").length).toBeLessThan(10)
    }
  })

  it("an unknown command that looks like a typo names the nearest command", () => {
    expect(parseArgv(["node", "gtd.js", "nxt"])).toEqual({
      kind: "usage",
      stdout: "",
      message:
        "gtd: unknown command 'nxt' — did you mean `gtd next`? Run `gtd help` for every command",
      json: false,
    })
  })

  it("an unknown command nothing resembles points at gtd help only", () => {
    const plan = parseArgv(["node", "gtd.js", "frobnicate"])
    expect(plan.kind === "usage" && plan.message).toBe(
      "gtd: unknown command 'frobnicate' — run `gtd help` for every command",
    )
  })

  it("a mistyped history subcommand names the nearest one", () => {
    const plan = parseArgv(["node", "gtd.js", "history", "shwo"])
    expect(plan.kind === "usage" && plan.message).toContain("did you mean `gtd history show`?")
  })

  it("a bare --json followed by a word suggests the = form", () => {
    const plan = parseArgv(["node", "gtd.js", "next", "--json", "kind"])
    expect(plan.kind === "usage" && plan.message).toBe(
      "gtd next: too many arguments — expected none, got: kind — to print one field, write --json=kind",
    )
  })

  it("an unknown single-dash option is an unknown option, not an extra argument", () => {
    const plan = parseArgv(["node", "gtd.js", "-j", "next"])
    expect(plan.kind === "usage" && plan.message).toContain("unknown option '-j'")
  })

  it("an unknown command under --json carries json:true, naming --json's own scope error over the subcommand", () => {
    const plan = parseArgv(["node", "gtd.js", "bogus", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.json).toBe(true)
      expect(plan.message).toContain("only valid for `gtd next`")
    }
  })

  it("an unknown command without --json still names the subcommand", () => {
    const plan = parseArgv(["node", "gtd.js", "bogus"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.json).toBe(false)
      expect(plan.message).toContain("bogus")
    }
  })
})

describe("parseArgv — --var details", () => {
  it("a second --var occurrence of one name is a usage error (not last-wins)", () => {
    const plan = parseArgv(["node", "gtd.js", "start", "e", "--var", "a=1", "--var", "a=2"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--var a")
  })

  it("a --var name outside the setting-name rule is a usage error naming it", () => {
    for (const raw of ["a b=1", "a-b=1", "1a=1", "a\nb=1"]) {
      const plan = parseArgv(["node", "gtd.js", "start", "e", "--var", raw])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") {
        expect(plan.message).toContain(
          `--var ${JSON.stringify(raw.slice(0, raw.indexOf("=")))} is not a valid setting name`,
        )
      }
    }
  })

  it("a multiline --var value is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "start", "e", "--var", "a=1\n2"])
    expect(plan.kind).toBe("usage")
  })
})

describe("parseArgv — --entry is removed", () => {
  it("is an ordinary unknown option", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry", "fix-precheck"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--entry")
  })
})

describe("parseArgv — gtd start <name>", () => {
  it("a workflow named like a command word still parses to a start command", () => {
    for (const name of ["version", "help"]) {
      const plan = parseArgv(["node", "gtd.js", "start", name])
      expect(plan.kind).toBe("command")
      if (plan.kind === "command") expect(plan.command).toMatchObject({ kind: "start", name })
    }
  })
})

describe("parseArgv — gtd check <mode> <file>", () => {
  it("parses to a check command carrying mode and file", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "qa", ".gtd/TODO.md"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "check", mode: "qa", file: ".gtd/TODO.md" })
      expect(plan.json).toEqual({ kind: "off" })
    }
  })

  it("--json is out of scope for check — next/land are the only structured surfaces", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "review", "REVIEW.md", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd next`")
  })

  it("bare --open-threads (no mode, no file) parses to a check command", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "--open-threads"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "check", openThreads: true })
    }
  })

  it("the <mode> <file> --open-threads form is unchanged", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "qa", "N.md", "--open-threads"])
    expect(plan.kind === "command" && plan.command).toEqual({
      kind: "check",
      mode: "qa",
      file: "N.md",
      openThreads: true,
    })
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
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd land`")
  })
})

describe("parseArgv — gtd uncheck <file>", () => {
  it("parses to an uncheck command carrying file", () => {
    const plan = parseArgv(["node", "gtd.js", "uncheck", ".gtd/REVIEW.md"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "uncheck", file: ".gtd/REVIEW.md" })
      expect(plan.json).toEqual({ kind: "off" })
    }
  })

  it("missing the file argument is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "uncheck"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("missing file argument")
  })

  it("too many arguments is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "uncheck", "REVIEW.md", "extra"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("too many arguments")
      expect(plan.message).toContain("extra")
    }
  })

  it("takes no mode argument — a second positional is rejected as extra, never accepted as mode", () => {
    const plan = parseArgv(["node", "gtd.js", "uncheck", "qa", "REVIEW.md"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })

  it("a scoped-out flag (e.g. --cost) is rejected on uncheck", () => {
    const plan = parseArgv(["node", "gtd.js", "uncheck", "REVIEW.md", "--cost=5"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd land`")
  })
})

describe("parseArgv — gtd check --open-questions", () => {
  it("parses to a check command carrying openQuestions: true", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "qa", ".gtd/TODO.md", "--open-questions"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({
        kind: "check",
        mode: "qa",
        file: ".gtd/TODO.md",
        openQuestions: true,
      })
    }
  })

  it("omits openQuestions entirely when the flag is absent (unchanged shape)", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "qa", ".gtd/TODO.md"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "check", mode: "qa", file: ".gtd/TODO.md" })
      expect("openQuestions" in plan.command).toBe(false)
    }
  })

  it("--open-questions on any other command is a usage error carrying its own scopeError", () => {
    const plan = parseArgv(["node", "gtd.js", "land", "--open-questions"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toBe("gtd: --open-questions is only valid for `gtd check`")
    }
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

  it("-V short-circuits to the version output, exactly like --version", () => {
    const a = parseArgv(["node", "gtd.js", "-V"])
    const b = parseArgv(["node", "gtd.js", "--version"])
    expect(a).toEqual(b)
  })
})

describe("parseArgv — --verbose / -v (the -v/-V swap)", () => {
  it("bare `gtd -v` no longer prints a version — it is the missing-command usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "-v"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("missing command")
  })

  it("-v resolves to --verbose: `gtd -v next` carries verbose: true", () => {
    const plan = parseArgv(["node", "gtd.js", "-v", "next"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "next" })
      expect(plan.verbose).toBe(true)
    }
  })

  it("--verbose is equivalent to -v", () => {
    const a = parseArgv(["node", "gtd.js", "next", "--verbose"])
    const b = parseArgv(["node", "gtd.js", "next", "-v"])
    expect(a).toEqual(b)
  })

  it("every other command's plan carries verbose: false when the flag is absent", () => {
    const plan = parseArgv(["node", "gtd.js", "next"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") expect(plan.verbose).toBe(false)
  })

  it("--verbose is valid alongside every command kind — never a scope violation", () => {
    for (const args of [
      ["land", "--verbose"],
      ["next", "--verbose", "--json"],
      ["check", "qa", "TODO.md", "--verbose"],
      ["start", "some-state", "--verbose"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("command")
      if (plan.kind === "command") expect(plan.verbose).toBe(true)
    }
  })
})

describe("parseArgv — gtd guide", () => {
  it("parses to a guide command", () => {
    const plan = parseArgv(["node", "gtd.js", "guide"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "guide" })
      expect(plan.json).toEqual({ kind: "off" })
    }
  })

  it("install, door and doors are gone: unknown commands", () => {
    expect(parseArgv(["node", "gtd.js", "install"])).toMatchObject({
      kind: "usage",
      message: expect.stringContaining("unknown command 'install'"),
    })
    for (const word of ["door", "doors"]) {
      expect(parseArgv(["node", "gtd.js", word, "fix"])).toMatchObject({
        kind: "usage",
        message: expect.stringContaining(`unknown command '${word}'`),
      })
    }
    expect(parseArgv(["node", "gtd.js", "help", "install"]).kind).toBe("usage")
    expect(renderHelp()).not.toMatch(/^ {2}(install|doors?)\b|--workflow|Older spellings/m)
  })

  it("gtd guide extra is a usage error (guide takes no argument)", () => {
    const plan = parseArgv(["node", "gtd.js", "guide", "extra"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })

  it("a scoped-out flag (e.g. --port) is rejected on guide", () => {
    const plan = parseArgv(["node", "gtd.js", "guide", "--port=3"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd ui`")
  })
})

describe("parseArgv — gtd ui", () => {
  it("parses --host/--port/--self-signed/--dev into one ui command", () => {
    const plan = parseArgv([
      "node",
      "gtd.js",
      "ui",
      "--host",
      "h",
      "--port",
      "8443",
      "--self-signed",
      "--dev",
    ])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({
        kind: "ui",
        host: "h",
        port: 8443,
        selfSigned: true,
        dev: true,
      })
    }
  })

  it("bare `gtd ui` omits host/port and defaults selfSigned/dev to false", () => {
    const plan = parseArgv(["node", "gtd.js", "ui"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "ui", selfSigned: false, dev: false })
    }
  })

  it("gtd ui --bogus is an unknown-option usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "ui", "--bogus"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("unknown option '--bogus'")
  })

  it("gtd ui extra is a usage error — ui takes no positional argument", () => {
    const plan = parseArgv(["node", "gtd.js", "ui", "extra"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })
})

describe("parseArgv — gtd judge / gtd judge answer", () => {
  it("gtd judge parses to a bare judge command", () => {
    const plan = parseArgv(["node", "gtd.js", "judge"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "judge" })
      expect(plan.json).toEqual({ kind: "off" })
    }
  })

  it("gtd judge answer parses to a judgeAnswer command — the CLI's one two-level verb", () => {
    const plan = parseArgv(["node", "gtd.js", "judge", "answer"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "judgeAnswer" })
    }
  })

  it("gtd judge --json / gtd judge answer --json both parse with json set", () => {
    for (const args of [
      ["judge", "--json"],
      ["judge", "answer", "--json"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("command")
      if (plan.kind === "command") expect(plan.json).toEqual({ kind: "document" })
    }
  })

  it("gtd judge extra (not 'answer') is a too-many-arguments usage error, not judgeAnswer", () => {
    const plan = parseArgv(["node", "gtd.js", "judge", "extra"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })

  it("gtd judge answer extra is a too-many-arguments usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "judge", "answer", "extra"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })

  it("a scoped-out flag (e.g. --cost) is rejected on judge and judge answer", () => {
    for (const args of [
      ["judge", "--cost=5"],
      ["judge", "answer", "--cost=5"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd land`")
    }
  })
})

describe("parseArgv — gtd judge run", () => {
  const parse = (...args: string[]) => parseArgv(["node", "gtd.js", ...args])

  it("parses --provider fixed with --answers", () => {
    const plan = parse("judge", "run", "--provider", "fixed", "--answers", "a.json")
    expect(plan.kind === "command" && plan.command).toEqual({
      kind: "judgeRun",
      provider: "fixed",
      answers: "a.json",
    })
  })

  it("parses --provider jev alone", () => {
    const plan = parse("judge", "run", "--provider=jev")
    expect(plan.kind === "command" && plan.command).toEqual({ kind: "judgeRun", provider: "jev" })
  })

  it("parses --provider llm with --model", () => {
    const plan = parse("judge", "run", "--provider=llm", "--model", "sonnet")
    expect(plan.kind === "command" && plan.command).toEqual({
      kind: "judgeRun",
      provider: "llm",
      model: "sonnet",
    })
  })

  it("parses no --provider (auto), with or without --model", () => {
    const bare = parse("judge", "run")
    expect(bare.kind === "command" && bare.command).toEqual({ kind: "judgeRun" })
    const model = parse("judge", "run", "--model=x")
    expect(model.kind === "command" && model.command).toEqual({ kind: "judgeRun", model: "x" })
  })

  it.each([
    [["judge", "run", "--provider", "nope"], "must be one of fixed, jev, llm"],
    [["judge", "run", "--answers", "a.json"], "--answers is only valid with --provider fixed"],
    [["judge", "run", "--provider", "jev", "--model", "x"], "--model"],
    [["judge", "run", "--provider", "fixed", "--model", "x"], "--model"],
    [["next", "--model", "x"], "`gtd land` (with --cost: the model to record the cost against)"],
    [["judge", "run", "--provider", "fixed", "--json"], "--json is only valid"],
    [["judge", "run", "--provider", "fixed", "--answers="], "requires a value"],
    [["judge", "--provider", "fixed"], "only valid for `gtd judge run`"],
    [["judge", "answer", "--answers", "a.json"], "only valid for `gtd judge run`"],
    [["next", "--provider", "fixed"], "only valid for `gtd judge run`"],
  ])("%j is a usage error", (args, text) => {
    const plan = parse(...args)
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain(text)
  })
})

describe("parseArgv — gtd history", () => {
  const parse = (...args: string[]) => parseArgv(["node", "gtd.js", ...args])
  const usage = (plan: CliPlan): string => (plan.kind === "usage" ? plan.message : "")

  it("history list / show <ref> / fetch parse to their commands", () => {
    expect(parse("history", "list")).toMatchObject({
      kind: "command",
      command: { kind: "historyList" },
    })
    expect(parse("history", "show", "feat/x")).toMatchObject({
      kind: "command",
      command: { kind: "historyShow", ref: "feat/x" },
    })
    expect(parse("history", "fetch")).toMatchObject({
      kind: "command",
      command: { kind: "historyFetch", remote: "origin" },
    })
    expect(parse("history", "fetch", "upstream")).toMatchObject({
      command: { kind: "historyFetch", remote: "upstream" },
    })
    expect(parse("history", "metrics")).toMatchObject({
      command: { kind: "historyMetrics", refs: [] },
    })
    expect(parse("history", "metrics", "a", "feat/b")).toMatchObject({
      command: { kind: "historyMetrics", refs: ["a", "feat/b"] },
    })
    expect(parse("history", "judges", "a", "--threshold", "qualityTriageMinP=0.9")).toMatchObject({
      command: {
        kind: "historyJudges",
        refs: ["a"],
        vars: { qualityTriageMinP: "0.9" },
        jsonl: false,
      },
    })
    expect(parse("history", "judges", "--jsonl")).toMatchObject({
      command: { kind: "historyJudges", refs: [], vars: {}, jsonl: true },
    })
  })

  it("judges takes only judge thresholds as --threshold, and --jsonl alone", () => {
    expect(
      parse(
        "history",
        "judges",
        "--threshold=qualityTriageMinP=0.9",
        "--threshold",
        "judgeIdenticalMinP=0.5",
      ),
    ).toMatchObject({
      command: { vars: { qualityTriageMinP: "0.9", judgeIdenticalMinP: "0.5" } },
    })
    expect(usage(parse("history", "judges", "--threshold", "reviewBase=main"))).toBe(
      "gtd history judges: --threshold reviewBase is no judge threshold — use judgeIdenticalMinP or qualityTriageMinP",
    )
    expect(usage(parse("history", "judges", "--threshold", "toString=0.9"))).toContain(
      "no judge threshold",
    )
    for (const value of ["x", "0,9"]) {
      expect(usage(parse("history", "judges", "--threshold", `qualityTriageMinP=${value}`))).toBe(
        `gtd history judges: --threshold qualityTriageMinP must be a number — got "${value}"`,
      )
    }
    expect(usage(parse("history", "judges", "--jsonl", "--json"))).toContain("mutually exclusive")
    expect(
      usage(parse("history", "judges", "--jsonl", "--threshold", "qualityTriageMinP=1")),
    ).toContain("mutually exclusive")
    expect(usage(parse("history", "metrics", "--threshold", "qualityTriageMinP=1"))).toContain(
      "only valid for `gtd history judges`",
    )
    expect(usage(parse("history", "metrics", "--jsonl"))).toContain("only valid for")
    const help = helpFor("help", "history", "judges")
    expect(help).toContain("--threshold <name>=<value>")
    expect(help).not.toContain("--var")
  })

  it("bare history and an unknown subcommand are usage errors naming list, show, metrics, fetch", () => {
    for (const args of [["history"], ["history", "nope"]]) {
      const message = usage(parse(...args))
      expect(message).toContain("list")
      expect(message).toContain("show")
      expect(message).toContain("fetch")
      expect(message).toContain("metrics")
      expect(message).toContain("judges")
    }
  })

  it("show without a ref, and extra arguments, are usage errors", () => {
    expect(usage(parse("history", "show"))).toContain("missing ref")
    expect(usage(parse("history", "show", "a", "b"))).toContain("too many arguments")
    expect(usage(parse("history", "list", "x"))).toContain("too many arguments")
    expect(usage(parse("history", "fetch", "a", "b"))).toContain("too many arguments")
  })

  it("--json is accepted for list, show, metrics and fetch", () => {
    expect(parse("history", "list", "--json")).toMatchObject({ json: { kind: "document" } })
    expect(parse("history", "show", "x", "--json=ended")).toMatchObject({
      json: { kind: "select", path: "ended" },
    })
    expect(parse("history", "metrics", "--json=total.refactorFirstRate")).toMatchObject({
      json: { kind: "select", path: "total.refactorFirstRate" },
    })
    expect(parse("history", "fetch", "--json=script")).toMatchObject({
      json: { kind: "select", path: "script" },
    })
  })

  it("help lists the four history rows", () => {
    const help = renderHelp()
    expect(help).toMatch(/^ {2}history list\b/m)
    expect(help).toContain("history show <ref>")
    expect(help).toContain("history fetch [remote]")
    expect(help).toContain("history metrics [ref...]")
    expect(help).toContain("history judges [ref...]")
  })
})

describe("parseArgv — gtd start", () => {
  const parse = (...args: string[]): CliPlan => parseArgv(["node", "gtd.js", ...args])

  it("bare `gtd start` parses with no name, so the loaded config can list what starts", () => {
    expect(parse("start")).toEqual({
      kind: "command",
      command: { kind: "start", args: [], vars: {} },
      json: { kind: "off" },
      verbose: false,
    })
    expect(parse("start", "--json")).toMatchObject({ json: { kind: "document" } })
  })

  it("carries the name, every positional after it, and the --var pins", () => {
    expect(parse("start", "review", "main", "--var", "a=1", "--var=b=2")).toMatchObject({
      command: { kind: "start", name: "review", args: ["main"], vars: { a: "1", b: "2" } },
    })
  })

  it("--var with no name is a usage error", () => {
    const plan = parse("start", "--var", "a=1")
    expect(plan.kind === "usage" && plan.message).toContain("--var needs a <name>")
  })

  it("its help names doors, workflows, --var and the --json=script idiom", () => {
    const help = helpFor("help", "start")
    expect(help).toMatch(/^Usage: gtd start \[name\] \[args\.\.\.\] \[options\]\n/)
    expect(help).toMatch(/A door\s+shadows a workflow of the same name/)
    expect(help).toContain("--var <name>=<value>")
    expect(help).toContain('s=$(gtd start <name> --json=script) && sh -c "$s"')
  })
})

describe("parseArgv — -- ends the options", () => {
  const parse = (...args: string[]): CliPlan => parseArgv(["node", "gtd.js", ...args])

  it("every word after -- is a positional, even one that looks like an option", () => {
    expect(parse("strays", "a..b", "--", "--weird", "-x")).toMatchObject({
      command: { kind: "strays", globs: ["--weird", "-x"] },
    })
    expect(parse("start", "fix", "--json=script", "--", "--var")).toMatchObject({
      command: { kind: "start", name: "fix", args: ["--var"], vars: {} },
      json: { kind: "select", path: "script" },
    })
  })

  it("--help, -h, --version and -V after -- are arguments, not short-circuits", () => {
    expect(parse("start", "fix", "--", "--help")).toMatchObject({
      command: { kind: "start", args: ["--help"] },
    })
    expect(parse("start", "fix", "--", "-V").kind).toBe("command")
    expect(parse("next", "--", "--version")).toMatchObject({ kind: "usage" })
  })

  it("a bare -- changes nothing", () => {
    expect(parse("next", "--")).toEqual(parse("next"))
  })

  it("an option that needs a value never takes -- as it", () => {
    const plan = parse("start", "fix", "--var", "--", "a=1")
    expect(plan.kind === "usage" && plan.message).toContain("--var requires a value")
  })
})

describe("parseArgv — gtd strays", () => {
  const strays = (...args: string[]): CliPlan => parseArgv(["node", "gtd.js", "strays", ...args])

  it("splits the range at '..' and carries the globs", () => {
    const plan = strays("main..feature", "src/**", "*.md")
    expect(plan).toMatchObject({
      kind: "command",
      command: { kind: "strays", base: "main", tip: "feature", globs: ["src/**", "*.md"] },
    })
  })

  it("an empty side becomes HEAD; no globs is an empty list", () => {
    expect(strays("main..")).toMatchObject({
      command: { base: "main", tip: "HEAD", globs: [] },
    })
    expect(strays("..main")).toMatchObject({ command: { base: "HEAD", tip: "main" } })
    expect(strays("..")).toMatchObject({ command: { base: "HEAD", tip: "HEAD" } })
  })

  it("a missing range, a range without '..', a '...' range and a second '..' are usage errors", () => {
    for (const args of [[], ["main"], ["main...feature"], ["a..b..c"]]) {
      expect(strays(...args).kind).toBe("usage")
    }
    const plan = strays("main")
    if (plan.kind === "usage") expect(plan.message).toContain("<base>..<tip>")
  })

  it("--json is in scope: bare and selected", () => {
    expect(strays("a..b", "--json")).toMatchObject({ kind: "command", json: { kind: "document" } })
    expect(strays("a..b", "--json=0")).toMatchObject({
      kind: "command",
      json: { kind: "select", path: "0" },
    })
  })

  it("--json's scope error and help name strays", () => {
    const plan = parseArgv(["node", "gtd.js", "lsp", "--json"])
    if (plan.kind === "usage") expect(plan.message).toContain("`gtd strays`")
    expect(renderHelp()).toContain("strays <range> [glob...]")
    const help = parseArgv(["node", "gtd.js", "help", "strays"])
    expect(help.kind === "output" && help.stdout).toContain("--json[=<path>]")
  })
})

describe("standaloneKinds / needsOf", () => {
  it("pins the standalone kinds", () => {
    expect(standaloneKinds()).toEqual(["lsp", "check", "uncheck", "guide", "judgeRun", "strays"])
  })

  it("needsOf matches none/fs for the standalone kinds and state for everything else", () => {
    expect(needsOf("lsp")).toBe("none")
    expect(needsOf("check")).toBe("fs")
    expect(needsOf("uncheck")).toBe("fs")
    expect(needsOf("guide")).toBe("none")
    expect(needsOf("judgeRun")).toBe("none")
    expect(needsOf("strays")).toBe("none")
    for (const kind of [
      "land",
      "start",
      "abandon",
      "restore",
      "next",
      "validate",
      "ui",
      "judge",
      "judgeAnswer",
      "historyList",
      "historyShow",
      "historyMetrics",
      "historyJudges",
      "historyFetch",
    ] as const) {
      expect(needsOf(kind)).toBe("state")
    }
  })
})

const helpFor = (...args: string[]): string => {
  const plan = parseArgv(["node", "gtd.js", ...args])
  if (plan.kind !== "output") throw new Error(`no help for ${args.join(" ")}`)
  return plan.stdout
}

/** The command names the overview lists — `  name ` lines, as the docs pins read them. */
const listedCommands = (): string[] =>
  [...renderHelp().matchAll(/^ {2}([a-z]+(?:-[a-z]+)?(?: [a-z]+)?)(?= )/gm)].map(([, n]) => n!)

describe("renderHelp", () => {
  it("groups the commands and mentions no removed surface", () => {
    const help = renderHelp()
    for (const heading of ["Core loop:", "Start and stop:", "Inspect:", "Driver plumbing:"]) {
      expect(help).toContain(`\n${heading}\n`)
    }
    expect(help).toContain("start [name] [args...]")
    expect(help).toContain("check <mode> <file>")
    expect(help).toContain("-V, --version")
    expect(help).toContain("-h, --help")
    expect(help).toContain("Examples:")
    for (const removed of [
      "--workflow",
      "Older spellings",
      "visualize",
      ".gtdrc",
      "--no-open",
      "--debug",
      "--dispatch",
      "bin/gtd",
    ]) {
      expect(help).not.toContain(removed)
    }
    expect(help).not.toMatch(/^ {2}(init|serve|install|door|doors)\b/m)
    expect(help).toMatch(/\n$/)
  })

  it("keeps every line of every help text within 80 columns", () => {
    for (const text of [renderHelp(), ...listedCommands().map((name) => helpFor("help", name))]) {
      for (const line of text.split("\n")) expect(line.length, line).toBeLessThanOrEqual(80)
    }
  })

  it("names no internals", () => {
    const all = [renderHelp(), ...listedCommands().map((name) => helpFor("help", name))].join("")
    for (const internal of ["it.processCost", "refs/worktree/gtd/history", "Effect Schema"]) {
      expect(all).not.toContain(internal)
    }
  })

  it("every flag is in the help of a command it is valid for", () => {
    const all = [renderHelp(), ...listedCommands().map((name) => helpFor("help", name))].join("")
    for (const name of FLAG_NAMES) expect(all).toContain(name)
  })

  it("gtd <cmd> --help, gtd <cmd> -h and gtd help <cmd> print that command's own help", () => {
    const help = helpFor("help", "land")
    expect(help).toMatch(/^Usage: gtd land \[options\]\n/)
    expect(help).toContain("--cost=<n>")
    expect(help).not.toContain("--port")
    expect(helpFor("land", "--help")).toBe(help)
    expect(helpFor("land", "-h")).toBe(help)
  })

  it("a two-word command's help is its own", () => {
    expect(helpFor("judge", "run", "--help")).toMatch(/^Usage: gtd judge run \[options\]/)
    expect(helpFor("help", "history", "show")).toMatch(/^Usage: gtd history show <ref>/)
  })

  it("a flag that means something else per command is described per command", () => {
    expect(helpFor("help", "land")).toContain("With --cost: the model")
    expect(helpFor("help", "land")).toContain("nothing runs on it")
    expect(helpFor("help", "judge", "run")).toContain("The claude model")
    expect(helpFor("help", "abandon")).toContain("Print { schema, script }")
    expect(helpFor("help", "next")).not.toContain("Print { schema, script }")
  })

  it("--help after an unknown command still prints the overview", () => {
    expect(helpFor("bogus", "--help")).toBe(renderHelp())
  })

  it("gtd help <unknown> is a usage error naming the nearest command", () => {
    const plan = parseArgv(["node", "gtd.js", "help", "lnad"])
    expect(plan).toEqual({
      kind: "usage",
      stdout: "",
      message:
        "gtd: help: no command 'lnad' — did you mean `gtd help land`? Run `gtd help` for every command",
      json: false,
    })
  })

  it("the docs/cli.md Commands fenced block equals renderHelp()", () => {
    const doc = readFileSync(resolve(import.meta.dirname, "../../docs/cli.md"), "utf8")
    const match = doc.match(/## Commands\n\n```\n([\s\S]*?)\n```/)
    expect(match).not.toBeNull()
    expect(match![1] + "\n").toBe(renderHelp())
  })

  it("docs/cli.md's Every command section is every command's help, in the overview's order", () => {
    const doc = readFileSync(resolve(import.meta.dirname, "../../docs/cli.md"), "utf8")
    const section = doc.slice(doc.indexOf("\n## Every command\n"))
    const documented = [...section.matchAll(/^### `gtd ([^`]+)`\n\n```\n([\s\S]*?)```\n/gm)].map(
      ([, name, help]) => [name, help],
    )
    expect(documented).toEqual(listedCommands().map((name) => [name, helpFor("help", name)]))
  })

  it("README.md and COMPATIBILITY.md list exactly the commands", () => {
    const commands = new Set(
      [...renderHelp().matchAll(/^ {2}([a-z]+(?:-[a-z]+)?(?: [a-z]+)?)(?= )/gm)].map(
        ([, name]) => name,
      ),
    )
    expect(commands).toContain("judge answer")
    const listed = (file: string, list: RegExp): Set<string> => {
      const doc = readFileSync(resolve(import.meta.dirname, file), "utf8")
      const match = doc.match(list)
      expect(match, file).not.toBeNull()
      return new Set(
        [...match![1]!.matchAll(/`([a-z]+(?:-[a-z]+)?(?: [a-z]+)?)`/g)].map(([, name]) => name!),
      )
    }
    expect(
      listed("../../README.md", /The `gtd` bin's commands — ([\s\S]*?) — are\s+listed/),
    ).toEqual(commands)
    expect(listed("../../COMPATIBILITY.md", /every command \(([\s\S]*?)\),\s+option/)).toEqual(
      commands,
    )
  })

  it("docs/cli.md's Exit codes table, pinned beside the rendered help output, is exactly wire's frozen EXIT_CODES", () => {
    const doc = readFileSync(resolve(import.meta.dirname, "../../docs/cli.md"), "utf8")
    const match = doc.match(/### Exit codes\n\n[^\n]*\n[^\n]*\n\n((?:\|.*\n)+)/)
    expect(match).not.toBeNull()
    const table = match![1] ?? ""
    const codes = [...table.matchAll(/\|\s*(\d+)(?:\s*\/\s*(\d+))?\s*\|/g)].flatMap(([, a, b]) =>
      b !== undefined ? [Number(a), Number(b)] : [Number(a)],
    )
    expect(new Set(codes)).toEqual(EXIT_CODES)
  })
})

interface Captured {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | undefined
  readonly layersBuilt: number
}

const capturingIo = (
  layers: (verbose: boolean) => Layer.Layer<CommandRequirements>,
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
    layers: (verbose) => {
      layersBuilt++
      return layers(verbose)
    },
  }
  return { io, captured: () => ({ stdout, stderr, exitCode, layersBuilt }) }
}

// Fails as soon as any property is accessed — proves `layers()` is never
// asked to build a real service for --version/--help/a usage error.
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

describe("runCli — a garbled GTD_FLAG_* value", () => {
  it("exits 1 naming the variable", async () => {
    const { io, captured } = capturingIo(
      () =>
        Layer.succeed(Host, {
          root: "/",
          home: "/",
          scratchDir: "/",
          realPath: (p: string) => Effect.succeed(p),
          env: { GTD_FLAG_BETA: "ture" },
        }) as unknown as Layer.Layer<CommandRequirements>,
    )
    await Effect.runPromise(
      runCli(["node", "gtd.js", "next"], {
        ...io,
        flags: [{ name: "beta", owner: "pmelab", expiry: "2099-01-01", kind: "ops" }],
      }),
    )
    expect(captured().exitCode).toBe(1)
    expect(captured().stdout).toBe("")
    expect(captured().stderr).toContain("GTD_FLAG_BETA")
  })
})

describe("runCli — StartFlags", () => {
  const CONFIG = `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
}

export const side = workflow(
  async () => {
    await agent("working", "w")
  },
  { defaults: { flag_beta: "0" } },
)
`
  const BETA = { name: "beta", owner: "pmelab", expiry: "2099-01-01", kind: "release" } as const
  const start = async (
    flags?: CliIo["flags"],
    env: Record<string, string> = {},
  ): Promise<string> => {
    const repo = new InMemRepo()
    repo.writeFile("gtd.config.ts", CONFIG)
    repo.seedCommit("chore: add workflow")
    const { io, result } = makeCapturingCliIo(repo, env)
    await Effect.runPromise(
      runCli(["node", "gtd.js", "start", "side"], { ...io, ...(flags ? { flags } : {}) }),
    )
    return result().stdout
  }

  it("pins flag_beta=1 with the flag on", async () => {
    expect(await start([BETA], { GTD_FLAG_BETA: "1" })).toContain("flag_beta=1")
  })

  it("honours defaultOn with GTD_FLAG_* unset", async () => {
    const out = await start([{ ...BETA, defaultOn: true }], { GTD_FLAG_BETA: "" })
    expect(out).toContain("flag_beta=1")
  })
})

const IDLE_CONFIG = `import { human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle", { message: "hi" })
}
`

describe("runCli — exit codes", () => {
  it("output plan: exit is never called (success) — --help and --version still exit 0", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "--version"], io))
    expect(captured().exitCode).toBeUndefined()
    const { io: helpIo, captured: helpCaptured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "--help"], helpIo))
    expect(helpCaptured().exitCode).toBeUndefined()
  })

  it("usage plan: exit(EXIT_USAGE_ERROR) — an unknown/missing/malformed invocation, never EXIT_RUNTIME_ERROR", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "bogus"], io))
    expect(captured().exitCode).toBe(EXIT_USAGE_ERROR)
  })

  it("gtd ui --bogus exits EXIT_USAGE_ERROR (unknown flag)", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "ui", "--bogus"], io))
    expect(captured().exitCode).toBe(EXIT_USAGE_ERROR)
  })

  it("--host on a non-ui command exits EXIT_USAGE_ERROR with a clear scopeError message", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "next", "--host", "x"], io))
    const result = captured()
    expect(result.exitCode).toBe(EXIT_USAGE_ERROR)
    expect(result.stderr).toContain("only valid for `gtd ui`")
  })

  it("a command failure that is NOT a usage error still exits EXIT_RUNTIME_ERROR", async () => {
    // Unlike a usage error (never builds a layer), a resolved command
    // always does, so this exercises `report`'s own exit code.
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "next"], io))
    expect(captured().exitCode).toBe(EXIT_RUNTIME_ERROR)
  })

  it("an unknown --json=<path> selector exits EXIT_USAGE_ERROR, not EXIT_RUNTIME_ERROR — Program.ts's SelectorUsageError mapped by report()", async () => {
    const repo = new InMemRepo()
    repo.writeFile("NOTE.md", "a note\n")
    repo.writeFile("gtd.config.ts", IDLE_CONFIG)
    repo.seedCommit("gtd: init")
    const { io, captured } = capturingIo(() => testLayers(repo))
    await Effect.runPromise(runCli(["node", "gtd.js", "next", "--json=does.not.exist"], io))
    const { stdout, stderr, exitCode } = captured()
    expect(exitCode).toBe(EXIT_USAGE_ERROR)
    expect(stdout).toBe("")
    expect(stderr).toContain("does.not.exist")
  })
})

describe("runCli — --json envelopes", () => {
  it("a usage error under --json writes the envelope on stderr, leaving stdout byte-empty", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "bogus", "--json"], io))
    const { stdout, stderr } = captured()
    expect(stdout).toBe("")
    const [envelopeLine] = stderr.split("\n")
    const parsed = JSON.parse(envelopeLine!) as { state: string; prompt: string }
    expect(parsed.state).toBe("error")
    expect(stderr).toMatch(/gtd: [^\n]*\n$/)
    expect(stderr).not.toContain("gtd: gtd:")
  })

  it("a runtime error under --json writes the envelope on stderr, leaving stdout byte-empty", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "next", "--json"], io))
    const { stdout, stderr } = captured()
    expect(stdout).toBe("")
    const [envelopeLine] = stderr.split("\n")
    const parsed = JSON.parse(envelopeLine!) as { state: string; prompt: string }
    expect(parsed.state).toBe("error")
  })
})

describe("runCli — stdout stays byte-empty on every failing surface", () => {
  // A handler may write through `out` and still fail — `bufferedArtifactOut`'s
  // buffer is simply never flushed, so `io.stdout` is never called at all.

  it("usage error: stdout is byte-empty, the message lands on stderr", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "bogus"], io))
    const { stdout, stderr } = captured()
    expect(stdout).toBe("")
    expect(stderr).toContain("unknown command")
  })

  it("refusal: a real command's own typed Effect.fail leaves stdout byte-empty", async () => {
    const repo = new InMemRepo() // no commits yet — assertRepositoryHasCommits refuses
    const { io, captured } = capturingIo(() => testLayers(repo))
    await Effect.runPromise(runCli(["node", "gtd.js", "next"], io))
    const { stdout, stderr, exitCode } = captured()
    expect(exitCode).toBe(EXIT_RUNTIME_ERROR)
    expect(stdout).toBe("")
    expect(stderr).toContain("gtd: the repository has no commits yet")
  })

  it("runtime error: a handler's own Effect.fail (not the shared repo-root/commit guard) leaves stdout byte-empty", async () => {
    // `gtd check` needs neither a repository nor a commit — this exercises a
    // plain `FileSystem`-only failure inside the handler itself, distinct
    // from the "refusal" test above (which fails in the shared guard).
    const repo = new InMemRepo()
    repo.writeFile(".gtd/TODO.md", "## Open Questions\n\n###\n\nno question text.\n")
    const { io, captured } = capturingIo(() => testLayers(repo))
    await Effect.runPromise(runCli(["node", "gtd.js", "check", "qa", ".gtd/TODO.md"], io))
    const { stdout, stderr, exitCode } = captured()
    expect(exitCode).toBe(EXIT_RUNTIME_ERROR)
    expect(stdout).toBe("")
    expect(stderr).toContain("has no question text")
  })

  it("defect: an unchecked throw building the layer still leaves stdout byte-empty", async () => {
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "next"], io))
    const { stdout, stderr, exitCode } = captured()
    expect(exitCode).toBe(EXIT_RUNTIME_ERROR)
    expect(stdout).toBe("")
    expect(stderr).toContain("layers() must not be called")
  })

  it("unit: a failing command's collected buffer is never handed to io.stdout", async () => {
    // Same failure as the "runtime error" case above, observed directly
    // through `io.stdout` (a raw call-recording array) — a failing run must
    // produce zero calls, not merely an empty joined string.
    const repo = new InMemRepo()
    repo.writeFile("README.md", "x\n")
    repo.seedCommit("chore: init gtd workflow")
    repo.writeFile(".gtd/TODO.md", "## Open Questions\n\n###\n\nno question text.\n")
    const stdoutCalls: string[] = []
    const io: CliIo = {
      stdout: (chunk) => stdoutCalls.push(chunk),
      stderr: () => {},
      exit: () => {},
      layers: () => testLayers(repo),
    }
    await Effect.runPromise(runCli(["node", "gtd.js", "check", "qa", ".gtd/TODO.md"], io))
    expect(stdoutCalls).toEqual([])
  })
})

describe("nodeCliIo", () => {
  const io = nodeCliIo(Layer.succeed(ToolCommands, {} as ToolCommands["Service"]))

  it("exposes stdout/stderr/exit/layers", () => {
    expect(typeof io.stdout).toBe("function")
    expect(typeof io.stderr).toBe("function")
    expect(typeof io.exit).toBe("function")
    expect(typeof io.layers).toBe("function")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("stdout writes through process.stdout.write with a completion callback, even when the write is queued (backpressure)", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((_chunk: unknown, cb?: unknown) => {
        if (typeof cb === "function") cb()
        return false // the queued-data case
      })
    io.stdout("a large chunk")
    expect(write).toHaveBeenCalledTimes(1)
    const [chunk, cb] = write.mock.calls[0]!
    expect(chunk).toBe("a large chunk")
    expect(typeof cb).toBe("function")
  })

  it("exit sets process.exitCode rather than calling process.exit — an undrained stdout.write must not be torn down", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit must never be called on the normal path")
    })
    const before = process.exitCode
    try {
      io.exit(10)
      expect(process.exitCode).toBe(10)
      expect(exit).not.toHaveBeenCalled()
    } finally {
      process.exitCode = before
    }
  })
})

describe("normalizeTrailingNewline", () => {
  it("leaves a byte-empty artifact byte-empty", () => {
    expect(normalizeTrailingNewline("")).toBe("")
  })

  it("appends exactly one trailing newline to a non-empty artifact with none", () => {
    expect(normalizeTrailingNewline("no newline yet")).toBe("no newline yet\n")
  })

  it("collapses several trailing newlines to exactly one", () => {
    expect(normalizeTrailingNewline("content\n\n\n\n")).toBe("content\n")
  })

  it("leaves an artifact already ending in exactly one newline unchanged", () => {
    expect(normalizeTrailingNewline("content\n")).toBe("content\n")
  })
})

describe("runCli — flush normalizes the artifact's trailing newline", () => {
  it("a plain-text write command's script (no trailing newline) reaches io.stdout with exactly one", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("gtd.config.ts", IDLE_CONFIG)
    repo.seedCommit("chore: initial commit")
    const { io, captured } = capturingIo(() => testLayers(repo))
    await Effect.runPromise(runCli(["node", "gtd.js", "land"], io))
    const { stdout } = captured()
    expect(stdout.length).toBeGreaterThan(0)
    expect(stdout.endsWith("\n")).toBe(true)
    expect(stdout.endsWith("\n\n")).toBe(false)
  })
})

// Re-exported so downstream test files can build Command values without
// importing from Program.js — keeps the type import exercised here too.
export type { Command }
