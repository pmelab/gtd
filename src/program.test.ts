/**
 * Unit tests for src/program.ts — short-circuit flags (--version / --help),
 * bare/unknown-command usage errors, `format` arg validation, and the JSON
 * error envelope shape. Full behavioral coverage of `step <actor>` / `next` /
 * `run` / `status` against a real repo lives in the feature files owned by
 * other tasks in this package; this file sticks to what it can test without
 * a real repo, as today.
 */

import { NodeContext } from "@effect/platform-node"
import { Effect, Exit, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { GitService } from "./Git.js"
import { WorktreeReader } from "./WorktreeReader.js"
import {
  compileTemplate,
  defaultMachineTree,
  defaultStateScopes,
  renderInitConfig,
} from "./workflows/templates.js"
import {
  classifyAnswerCompleteness,
  classifyFeedbackProgress,
  classifyReviewSignoff,
  cliErrorLine,
  computeNextMatch,
  makeProgram,
  parseEntryFlags,
  takeFlagValues,
} from "./program.js"
import type { OnEdge, PendingChange } from "./PatternMachine.js"
import { InMemRepo } from "../tests/integration/support/inmem/Repo.js"
import { inMemoryLayers } from "../tests/integration/support/inmem/layers.js"

// GitService whose every method fails — proves the flag handler never calls git.
const failingGitLayer = Layer.succeed(GitService, {
  hasCommits: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  lastCommitSubject: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
  lastCommitMessage: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
  resolveRef: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  readFileAtRef: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  readRefOption: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  isAncestor: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  topLevel: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  commitHistory: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  changedPathsSince: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
  changedPaths: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  commitAllWithPrefix: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
  softResetTo: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  commitAsIs: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  discardPending: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
  updateRef: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  deleteRef: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  mixedResetTo: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  hardResetTo: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  restoreStagedFrom: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
})

// Minimal stub ConfigService — satisfies the type but never loaded for flags.
const stubConfigLayer = Layer.succeed(ConfigService, {
  load: Effect.succeed({
    workflow: compileTemplate().definition,
    workflowVars: {},
    rcVars: {},
    machineTree: defaultMachineTree,
    stateScopes: defaultStateScopes,
  }),
})

// Minimal stub WorktreeReader — never called for flags.
const stubWorktreeReaderLayer = Layer.succeed(WorktreeReader, {
  read: () => {
    throw new Error("WorktreeReader must not be called for --version/--help")
  },
})

const testLayers = failingGitLayer.pipe(
  Layer.provideMerge(NodeContext.layer),
  Layer.provideMerge(stubConfigLayer),
  Layer.provideMerge(stubWorktreeReaderLayer),
  Layer.provideMerge(Cwd.layer("")),
  Layer.provideMerge(EnvVars.layer({})),
)

async function runFlag(
  ...flags: string[]
): Promise<{ output: string; exit: Exit.Exit<void, Error> }> {
  let output = ""
  const write = (chunk: string) => {
    output += chunk
  }
  const argv = ["node", "gtd.js", ...flags]
  const program = makeProgram({ argv, write }).pipe(Effect.provide(testLayers))
  const exit = await Effect.runPromiseExit(program)
  return { output, exit }
}

describe("--version short-circuit", () => {
  it("prints version and succeeds without touching git", async () => {
    const { output, exit } = await runFlag("--version")
    expect(Exit.isSuccess(exit)).toBe(true)
    // Should contain a semver-like version string
    expect(output).toMatch(/\d+\.\d+\.\d+/)
    expect(output).toMatch(/\n$/)
  })

  it("-v alias works the same as --version", async () => {
    const { output: versionOutput } = await runFlag("--version")
    const { output: vOutput, exit } = await runFlag("-v")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(vOutput).toBe(versionOutput)
  })

  it("the `version` subcommand works the same as --version", async () => {
    const { output: versionOutput } = await runFlag("--version")
    const { output: subOutput, exit } = await runFlag("version")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(subOutput).toBe(versionOutput)
  })
})

describe("--help short-circuit", () => {
  it("prints usage block and succeeds without touching git", async () => {
    const { output, exit } = await runFlag("--help")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("Usage")
    expect(output).toContain("init ")
    expect(output).toContain("step")
    expect(output).toContain("step <actor>")
    expect(output).toContain("next")
    expect(output).toContain("status")
    expect(output).toContain("validate")
    expect(output).toContain("lsp")
    expect(output).toMatch(/\n$/)
  })

  it("help output mentions global flags", async () => {
    const { output } = await runFlag("--help")
    expect(output).toContain("--json")
    expect(output).toContain("--version")
    expect(output).toContain("--help")
  })

  it("help output does not advertise removed flags", async () => {
    const { output } = await runFlag("--help")
    expect(output).not.toContain("--verbose")
    expect(output).not.toContain("--debug")
  })

  it("-h alias works the same as --help", async () => {
    const { output: helpOutput } = await runFlag("--help")
    const { output: hOutput, exit } = await runFlag("-h")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(hOutput).toBe(helpOutput)
  })

  it("the `help` subcommand works the same as --help", async () => {
    const { output: helpOutput } = await runFlag("--help")
    const { output: subOutput, exit } = await runFlag("help")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(subOutput).toBe(helpOutput)
  })

  it("help output lists the version subcommand", async () => {
    const { output } = await runFlag("--help")
    expect(output).toContain("version")
  })
})

describe("flag orthogonality", () => {
  it("--version with --json still prints version (flags are independent)", async () => {
    const { output, exit } = await runFlag("--version", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toMatch(/\d+\.\d+\.\d+/)
  })

  it("--help with extra args still prints help (help wins)", async () => {
    const { output, exit } = await runFlag("--help", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("Usage")
  })
})

describe("unknown options", () => {
  it("an unknown long option is a usage error, not silently ignored", async () => {
    const { exit } = await runFlag("status", "--bogus")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("unknown option '--bogus'")
    }
  })

  it("a --json typo is rejected instead of degrading to plain mode", async () => {
    const { exit } = await runFlag("status", "--jsn")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("unknown option '--jsn'")
    }
  })
})

describe("bare gtd (no subcommand)", () => {
  it("prints usage and exits non-zero without touching git", async () => {
    const { output, exit } = await runFlag()
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(output).toContain("Usage")
  })

  it("under --json, exits non-zero without printing the full usage block", async () => {
    const { output, exit } = await runFlag("--json")
    expect(Exit.isSuccess(exit)).toBe(false)
    const parsed = JSON.parse(output) as { state: string; prompt: string }
    expect(parsed.state).toBe("error")
    expect(typeof parsed.prompt).toBe("string")
  })
})

describe("unknown command", () => {
  it("fails without touching git", async () => {
    const { exit } = await runFlag("bogus")
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("under --json, the error envelope names the unknown subcommand", async () => {
    const { output, exit } = await runFlag("bogus", "--json")
    expect(Exit.isSuccess(exit)).toBe(false)
    const parsed = JSON.parse(output) as { state: string; prompt: string }
    expect(parsed.state).toBe("error")
    expect(parsed.prompt).toContain("bogus")
  })
})

describe("the retired `gtd format` subcommand", () => {
  // gtd ships no formatter any more: a steering-file mode declares its own
  // `format:` command (see src/SteeringMode.ts). `format` is therefore just an
  // unknown subcommand, and must be rejected like any other typo rather than
  // lingering as an undocumented alias.
  it("is rejected as an unknown subcommand", async () => {
    const { output, exit } = await runFlag("format", "some.md")
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(output).not.toContain("formatted")
  })

  it("is absent from the help text", async () => {
    const { output } = await runFlag("--help")
    expect(output).not.toContain("format <file>")
  })
})

describe("the retired `gtd review`/`gtd fix` subcommands", () => {
  // `gtd review <commitish>`/`gtd fix` are gone with NO fallback — replaced by
  // the generic `--entry` mechanism (see `REMOVED_SUBCOMMANDS` in
  // src/program.ts): any declared, non-commit state can be entered directly,
  // so gtd no longer needs to know these two workflow-specific state names by
  // a dedicated command. Each must fail with a message pointing at the
  // replacement — not linger as a subcommand, and not degrade to the generic
  // "unknown command" error either. Neither touches git (mirrors the "unknown
  // command" block above's `failingGitLayer`-backed `runFlag`) since the
  // rejection happens in `requireKnownSubcommand`, before any GitService call.

  it("`gtd review <commitish>` points at the --entry replacement, not the generic unknown-command error", async () => {
    const { exit } = await runFlag("review", "abc123")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).toContain("--entry")
      expect(message).toContain("review-gate.check")
      expect(message).not.toContain("unknown command")
    }
  })

  it("`gtd fix` points at the --entry replacement, not the generic unknown-command error", async () => {
    const { exit } = await runFlag("fix")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).toContain("--entry")
      expect(message).toContain("fix-precheck")
      expect(message).not.toContain("unknown command")
    }
  })

  it("is absent from --help — the old `review <commitish>`/bare `fix` command blocks are gone", async () => {
    const { output } = await runFlag("--help")
    expect(output).not.toContain("review <commitish>")
  })

  it("--help documents --entry/--var instead", async () => {
    const { output } = await runFlag("--help")
    expect(output).toContain("--entry")
    expect(output).toContain("--var")
  })
})

describe("positional extraction excludes --entry/--var flag values", () => {
  // The highest-risk part of this change: `commandArgs`/the top-level
  // `positional` lookup in makeProgram must SKIP the index an `--entry`/
  // `--var` value occupies (it carries no `--` prefix of its own), or it's
  // misread as a stray extra positional argument. Uses the flag-only
  // `failingGitLayer`-backed `runFlag` — these only need to prove parsing
  // succeeds (reaches the GitService-touching repo-root guard) rather than
  // failing on "too many arguments"/"unknown command".

  it("`gtd step human --entry foo` parses the actor as exactly 'human'", async () => {
    const { exit } = await runFlag("step", "human", "--entry", "foo")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).not.toContain("too many arguments")
      expect(message).toContain("GitService must not be called")
    }
  })

  it("`gtd step human --entry=foo` (= form) parses the same way", async () => {
    const { exit } = await runFlag("step", "human", "--entry=foo")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).not.toContain("too many arguments")
      expect(message).toContain("GitService must not be called")
    }
  })

  it("the top-level positional lookup also skips --entry's value: `gtd --entry foo` is the bare short form, not an unknown 'foo' command", async () => {
    const { exit } = await runFlag("--entry", "foo")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).not.toContain("unknown command")
      expect(message).not.toContain("missing command")
      expect(message).toContain("GitService must not be called")
    }
  })
})

describe("takeFlagValues", () => {
  it("collects a `--flag=value` occurrence and its own index", () => {
    const { values, consumed } = takeFlagValues(["node", "gtd.js", "--entry=foo"], "--entry")
    expect(values).toEqual(["foo"])
    expect(consumed).toEqual(new Set([2]))
  })

  it("collects a `--flag value` (space-separated) occurrence and BOTH its indices", () => {
    const { values, consumed } = takeFlagValues(
      ["node", "gtd.js", "step", "human", "--entry", "foo"],
      "--entry",
    )
    expect(values).toEqual(["foo"])
    expect(consumed).toEqual(new Set([4, 5]))
  })

  it("collects every occurrence of a repeatable flag, mixing both forms", () => {
    const { values, consumed } = takeFlagValues(
      ["node", "gtd.js", "--var", "a=1", "--var=b=2"],
      "--var",
    )
    expect(values).toEqual(["a=1", "b=2"])
    expect(consumed).toEqual(new Set([2, 3, 4]))
  })

  it("a trailing bare flag (no following value) still consumes its own index", () => {
    const { values, consumed } = takeFlagValues(["node", "gtd.js", "--entry"], "--entry")
    expect(values).toEqual([""])
    expect(consumed).toEqual(new Set([2]))
  })

  it("ignores a different flag entirely", () => {
    const { values, consumed } = takeFlagValues(["node", "gtd.js", "--cost=5"], "--entry")
    expect(values).toEqual([])
    expect(consumed.size).toBe(0)
  })
})

describe("parseEntryFlags", () => {
  const run = (argv: readonly string[], positional: string | undefined) =>
    Effect.runSyncExit(parseEntryFlags(argv, positional))

  it("accepts `--entry=<state>`", () => {
    const exit = run(["node", "gtd.js", "step", "human", "--entry=side-entry"], "step")
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toEqual({ entry: "side-entry", vars: {} })
  })

  it("accepts `--entry <state>` (space-separated)", () => {
    const exit = run(["node", "gtd.js", "step", "human", "--entry", "side-entry"], "step")
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toEqual({ entry: "side-entry", vars: {} })
  })

  it("a bare --entry with no value is a usage error", () => {
    const exit = run(["node", "gtd.js", "step", "human", "--entry"], "step")
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("--entry requires a value")
  })

  it("a second --entry occurrence is a usage error (not last-wins)", () => {
    const exit = run(["node", "gtd.js", "--entry", "a", "--entry", "b"], undefined)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("--entry")
  })

  it("a duplicate --var NAME is a usage error", () => {
    const exit = run(
      ["node", "gtd.js", "step", "human", "--entry", "e", "--var", "a=1", "--var", "a=2"],
      "step",
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("--var a")
  })

  it("--var present with no --entry is a usage error", () => {
    const exit = run(["node", "gtd.js", "step", "human", "--var", "a=1"], "step")
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("--var requires --entry")
  })

  it("a --var value with no '=' is a usage error", () => {
    const exit = run(["node", "gtd.js", "step", "human", "--entry", "e", "--var", "bogus"], "step")
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("a multiline --var value is a usage error", () => {
    const exit = run(["node", "gtd.js", "step", "human", "--entry", "e", "--var", "a=1\n2"], "step")
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("--entry is valid with no positional at all (the subcommand-less short form)", () => {
    const exit = run(["node", "gtd.js", "--entry", "e"], undefined)
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("--entry on a command other than step/bare is a usage error", () => {
    const exit = run(["node", "gtd.js", "status", "--entry", "e"], "status")
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("--cost/--model combined with --entry", () => {
  it("is a usage error naming the conflict", async () => {
    const { exit } = await runFlag("step", "human", "--entry", "foo", "--cost=5")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).toContain("--entry")
      expect(message).toContain("--cost")
    }
  })

  it("--model combined with --entry is likewise a usage error", async () => {
    const { exit } = await runFlag("step", "human", "--entry", "foo", "--cost=5", "--model=gpt")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("--entry")
    }
  })
})

describe("gtd step <actor> --entry <state> — a custom workflow declaring `entry: true`", () => {
  // The generic entry mechanism that replaced `gtd review`/`gtd fix`: any
  // declared, non-commit state may be entered directly via `--entry`, not
  // just one flagged `entry: true` (that narrower set only seeds the
  // workflow's OWN `entries.manual` reachability roots — see
  // `PatternMachine.enterableStates`'s doc comment). Needs a real (in-memory)
  // repo, like the old review/fix guard tests it replaces — mirrors the
  // InMemRepo + inMemoryLayers precedent in src/Git.test.ts.

  const CUSTOM_WORKFLOW = [
    "workflow:",
    "  vars:",
    "    greeting: hello",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: hi",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: go",
    "          on:",
    '            "* **": idle',
    "        side-entry:",
    "          entry: true",
    "          actor: human",
    "          message: entering",
    "          on:",
    '            "* **": working',
    "",
  ].join("\n")

  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", CUSTOM_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  const runEntry = async (
    repo: InMemRepo,
    ...args: string[]
  ): Promise<{ output: string; exit: Exit.Exit<void, Error> }> => {
    let output = ""
    const write = (chunk: string) => {
      output += chunk
    }
    const argv = ["node", "gtd.js", ...args]
    const exit = await Effect.runPromiseExit(
      makeProgram({ argv, write }).pipe(Effect.provide(inMemoryLayers(repo))),
    )
    return { output, exit }
  }

  it("the happy path writes one turn commit resting at the entered state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { output, exit } = await runEntry(repo, "step", "human", "--entry", "side-entry")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("committed: gtd(human): side-entry")
    expect(repo.commitHistory()).toHaveLength(before + 1)
    expect(repo.lastCommitSubject()).toBe("gtd(human): side-entry")
  })

  it("--entry naming an undeclared state refuses, listing every enterable state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exit } = await runEntry(repo, "step", "human", "--entry", "bogus-state")
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).toContain("enterable states")
      expect(message).toContain("idle")
      expect(message).toContain("side-entry")
      expect(message).toContain("working")
    }
  })

  it("a process already underway (not resting at the initial state) refuses", async () => {
    const repo = seededRepo()
    repo.writeFile(".gtd/TODO.md", "sketch\n")
    repo.commitAllWithPrefix("gtd(agent): working")
    const before = repo.commitHistory().length
    const { exit } = await runEntry(repo, "step", "human", "--entry", "side-entry")
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("already underway")
    }
  })

  it("an undeclared --var name refuses, listing the declared names", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exit } = await runEntry(
      repo,
      "step",
      "human",
      "--entry",
      "side-entry",
      "--var",
      "bogus=1",
    )
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).toContain("bogus")
      expect(message).toContain("greeting")
    }
  })

  it("a declared --var override is recorded as a Gtd-Var trailer on the entry commit", async () => {
    const repo = seededRepo()
    const { exit } = await runEntry(
      repo,
      "step",
      "human",
      "--entry",
      "side-entry",
      "--var",
      "greeting=world",
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    const message = repo.commitHistory().at(-1)!.message
    expect(message).toContain("Gtd-Var: greeting=world")
  })

  it("a dirty working tree is CAPTURED, not refused (commitAllWithPrefix, unlike the old commitAsIs-based gtd review/gtd fix)", async () => {
    const repo = seededRepo()
    repo.writeFile("scratch.txt", "uncommitted\n")
    const before = repo.commitHistory().length
    const { exit } = await runEntry(repo, "step", "human", "--entry", "side-entry")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(repo.commitHistory()).toHaveLength(before + 1)
  })

  it("the subcommand-less short form `gtd --entry <state>` dispatches as human", async () => {
    const repo = seededRepo()
    const { output, exit } = await runEntry(repo, "--entry", "side-entry")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("committed: gtd(human): side-entry")
    expect(repo.lastCommitSubject()).toBe("gtd(human): side-entry")
  })
})

describe("gtd step <actor> --entry <state> — the bundled unified template", () => {
  // Full downstream coverage (the review checkout window, feedback laps, the
  // fix-precheck green-baseline gate) lives in entry.feature/
  // fix-entry.feature; these pin only the entry commit itself — the same
  // happy-path shape the old `gtd review`/`gtd fix` tests pinned.

  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.json", renderInitConfig())
    repo.commitAllWithPrefix("chore: init gtd workflow")
    return repo
  }

  const runEntry = async (
    repo: InMemRepo,
    ...args: string[]
  ): Promise<{ output: string; exit: Exit.Exit<void, Error> }> => {
    let output = ""
    const write = (chunk: string) => {
      output += chunk
    }
    const argv = ["node", "gtd.js", ...args]
    const exit = await Effect.runPromiseExit(
      makeProgram({ argv, write }).pipe(Effect.provide(inMemoryLayers(repo))),
    )
    return { output, exit }
  }

  it("--entry review-gate.check --var reviewBase=<base> starts a review process anchored to that base", async () => {
    // review-gate.check declares a template-form `reviewBase:` (fixing the
    // whole process's diff base) — entering it requires a `--var
    // reviewBase=<commitish>` that resolves to an ancestor of HEAD distinct
    // from HEAD; the blank-default/no-ancestor refusals are covered in
    // entry.feature.
    const repo = seededRepo()
    const base = repo.commitHistory().at(-1)!.hash
    repo.writeFile("scratch.txt", "more work\n")
    repo.commitAllWithPrefix("chore: more work")
    const before = repo.commitHistory().length
    const { output, exit } = await runEntry(
      repo,
      "step",
      "human",
      "--entry",
      "review-gate.check",
      "--var",
      `reviewBase=${base}`,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("committed: gtd(human): review-gate.check")
    expect(repo.commitHistory()).toHaveLength(before + 1)
    expect(repo.lastCommitSubject()).toBe("gtd(human): review-gate.check")
  })

  it("--entry fix-precheck starts a fix process at the template's own fix-entry state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { output, exit } = await runEntry(repo, "step", "human", "--entry", "fix-precheck")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("committed: gtd(human): fix-precheck")
    expect(repo.commitHistory()).toHaveLength(before + 1)
    expect(repo.lastCommitSubject()).toBe("gtd(human): fix-precheck")
  })
})

describe("gtd next --json / gtd status — label emission", () => {
  // `label:` is a display-only state hint rendered/emitted exactly like
  // `model:`/`memory:` (see src/Edge.ts's renderLabel) — pinned end-to-end in
  // tests/integration/features/driver-json-status.feature for `model:`; these
  // mirror that coverage for `label:` at the unit level using the same
  // InMemRepo + inMemoryLayers precedent as the `gtd review`/`gtd fix` blocks
  // above.

  const workflowWithLabel = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          label: planning",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const workflowWithoutLabel = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const seededRepoAt = (workflowYaml: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.writeFile(".gtdrc.yaml", workflowYaml)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd(human): working")
    return repo
  }

  const runProgram = async (
    repo: InMemRepo,
    ...args: string[]
  ): Promise<{ output: string; exit: Exit.Exit<void, Error> }> => {
    let output = ""
    const write = (chunk: string) => {
      output += chunk
    }
    const argv = ["node", "gtd.js", ...args]
    const exit = await Effect.runPromiseExit(
      makeProgram({ argv, write }).pipe(Effect.provide(inMemoryLayers(repo))),
    )
    return { output, exit }
  }

  it("gtd next --json carries the state's declared label hint", async () => {
    const repo = seededRepoAt(workflowWithLabel)
    const { output, exit } = await runProgram(repo, "next", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.label).toBe("planning")
  })

  it("gtd next --json omits label entirely when the state declares none", async () => {
    const repo = seededRepoAt(workflowWithoutLabel)
    const { output, exit } = await runProgram(repo, "next", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("label")
  })

  it("gtd status shows the state's declared label hint as a plain-text Label: line", async () => {
    const repo = seededRepoAt(workflowWithLabel)
    const { output, exit } = await runProgram(repo, "status")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("State: working")
    expect(output).toContain("Label: planning")
  })

  it("gtd status --json carries the state's declared label hint", async () => {
    const repo = seededRepoAt(workflowWithLabel)
    const { output, exit } = await runProgram(repo, "status", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.label).toBe("planning")
  })

  it("gtd status --json omits label entirely when the state declares none", async () => {
    const repo = seededRepoAt(workflowWithoutLabel)
    const { output, exit } = await runProgram(repo, "status", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("label")
  })
})

describe("gtd next --json / gtd status — memory key emission", () => {
  // `memory` is now COMPUTED (src/Edge.ts's `memoryKeyFor`, package 05/06)
  // from the resting state's scope (`ConfigOperations.stateScopes`) and a
  // commit-anchored hash — there is no authored `memory:` state key at all
  // (package 10 removed it outright) — pinned end-to-end for a realistic
  // nested-scope, repeated-entry trace in
  // tests/integration/features/gtd-loop.feature; these mirror that coverage
  // at the unit level using the same InMemRepo + inMemoryLayers precedent as
  // the label-emission block above. This workflow is a single flat "root"
  // machine (no sub-machine references), so every one of its states' scope
  // is `""` — the root — displayed as `memoryKeyFor`'s `"root"` fallback name.

  const workflowPrompt = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const workflowNonPrompt = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": checking',
    "        checking:",
    "          actor: check",
    "          script: echo hi",
    "          on:",
    '            "C": idle',
    "",
  ].join("\n")

  const seededRepoAt = (workflowYaml: string, lastCommitSubject: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.writeFile(".gtdrc.yaml", workflowYaml)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix(lastCommitSubject)
    return repo
  }

  const runProgram = async (
    repo: InMemRepo,
    ...args: string[]
  ): Promise<{ output: string; exit: Exit.Exit<void, Error> }> => {
    let output = ""
    const write = (chunk: string) => {
      output += chunk
    }
    const argv = ["node", "gtd.js", ...args]
    const exit = await Effect.runPromiseExit(
      makeProgram({ argv, write }).pipe(Effect.provide(inMemoryLayers(repo))),
    )
    return { output, exit }
  }

  const MEMORY_KEY = /^root#[0-9a-f]{7}$/

  it("gtd next --json computes a <scope>#<hash7> memory key for a prompt rest", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { output, exit } = await runProgram(repo, "next", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.memory).toMatch(MEMORY_KEY)
  })

  it("gtd status --json computes the same memory key shape", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { output, exit } = await runProgram(repo, "status", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.memory).toMatch(MEMORY_KEY)
  })

  it("gtd status shows the computed memory key as a plain-text Memory: line", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { output, exit } = await runProgram(repo, "status")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("State: working")
    expect(output).toMatch(/Memory: root#[0-9a-f]{7}/)
  })

  it("gtd next --json omits memory entirely for a non-prompt rest", async () => {
    const repo = seededRepoAt(workflowNonPrompt, "gtd(human): checking")
    const { output, exit } = await runProgram(repo, "next", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("memory")
  })

  it("gtd status --json omits memory entirely for a non-prompt rest", async () => {
    const repo = seededRepoAt(workflowNonPrompt, "gtd(human): checking")
    const { output, exit } = await runProgram(repo, "status", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("memory")
  })
})

describe("gtd next — refuses when HEAD names a state the current workflow no longer declares", () => {
  // A workflow upgrade that renames/removes a state out from under an
  // in-flight process must not look like a fresh, idle repo (silently
  // falling back to the initial state) — it must refuse loudly, pointing at
  // `gtd abandon` as the escape hatch, exactly like the earlier
  // `entry.review`/`entry.fix` removal's courtesy message. Distinct from a
  // state merely missing from `scopes` (package 04's `memoryScopeAt`, a
  // compiler bug) — this is a state absent from `definition.states` entirely.

  const workflow = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: hi",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: go",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const seededRepoAt = (lastCommitSubject: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", workflow)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.commitAllWithPrefix(lastCommitSubject)
    return repo
  }

  const runProgram = async (
    repo: InMemRepo,
    ...args: string[]
  ): Promise<{ output: string; exit: Exit.Exit<void, Error> }> => {
    let output = ""
    const write = (chunk: string) => {
      output += chunk
    }
    const argv = ["node", "gtd.js", ...args]
    const exit = await Effect.runPromiseExit(
      makeProgram({ argv, write }).pipe(Effect.provide(inMemoryLayers(repo))),
    )
    return { output, exit }
  }

  it("refuses, naming the vanished state and pointing at `gtd abandon`", async () => {
    const repo = seededRepoAt("gtd(agent): renamedAway")
    const { exit } = await runProgram(repo, "next")
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause)
      expect(message).toContain("renamedAway")
      expect(message).toContain("gtd abandon")
    }
  })

  it("a state that IS declared, resting normally, is unaffected", async () => {
    const repo = seededRepoAt("gtd(human): working")
    const { exit } = await runProgram(repo, "next")
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("`gtd abandon` itself still works for a renamed-away rest — the escape hatch it points to must not refuse right alongside everything else", async () => {
    const repo = seededRepoAt("gtd(agent): renamedAway")
    const before = repo.commitHistory().length
    const { output, exit } = await runProgram(repo, "abandon")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain('abandoned the process resting at "renamedAway"')
    expect(repo.commitHistory()).toHaveLength(before - 1)
  })
})

describe("gtd step — StepPayload.processTrace still receives plain state names", () => {
  // `ProcessRun.trace` widened to `TraceEntry[]` (state + commit hash, for
  // `memoryKeyFor` — package 05/06), but `PatternMachine.step`'s
  // `StepPayload.processTrace` stays `readonly StateName[]` — retry-entry
  // counting (`applyRetry`) only ever compares state NAMES. If the mapping
  // at the one call site (`stepAsActor`, src/program.ts) ever regressed to
  // pass `TraceEntry` objects through instead, retry redirection would never
  // trigger (an object never `===` a string), so this pins the real
  // end-to-end behavior, not just the type.

  const workflow = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: hi",
    "          on:",
    '            "* **": looping',
    "        looping:",
    "          actor: agent",
    "          prompt: go",
    "          retry:",
    "            max: 1",
    "            otherwise: idle",
    "          on:",
    '            "* **": looping',
    "",
  ].join("\n")

  it("redirects via `retry.otherwise` once the prior-visit count in the trace reaches `max`", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", workflow)
    repo.commitAllWithPrefix("chore: add custom workflow")
    // Simulates having already entered "looping" once this process — the
    // ONE prior visit `retry.max: 1` allows before redirecting.
    repo.commitAllWithPrefix("gtd(human): looping")
    repo.writeFile("src/fix.ts", "export const x = 1\n")

    let output = ""
    const write = (chunk: string) => {
      output += chunk
    }
    const exit = await Effect.runPromiseExit(
      makeProgram({ argv: ["node", "gtd.js", "step", "agent"], write }).pipe(
        Effect.provide(inMemoryLayers(repo)),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): looping → idle")
  })
})

describe("computeNextMatch", () => {
  // Pure unit coverage — mirrors `PatternMachine.step`'s own `matchOn`
  // first-match-wins semantics, but over the WHOLE change list at once
  // (unlike `computeStatusChanges`, which checks each change in isolation).

  it("picks the first matching edge in declaration order, ignoring later matches", () => {
    const onEdges: readonly OnEdge[] = [
      ["* NOTE.md", "first-target", undefined, "First action"],
      ["M **/*.md", "second-target", undefined, "Second action"],
    ]
    const changes: readonly PendingChange[] = [{ status: "M", path: "NOTE.md" }]
    expect(computeNextMatch(onEdges, changes)).toEqual({
      action: "First action",
      pattern: "* NOTE.md",
      target: "first-target",
    })
  })

  it("returns null when no declared pattern matches the pending changes", () => {
    const onEdges: readonly OnEdge[] = [["A NOTE.md", "planned"]]
    const changes: readonly PendingChange[] = [{ status: "M", path: "OTHER.md" }]
    expect(computeNextMatch(onEdges, changes)).toBeNull()
  })

  it("returns null on a clean tree when the state declares no `C` row", () => {
    const onEdges: readonly OnEdge[] = [["A NOTE.md", "planned"]]
    expect(computeNextMatch(onEdges, [])).toBeNull()
  })

  it("matches a declared `C` row against a clean tree", () => {
    const onEdges: readonly OnEdge[] = [["C", "idle", undefined, "Loop"]]
    expect(computeNextMatch(onEdges, [])).toEqual({
      action: "Loop",
      pattern: "C",
      target: "idle",
    })
  })
})

describe("gtd status — Next: preview", () => {
  // Exercises `computeNextMatch` wired through `gtd status`'s plain-text
  // `Next:` line and `--json`'s `next` key, using the same InMemRepo +
  // inMemoryLayers + runProgram precedent as the label-emission block above.
  // The workflow below carries one edge with an `action`, one without (falls
  // back to the raw `pattern`), and leaves a third change unmatched by either.

  const workflowWithNextEdges = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "A PLAN.md":',
    "              to: accepted",
    "              action: Accept plan",
    '            "M REVIEW.md": idle',
    "        accepted:",
    "          actor: human",
    "          message: plan accepted",
    "",
  ].join("\n")

  const seededRepoAt = (workflowYaml: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.writeFile(".gtdrc.yaml", workflowYaml)
    repo.writeFile("REVIEW.md", "old review\n")
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd(human): working")
    return repo
  }

  const runProgram = async (
    repo: InMemRepo,
    ...args: string[]
  ): Promise<{ output: string; exit: Exit.Exit<void, Error> }> => {
    let output = ""
    const write = (chunk: string) => {
      output += chunk
    }
    const argv = ["node", "gtd.js", ...args]
    const exit = await Effect.runPromiseExit(
      makeProgram({ argv, write }).pipe(Effect.provide(inMemoryLayers(repo))),
    )
    return { output, exit }
  }

  it("gtd status shows `Next:` with the action when the matched edge carries one", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("PLAN.md", "the plan\n")
    const { output, exit } = await runProgram(repo, "status")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("Next: Accept plan → accepted")
  })

  it("gtd status --json's `next` carries the action when the matched edge has one", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("PLAN.md", "the plan\n")
    const { output, exit } = await runProgram(repo, "status", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.next).toEqual({
      action: "Accept plan",
      pattern: "A PLAN.md",
      target: "accepted",
    })
  })

  it("gtd status falls back to the raw pattern when the matched edge carries no action", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("REVIEW.md", "an updated review\n")
    const { output, exit } = await runProgram(repo, "status")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("Next: M REVIEW.md → idle")
  })

  it("gtd status --json's `next` omits `action` and falls back to `pattern` when the matched edge has none", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("REVIEW.md", "an updated review\n")
    const { output, exit } = await runProgram(repo, "status", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.next).toEqual({ pattern: "M REVIEW.md", target: "idle" })
  })

  it("gtd status shows the no-match line when the pending change matches no declared pattern", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("OTHER.md", "unrelated\n")
    const { output, exit } = await runProgram(repo, "status")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("Next: (no match — nothing would happen)")
  })

  it("gtd status --json's `next` is present-but-null (never omitted) on no match", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("OTHER.md", "unrelated\n")
    const { output, exit } = await runProgram(repo, "status", "--json")
    expect(Exit.isSuccess(exit)).toBe(true)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed).toHaveProperty("next")
    expect(parsed.next).toBeNull()
  })
})

describe("JSON error envelope", () => {
  it("has exactly the {state, prompt} shape on failure", async () => {
    const { output, exit } = await runFlag("bogus", "--json")
    expect(Exit.isSuccess(exit)).toBe(false)
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(["prompt", "state"])
    expect(parsed.state).toBe("error")
    expect(typeof parsed.prompt).toBe("string")
  })
})

describe("cliErrorLine", () => {
  it("does not double a message that already carries a gtd prefix", () => {
    expect(cliErrorLine(new Error("gtd: unknown option '--jsn' — see `gtd --help`"))).toBe(
      "gtd: unknown option '--jsn' — see `gtd --help`",
    )
    expect(cliErrorLine(new Error("gtd init: too many arguments"))).toBe(
      "gtd init: too many arguments",
    )
  })

  it("prepends `gtd: ` to a message that has no prefix", () => {
    expect(cliErrorLine(new Error("something broke"))).toBe("gtd: something broke")
  })

  it("stringifies a non-Error and prefixes it", () => {
    expect(cliErrorLine("boom")).toBe("gtd: boom")
  })
})

describe("classifyReviewSignoff", () => {
  const base = {
    file: ".gtd/REVIEW.md",
    stateName: "await-review",
    invoker: "human",
    reviewDocDeleted: false,
    hasCodeChange: false,
  }
  const twoUnticked = "## C\n- [ ] ./a.ts#1\n- [ ] ./b.ts#1\n"
  const allTicked = "## C\n- [x] ./a.ts#1\n- [x] ./b.ts#1\n"

  it("refuses a deleted review doc", () => {
    const v = classifyReviewSignoff({
      ...base,
      reviewDocDeleted: true,
      original: twoUnticked,
      current: "",
    })
    expect(v.kind).toBe("refuse")
    if (v.kind === "refuse") expect(v.reason).toContain("was deleted")
  })

  it("allows a code edit (a comment) even with boxes unticked", () => {
    const v = classifyReviewSignoff({
      ...base,
      hasCodeChange: true,
      original: twoUnticked,
      current: twoUnticked,
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows a note — the doc differs beyond a tick — even with a box left unticked", () => {
    const v = classifyReviewSignoff({
      ...base,
      original: twoUnticked,
      current: "## C\n- [x] ./a.ts#1\n- [ ] ./b.ts#1 — please rename\n",
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows a clean sign-off: every box ticked, no note, no code", () => {
    const v = classifyReviewSignoff({ ...base, original: twoUnticked, current: allTicked })
    expect(v).toEqual({ kind: "allow" })
  })

  it("refuses an unfinished review: only tick-flips, a box still unticked, no comment", () => {
    const v = classifyReviewSignoff({
      ...base,
      original: twoUnticked,
      current: "## C\n- [x] ./a.ts#1\n- [ ] ./b.ts#1\n",
    })
    expect(v.kind).toBe("refuse")
    if (v.kind === "refuse") expect(v.reason).toContain("1 review item(s) still unticked")
  })
})

describe("classifyFeedbackProgress", () => {
  const base = {
    file: ".gtd/REVIEW_FEEDBACK.md",
    stateName: "feedback-building",
    invoker: "agent",
    deletedContent: "1. ./a.ts#1 — rename the export\n",
  }
  const del = { path: ".gtd/REVIEW_FEEDBACK.md", status: "D" } as const

  it("refuses deleting the instructions file with no code change (the original bug)", () => {
    const v = classifyFeedbackProgress({ ...base, changes: [del] })
    expect(v.kind).toBe("refuse")
    if (v.kind === "refuse") expect(v.reason).toContain("without addressing its instructions")
  })

  it("allows deleting the file when a code change accompanies it (real work done)", () => {
    const v = classifyFeedbackProgress({
      ...base,
      changes: [del, { path: "src/a.ts", status: "M" }],
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows a NOTHING ACTIONABLE sentinel to be deleted with no code change", () => {
    const v = classifyFeedbackProgress({
      ...base,
      changes: [del],
      deletedContent: "NOTHING ACTIONABLE — the human left only an approving remark.\n",
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows a turn that does not delete the instructions file", () => {
    const v = classifyFeedbackProgress({ ...base, changes: [{ path: "src/a.ts", status: "M" }] })
    expect(v).toEqual({ kind: "allow" })
  })

  it("treats other .gtd/ churn alongside the delete as no code change (still refused)", () => {
    const v = classifyFeedbackProgress({
      ...base,
      changes: [del, { path: ".gtd/REVIEW_RAW.md", status: "D" }],
    })
    expect(v.kind).toBe("refuse")
  })
})

describe("classifyAnswerCompleteness", () => {
  const base = { file: ".gtd/REQUIREMENTS.md", stateName: "product-answer", invoker: "human" }
  const doc = (options: readonly string[]): string =>
    ["Build a thing.", "", "## Open Questions", "", "### Which API?", "", ...options, ""].join("\n")

  it("allows when there are no open questions (agent surfaced none / accept-all)", () => {
    const v = classifyAnswerCompleteness({ ...base, content: "Build a thing. Plan: do it.\n" })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows when the whole Open Questions section was deleted", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: "Build a thing.\n\n## Answered Questions\n\n### Which API?\n\nUse tRPC.\n",
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("refuses when an open question has no ticked option", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [ ] REST", "- [ ] GraphQL", "- [ ] _your answer_"]),
    })
    expect(v.kind).toBe("refuse")
    if (v.kind === "refuse") {
      expect(v.reason).toContain("1 open question(s)")
      expect(v.reason).toContain("Which API?")
    }
  })

  it("allows when every open question has exactly one tick", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [ ] REST", "- [x] GraphQL", "- [ ] _your answer_"]),
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("refuses a ticked-but-empty free-text slot", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [ ] REST", "- [ ] GraphQL", "- [x] _your answer_"]),
    })
    expect(v.kind).toBe("refuse")
  })

  it("allows a ticked free-text slot with text", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [ ] REST", "- [ ] GraphQL", "- [x] use tRPC"]),
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("refuses when two options are ticked (ambiguous)", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [x] REST", "- [x] GraphQL", "- [ ] _your answer_"]),
    })
    expect(v.kind).toBe("refuse")
  })

  it("refuses an open question that has no checkbox options at all", () => {
    const v = classifyAnswerCompleteness({ ...base, content: doc(["some prose, no boxes"]) })
    expect(v.kind).toBe("refuse")
  })
})
