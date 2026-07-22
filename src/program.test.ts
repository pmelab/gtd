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
import { ConfigInit, ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { GitService } from "./Git.js"
import { WorktreeReader } from "./WorktreeReader.js"
import { defaultWorkflowDefinition } from "./workflows/default.js"
import { makeProgram } from "./program.js"

// GitService whose every method fails — proves the flag handler never calls git.
const failingGitLayer = Layer.succeed(GitService, {
  hasCommits: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  lastCommitSubject: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
  resolveRef: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  topLevel: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  commitHistory: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  diffHead: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  diffRef: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  commitDiff: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  changedPaths: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  commitAllWithPrefix: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
  softResetTo: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  commitAsIs: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  discardPending: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
})

// Minimal stub ConfigService — satisfies the type but never called for flags.
const stubConfigLayer = Layer.succeed(ConfigService, {
  workflow: defaultWorkflowDefinition,
  workflowVars: {},
  rcVars: {},
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
  Layer.provideMerge(ConfigInit.Noop),
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
})

describe("--help short-circuit", () => {
  it("prints usage block and succeeds without touching git", async () => {
    const { output, exit } = await runFlag("--help")
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("Usage")
    expect(output).toContain("step")
    expect(output).toContain("step <actor>")
    expect(output).toContain("next")
    expect(output).toContain("status")
    expect(output).toContain("run")
    expect(output).toContain("format")
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

describe("gtd format argument validation", () => {
  it("fails when no file path is given", async () => {
    const { exit } = await runFlag("format")
    expect(Exit.isSuccess(exit)).toBe(false)
  })

  it("fails when --json is combined with format", async () => {
    const { exit } = await runFlag("format", "some.md", "--json")
    expect(Exit.isSuccess(exit)).toBe(false)
  })

  it("fails when more than one path is given", async () => {
    const { exit } = await runFlag("format", "a.md", "b.md")
    expect(Exit.isSuccess(exit)).toBe(false)
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
