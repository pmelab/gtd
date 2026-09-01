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
  type CommandRequirements,
} from "./Cli.js"
import { EXIT_CODES, EXIT_RUNTIME_ERROR, EXIT_USAGE_ERROR } from "./ExitCodes.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { testLayers } from "./testing/Layers.js"
import { renderInitConfig } from "./workflows/templates.js"

const FLAG_NAMES = [
  "--json",
  "--port",
  "--no-open",
  "--cost",
  "--model",
  "--entry",
  "--var",
  "--open-questions",
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
          const plan = parseArgv(argv)
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
      message: "gtd: unknown option '--jsn' — see `gtd --help`",
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
  it("--cost on the removed `status` token still reports the flag's own scope error, not the removal message", () => {
    const plan = parseArgv(["node", "gtd.js", "status", "--cost=5"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd land`")
  })

  it("--json is in scope for next and land — every other command usage-errors on it", () => {
    for (const args of [
      ["next", "--json"],
      ["land", "--json"],
    ]) {
      const ok = parseArgv(["node", "gtd.js", ...args])
      expect(ok.kind).toBe("command")
      if (ok.kind === "command") expect(ok.json).toEqual({ kind: "document" })
    }

    for (const args of [
      ["lsp", "--json"],
      ["validate", "--json"],
      ["check", "qa", "TODO.md", "--json"],
      ["init", "--json"],
      ["visualize", "--json"],
      ["install", "--json"],
      ["abandon", "--json"],
      ["restore", "--json"],
      ["status", "--json"],
      ["--entry", "some-state", "--json"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") {
        expect(plan.message).toContain("only valid for `gtd next`/`gtd land`")
        expect(plan.message).toContain("gtd install")
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
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd visualize`")
  })

  it("--var without --entry is rejected", () => {
    const plan = parseArgv(["node", "gtd.js", "land", "--var", "a=1"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toBe("gtd: --var requires --entry")
  })

  it("--cost with --entry is rejected (landing and entering are different verbs)", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry", "foo", "--cost=5"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd land`")
  })

  it("--model with --entry is rejected the same way", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry", "foo", "--model=gpt"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd land`")
  })

  it("--entry on `gtd land` (or any other command) is rejected — landing and entering are different verbs", () => {
    for (const args of [
      ["status", "--entry", "e"],
      ["land", "--entry", "e"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("usage")
      if (plan.kind === "usage") {
        expect(plan.message).toBe(
          "gtd: --entry is only valid with no other command — use the bare `gtd --entry <state>` " +
            "form; landing and entering are different verbs",
        )
      }
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
      ["status", "--dispatch"],
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

  it("bare gtd's missing-command message (no --json) points at gtd install, not a bundled loop", () => {
    const plan = parseArgv(["node", "gtd.js"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("missing command")
      expect(plan.message).toContain("gtd decides and prints")
      expect(plan.message).toContain("gtd install")
      expect(plan.message).toContain("A complete minimal driver")
    }
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

describe("parseArgv — entry/var flag details (formerly parseEntryFlags/takeFlagValues)", () => {
  it("accepts --entry=<state> (= form)", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry=side-entry"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({
        kind: "entry",
        actor: "human",
        state: "side-entry",
        vars: {},
        label: "gtd --entry side-entry",
      })
    }
  })

  it("a bare --entry with no value is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--entry requires a value")
  })

  it("a second --entry occurrence is a usage error (not last-wins)", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry", "a", "--entry", "b"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--entry may be given at most once")
  })

  it("a duplicate --var NAME is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry", "e", "--var", "a=1", "--var", "a=2"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("--var a")
  })

  it("a multiline --var value is a usage error", () => {
    const plan = parseArgv(["node", "gtd.js", "--entry", "e", "--var", "a=1\n2"])
    expect(plan.kind).toBe("usage")
  })
})

describe("parseArgv — the --entry selector", () => {
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
      expect(plan.json).toEqual({ kind: "off" })
    }
  })

  it("--json is out of scope for check — next/land are the only structured surfaces", () => {
    const plan = parseArgv(["node", "gtd.js", "check", "review", "REVIEW.md", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd next`")
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
      ["--entry", "some-state", "--verbose"],
      ["visualize", "--verbose"],
    ]) {
      const plan = parseArgv(["node", "gtd.js", ...args])
      expect(plan.kind).toBe("command")
      if (plan.kind === "command") expect(plan.verbose).toBe(true)
    }
  })
})

describe("parseArgv — removed subcommands", () => {
  it("`gtd step <actor>` points at the land replacement", () => {
    const plan = parseArgv(["node", "gtd.js", "step", "human"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("gtd step <actor>")
      expect(plan.message).toContain("gone")
      expect(plan.message).toContain("gtd land")
      expect(plan.message).not.toContain("unknown command")
    }
  })

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

  it("`gtd loop` points at gtd install — not the old bash loop", () => {
    const plan = parseArgv(["node", "gtd.js", "loop"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("gtd loop")
      expect(plan.message).toContain("gone")
      expect(plan.message).toContain("gtd install")
      expect(plan.message).toContain("A complete minimal driver")
      expect(plan.message).not.toContain("unknown command")
    }
  })

  it("`gtd status` points at the `gtd next` replacement — no alias, not even for one major", () => {
    const plan = parseArgv(["node", "gtd.js", "status"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") {
      expect(plan.message).toContain("gtd status")
      expect(plan.message).toContain("gone")
      expect(plan.message).toContain("gtd next")
      expect(plan.message).not.toContain("unknown command")
    }
  })

  it("`gtd status --json` is also usage-error territory — --json's own scope no longer covers it", () => {
    const plan = parseArgv(["node", "gtd.js", "status", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd next`")
  })
})

describe("parseArgv — gtd install", () => {
  it("parses to an install command", () => {
    const plan = parseArgv(["node", "gtd.js", "install"])
    expect(plan.kind).toBe("command")
    if (plan.kind === "command") {
      expect(plan.command).toEqual({ kind: "install" })
      expect(plan.json).toEqual({ kind: "off" })
    }
  })

  it("--json is out of scope for install — the briefing is plain text only", () => {
    const plan = parseArgv(["node", "gtd.js", "install", "--json"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd next`")
  })

  it("gtd install extra is a usage error (install takes no argument)", () => {
    const plan = parseArgv(["node", "gtd.js", "install", "extra"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("too many arguments")
  })

  it("a scoped-out flag (e.g. --port) is rejected on install", () => {
    const plan = parseArgv(["node", "gtd.js", "install", "--port=3"])
    expect(plan.kind).toBe("usage")
    if (plan.kind === "usage") expect(plan.message).toContain("only valid for `gtd visualize`")
  })
})

describe("standaloneKinds / needsOf", () => {
  it("pins the six standalone kinds", () => {
    expect(standaloneKinds()).toEqual(["lsp", "init", "visualize", "check", "uncheck", "install"])
  })

  it("needsOf matches none/fs/config for the standalone kinds and state for everything else", () => {
    expect(needsOf("lsp")).toBe("none")
    expect(needsOf("check")).toBe("fs")
    expect(needsOf("uncheck")).toBe("fs")
    expect(needsOf("init")).toBe("fs")
    expect(needsOf("visualize")).toBe("config")
    expect(needsOf("install")).toBe("none")
    for (const kind of ["land", "entry", "abandon", "restore", "next", "validate"] as const) {
      expect(needsOf(kind)).toBe("state")
    }
  })
})

describe("renderHelp", () => {
  it("mentions every command and flag, and no removed surface", () => {
    const help = renderHelp()
    expect(help).toContain("Usage")
    expect(help).toContain("init ")
    expect(help).toContain("land")
    expect(help).toContain("--entry <state>")
    expect(help).toContain("--var")
    expect(help).toContain("abandon")
    expect(help).toContain("restore")
    expect(help).toContain("next")
    expect(help).toContain("validate")
    expect(help).toContain("lsp")
    expect(help).toContain("visualize")
    expect(help).toContain("check <mode> <file>")
    expect(help).toContain("install")
    expect(help).toContain("base ")
    expect(help).toContain("version")
    expect(help).toContain("help")
    expect(help).toContain("--json")
    expect(help).toContain("--port")
    expect(help).toContain("--no-open")
    expect(help).toContain("--cost")
    expect(help).toContain("--model")
    expect(help).toContain("--open-questions")
    expect(help).toContain("--verbose")
    expect(help).toContain("--version, -V")
    expect(help).toContain("--help, -h")
    expect(help).not.toContain("review <commitish>")
    expect(help).not.toContain("format <file>")
    expect(help).not.toContain("--debug")
    expect(help).not.toContain("bin/gtd")
    expect(help).not.toContain("(no command), loop")
    expect(help).not.toContain("--dispatch")
    expect(help).not.toContain("--if-resting")
    expect(help).not.toContain("step <actor>")
    expect(help).not.toMatch(/^ {2}status\b/m)
    expect(help).toMatch(/\n$/)
  })

  it("every flag row's name appears in the Options: block and vice versa", () => {
    const help = renderHelp()
    const optionsBlock = help.slice(help.indexOf("Options:"))
    for (const name of FLAG_NAMES) expect(optionsBlock).toContain(name)
  })

  it("the docs/cli.md Commands fenced block equals renderHelp()", () => {
    const doc = readFileSync(resolve(import.meta.dirname, "../docs/cli.md"), "utf8")
    const match = doc.match(/## Commands\n\n```\n([\s\S]*?)\n```/)
    expect(match).not.toBeNull()
    expect(match![1] + "\n").toBe(renderHelp())
  })

  it("docs/cli.md's Exit codes table, pinned beside the rendered help output, is exactly ExitCodes.ts's closed set", () => {
    const doc = readFileSync(resolve(import.meta.dirname, "../docs/cli.md"), "utf8")
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

  it("a command failure that is NOT a usage error still exits EXIT_RUNTIME_ERROR", async () => {
    // Unlike a usage error (never builds a layer), a resolved command
    // always does, so this exercises `report`'s own exit code.
    const { io, captured } = capturingIo(throwingLayers)
    await Effect.runPromise(runCli(["node", "gtd.js", "next"], io))
    expect(captured().exitCode).toBe(EXIT_RUNTIME_ERROR)
  })

  it("an unknown --json=<path> selector exits EXIT_USAGE_ERROR, not EXIT_RUNTIME_ERROR — program.ts's SelectorUsageError mapped by report()", async () => {
    const repo = new InMemRepo()
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd: init")
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
    expect(stderr).toContain("gtd requires a repository with at least one commit")
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
    repo.writeFile(".gtdrc.json", renderInitConfig())
    repo.commitAllWithPrefix("chore: init gtd workflow")
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
  it("exposes stdout/stderr/exit/layers", () => {
    expect(typeof nodeCliIo.stdout).toBe("function")
    expect(typeof nodeCliIo.stderr).toBe("function")
    expect(typeof nodeCliIo.exit).toBe("function")
    expect(typeof nodeCliIo.layers).toBe("function")
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
    nodeCliIo.stdout("a large chunk")
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
      nodeCliIo.exit(10)
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
    repo.commitAllWithPrefix("chore: initial commit")
    const { io, captured } = capturingIo(() => testLayers(repo))
    await Effect.runPromise(runCli(["node", "gtd.js", "land"], io))
    const { stdout } = captured()
    expect(stdout.length).toBeGreaterThan(0)
    expect(stdout.endsWith("\n")).toBe(true)
    expect(stdout.endsWith("\n\n")).toBe(false)
  })
})

// Re-exported so downstream test files can build Command values without
// importing from program.js — keeps the type import exercised here too.
export type { Command }
