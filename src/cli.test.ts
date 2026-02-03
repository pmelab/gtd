import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { command, gatherState, dispatch, type DispatchResult, learnAction } from "./cli.js"
import { GitService } from "./services/Git.js"
import { GtdConfigService } from "./services/Config.js"
import { AgentService } from "./services/Agent.js"
import type { AgentInvocation } from "./services/Agent.js"

describe("gtd unified command", () => {
  it.effect("command is defined without subcommands", () =>
    Effect.gen(function* () {
      expect(command).toBeDefined()
    }),
  )

  it("gatherState produces correct input for inferStep", async () => {
    const { gatherState } = await import("./cli.js")

    const mockGit = {
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed("🤖 plan: update TODO.md"),
      getDiff: () => Effect.succeed(""),
      hasUnstagedChanges: () => Effect.succeed(false),
      add: () => Effect.void,
      addAll: () => Effect.void,
      commit: () => Effect.void,
      show: () => Effect.succeed(""),
      atomicCommit: () => Effect.void,
    }

    const mockConfig = {
      file: "TODO.md",
      agent: "auto",
      agentPlan: "plan",
      agentBuild: "code",
      agentLearn: "plan",
      testCmd: "npm test",
      testRetries: 10,
      commitPrompt: "",
      agentInactivityTimeout: 300,
      agentForbiddenTools: [] as ReadonlyArray<string>,
    }

    const mockFileOps = {
      readFile: () => Effect.succeed("- [x] done\n- [ ] pending"),
      exists: () => Effect.succeed(true),
      getDiffContent: () => Effect.succeed(""),
    }

    const layer = Layer.mergeAll(
      Layer.succeed(GitService, mockGit),
      Layer.succeed(GtdConfigService, mockConfig),
    )

    const state = await Effect.runPromise(
      gatherState(mockFileOps).pipe(Effect.provide(layer)),
    )

    expect(state).toEqual({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
    })
  })

  it("dispatch returns cleanup when last commit is 🎓", async () => {
    const { dispatch } = await import("./cli.js")
    const result = dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🎓",
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    })
    expect(result.step).toBe("cleanup")
  })

  it("dispatch returns correct step for each inferred state", async () => {
    const { dispatch } = await import("./cli.js")

    const steps: DispatchResult[] = []

    steps.push(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤦",
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }))
    expect(steps[0].step).toBe("plan")

    steps.push(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
    }))
    expect(steps[1].step).toBe("build")

    steps.push(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🧹",
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }))
    expect(steps[2].step).toBe("idle")

    steps.push(dispatch({
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }))
    expect(steps[3].step).toBe("commit-feedback")
  })

  it("idle state is reached when last commit is 🧹 and no uncommitted changes", () => {
    const result = dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🧹",
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    })
    expect(result.step).toBe("idle")
  })

  it("idle message matches expected text", async () => {
    const { idleMessage } = await import("./cli.js")
    expect(idleMessage).toBe("Nothing to do. Create a TODO.md or add in-code comments to start.")
  })
})

const defaultConfig = {
  file: "TODO.md",
  agent: "auto",
  agentPlan: "plan",
  agentBuild: "code",
  agentLearn: "plan",
  testCmd: "npm test",
  testRetries: 10,
  commitPrompt: "{{diff}}",
  agentInactivityTimeout: 300,
  agentForbiddenTools: [] as ReadonlyArray<string>,
}

const mockConfig = (overrides: Partial<typeof defaultConfig> = {}) =>
  Layer.succeed(GtdConfigService, { ...defaultConfig, ...overrides })

const mockGit = (overrides: Partial<GitService["Type"]> = {}) => {
  const base: GitService["Type"] = {
    getDiff: () => Effect.succeed(""),
    hasUnstagedChanges: () => Effect.succeed(false),
    hasUncommittedChanges: () => Effect.succeed(false),
    getLastCommitMessage: () => Effect.succeed(""),
    add: (() => Effect.void) as GitService["Type"]["add"],
    addAll: () => Effect.void,
    commit: (() => Effect.void) as GitService["Type"]["commit"],
    show: () => Effect.succeed(""),
    atomicCommit: ((files: ReadonlyArray<string> | "all", message: string) =>
      Effect.gen(function* () {
        if (files === "all") yield* base.addAll()
        else yield* base.add(files)
        yield* base.commit(message)
      })) as GitService["Type"]["atomicCommit"],
    ...overrides,
  }
  if (overrides.atomicCommit) {
    base.atomicCommit = overrides.atomicCommit
  }
  return Layer.succeed(GitService, base)
}

const mockFs = (content: string) => ({
  readFile: () => Effect.succeed(content),
  exists: () => Effect.succeed(content !== ""),
  remove: () => Effect.void,
})

const planWithLearnings = [
  "# Feature",
  "",
  "## Action Items",
  "",
  "- [x] Done item",
  "  - Detail",
  "",
  "## Learnings",
  "",
  "- never auto-submit forms",
  "- use optimistic UI",
  "",
].join("\n")

describe("learnAction", () => {
  it("extracts learnings and commits with 🎓 prefix when user-edited learnings present", async () => {
    const calls: AgentInvocation[] = []
    const commits: string[] = []
    const agentLayer = Layer.succeed(AgentService, {
      invoke: (params) =>
        Effect.sync(() => {
          calls.push(params)
        }),
      isAvailable: () => Effect.succeed(true),
    })
    const gitLayer = mockGit({
      commit: (msg) =>
        Effect.sync(() => {
          commits.push(msg)
        }),
    })
    await Effect.runPromise(
      learnAction({
        fs: mockFs(planWithLearnings),
        hasUncommittedLearnings: true,
      }).pipe(Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer))),
    )
    expect(calls.length).toBe(1)
    expect(calls[0]!.mode).toBe("learn")
    expect(calls[0]!.prompt).toContain("never auto-submit forms")
    expect(commits.length).toBe(1)
    expect(commits[0]!).toBe("🎓 learn: extract learnings")
  })

  it("post-build: invokes agent to extract learnings without committing", async () => {
    const calls: AgentInvocation[] = []
    const commits: string[] = []
    const planWithAllChecked = [
      "# Feature",
      "",
      "## Action Items",
      "",
      "- [x] Done item",
      "",
      "## Learnings",
      "",
    ].join("\n")
    const agentLayer = Layer.succeed(AgentService, {
      invoke: (params) =>
        Effect.sync(() => {
          calls.push(params)
        }),
      isAvailable: () => Effect.succeed(true),
    })
    const gitLayer = mockGit({
      commit: (msg) =>
        Effect.sync(() => {
          commits.push(msg)
        }),
    })
    await Effect.runPromise(
      learnAction({
        fs: mockFs(planWithAllChecked),
        hasUncommittedLearnings: false,
      }).pipe(Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer))),
    )
    expect(calls.length).toBe(1)
    expect(calls[0]!.mode).toBe("learn")
    expect(commits.length).toBe(0)
  })
})

describe("gtd learn subcommand removed", () => {
  it("no standalone learn subcommand exists", async () => {
    const mod = await import("./cli.js")
    expect((mod.command as any).subcommands).toBeUndefined()
  })
})
