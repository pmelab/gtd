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
import { compileTemplate, defaultMachineTree, renderInitConfig } from "./workflows/templates.js"
import {
  classifyAnswerCompleteness,
  classifyFeedbackProgress,
  classifyReviewSignoff,
  cliErrorLine,
  computeNextMatch,
  makeProgram,
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
  updateRef: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  deleteRef: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  mixedResetTo: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  hardResetTo: () => Effect.fail(new Error("GitService must not be called for --version/--help")),
  restoreStagedFrom: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
  addIntentToAdd: () =>
    Effect.fail(new Error("GitService must not be called for --version/--help")),
})

// Minimal stub ConfigService — satisfies the type but never loaded for flags.
const stubConfigLayer = Layer.succeed(ConfigService, {
  load: Effect.succeed({
    workflow: compileTemplate().definition,
    workflowVars: {},
    rcVars: {},
    machineTree: defaultMachineTree,
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

describe("gtd review <commitish> — subcommand guards", () => {
  // Unlike the flag-only tests above, `gtd review`'s guards need a real
  // (in-memory) repo to resolve against — a plain "must not be called"
  // stub can't tell a clean-tree-at-idle rest from a dirty/mid-process one.
  // Mirrors the precedent in src/Git.test.ts (InMemRepo + inMemoryLayers, no
  // subprocess). Full happy-path coverage (the entered state, the review
  // checkout window opening downstream, feedback laps, …) lives in
  // tests/integration/features/review-entry.feature.

  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.commitAllWithPrefix("chore: initial commit")
    return repo
  }

  const runReview = async (
    repo: InMemRepo,
    ...args: string[]
  ): Promise<{ output: string; exit: Exit.Exit<void, Error> }> => {
    let output = ""
    const write = (chunk: string) => {
      output += chunk
    }
    const argv = ["node", "gtd.js", "review", ...args]
    const exit = await Effect.runPromiseExit(
      makeProgram({ argv, write }).pipe(Effect.provide(inMemoryLayers(repo))),
    )
    return { output, exit }
  }

  it("is a known subcommand — appears in --help", async () => {
    const { output } = await runFlag("--help")
    expect(output).toContain("review <commitish>")
  })

  it("missing <commitish> argument is a usage error, nothing committed", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exit } = await runReview(repo)
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("more than one positional argument is a usage error", async () => {
    const repo = seededRepo()
    const base = repo.commitHistory()[0]!.hash
    const { exit } = await runReview(repo, base, "extra")
    expect(Exit.isSuccess(exit)).toBe(false)
  })

  it("a dirty working tree refuses, nothing committed", async () => {
    const repo = seededRepo()
    const base = repo.commitHistory()[0]!.hash
    repo.writeFile("scratch.txt", "uncommitted\n")
    const before = repo.commitHistory().length
    const { exit } = await runReview(repo, base)
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a process already underway (not resting at the initial state) refuses", async () => {
    const repo = seededRepo()
    const base = repo.commitHistory()[0]!.hash
    repo.writeFile(".gtd/TODO.md", "sketch\n")
    repo.commitAllWithPrefix("gtd(agent): plan.planning")
    const before = repo.commitHistory().length
    const { exit } = await runReview(repo, base)
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("<commitish> equal to HEAD refuses — nothing to review", async () => {
    const repo = seededRepo()
    const head = repo.commitHistory()[0]!.hash
    const before = repo.commitHistory().length
    const { exit } = await runReview(repo, head)
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a workflow declaring no reviewEntry state fails with a clear usage error", async () => {
    const repo = seededRepo()
    // A minimal custom workflow with no top-level `entry.review` anywhere,
    // COMMITTED (not left pending) so the clean-tree guard passes and this
    // test exercises the reviewEntry guard specifically.
    repo.writeFile(
      ".gtdrc.yaml",
      [
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
      ].join("\n"),
    )
    repo.commitAllWithPrefix("chore: add custom workflow")
    const base = repo.commitHistory()[0]!.hash
    const { exit } = await runReview(repo, base)
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("declares no review entry state")
    }
  })

  it("the happy path writes one empty entry commit with a Gtd-Review-Base trailer, resting at the unified template's review-entry state (review-gate.check)", async () => {
    const repo = seededRepo()
    // Pin the bundled unified template (whose top-level `entry.review` names
    // `review-gate.check`) explicitly and commit it — this is the same
    // machine gtd runs as its built-in default, materialized via
    // `renderInitConfig` (see src/workflows/templates.ts).
    repo.writeFile(".gtdrc.json", renderInitConfig())
    repo.commitAllWithPrefix("chore: init gtd workflow")
    const base = repo.commitHistory().at(-1)!.hash
    // A colleague's PR branch: ordinary commits on top of the base, no gtd
    // process of its own.
    repo.writeFile("src/calc.ts", "export const add = (a: number, b: number) => a + b\n")
    repo.commitAllWithPrefix("feat: add calculator")
    const before = repo.commitHistory().length

    const { output, exit } = await runReview(repo, base)
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(output).toContain("committed: gtd(human): review-gate.check")
    expect(repo.commitHistory()).toHaveLength(before + 1)
    expect(repo.lastCommitSubject()).toBe("gtd(human): review-gate.check")
    const message = repo.commitHistory().at(-1)!.message
    expect(message).toContain(`Gtd-Review-Base: ${base}`)
  })
})

describe("gtd fix — subcommand guards", () => {
  // Like `gtd review`, `gtd fix`'s guards need a real (in-memory) repo to
  // resolve against. Full happy-path coverage (fix-precheck running the suite,
  // dropping into the shared fixing loop or no-op'ing back to idle) lives in
  // tests/integration/features/fix-entry.feature.

  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.commitAllWithPrefix("chore: initial commit")
    return repo
  }

  const runFix = async (
    repo: InMemRepo,
    ...args: string[]
  ): Promise<{ output: string; exit: Exit.Exit<void, Error> }> => {
    let output = ""
    const write = (chunk: string) => {
      output += chunk
    }
    const argv = ["node", "gtd.js", "fix", ...args]
    const exit = await Effect.runPromiseExit(
      makeProgram({ argv, write }).pipe(Effect.provide(inMemoryLayers(repo))),
    )
    return { output, exit }
  }

  it("is a known subcommand — appears in --help", async () => {
    const { output } = await runFlag("--help")
    expect(output).toContain("fix ")
  })

  it("takes no positional argument — extra args are a usage error", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exit } = await runFix(repo, "extra")
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a dirty working tree refuses, nothing committed", async () => {
    const repo = seededRepo()
    // Scaffold the unified template so a fixEntry state exists — this test
    // exercises the clean-tree guard specifically.
    repo.writeFile(".gtdrc.json", renderInitConfig())
    repo.commitAllWithPrefix("chore: init gtd workflow")
    repo.writeFile("scratch.txt", "uncommitted\n")
    const before = repo.commitHistory().length
    const { exit } = await runFix(repo)
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a process already underway (not resting at the initial state) refuses", async () => {
    const repo = seededRepo()
    repo.writeFile(".gtdrc.json", renderInitConfig())
    repo.commitAllWithPrefix("chore: init gtd workflow")
    repo.writeFile(".gtd/TODO.md", "sketch\n")
    repo.commitAllWithPrefix("gtd(agent): plan.planning")
    const before = repo.commitHistory().length
    const { exit } = await runFix(repo)
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a workflow declaring no fixEntry state fails with a clear usage error", async () => {
    const repo = seededRepo()
    repo.writeFile(
      ".gtdrc.yaml",
      [
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
      ].join("\n"),
    )
    repo.commitAllWithPrefix("chore: add custom workflow")
    const { exit } = await runFix(repo)
    expect(Exit.isSuccess(exit)).toBe(false)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("declares no fix entry state")
    }
  })

  it("the happy path writes one empty entry commit resting at the unified template's fix-entry state (fix-precheck)", async () => {
    const repo = seededRepo()
    repo.writeFile(".gtdrc.json", renderInitConfig())
    repo.commitAllWithPrefix("chore: init gtd workflow")
    const before = repo.commitHistory().length
    const { output, exit } = await runFix(repo)
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
    "          message: write NOTE.md to start a cycle",
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
    "          message: write NOTE.md to start a cycle",
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
    "          message: write NOTE.md to start a cycle",
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
