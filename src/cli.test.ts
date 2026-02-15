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

  it("dispatch returns learn when 🤦 + onlyLearningsModified", () => {
    const result = dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤦",
      hasUncheckedItems: false,
      onlyLearningsModified: true,
    })
    expect(result.step).toBe("learn")
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
  it("persists learnings to AGENTS.md and chains cleanup", async () => {
    const calls: AgentInvocation[] = []
    const commits: string[] = []
    let removed = false
    const agentLayer = Layer.succeed(AgentService, {
      invoke: (params) => {
        calls.push(params)
        if (params.onEvent) params.onEvent({ _tag: "TextDelta", delta: "learn: persist learnings" })
        return Effect.succeed({ sessionId: undefined })
      },
      isAvailable: () => Effect.succeed(true),
    })
    const gitLayer = mockGit({
      commit: (msg) =>
        Effect.sync(() => {
          commits.push(msg)
        }),
    })
    const fs = {
      ...mockFs(planWithLearnings),
      remove: () =>
        Effect.sync(() => {
          removed = true
        }),
    }
    await Effect.runPromise(
      learnAction({
        fs,
      }).pipe(Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer))),
    )
    const learnCalls = calls.filter((c) => c.mode === "learn")
    expect(learnCalls.length).toBe(1)
    expect(learnCalls[0]!.prompt).toContain("never auto-submit forms")
    // Should commit with 🎓, then remove file, then commit with 🧹
    expect(commits.length).toBe(2)
    expect(commits[0]!).toBe("🎓 learn: persist learnings")
    expect(commits[1]!).toContain("🧹")
    expect(removed).toBe(true)
  })

  it("skips to cleanup when Learnings section is empty", async () => {
    const calls: AgentInvocation[] = []
    const commits: string[] = []
    let removed = false
    const planWithEmptyLearnings = [
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
    const fs = {
      ...mockFs(planWithEmptyLearnings),
      remove: () =>
        Effect.sync(() => {
          removed = true
        }),
    }
    await Effect.runPromise(
      learnAction({
        fs,
      }).pipe(Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer))),
    )
    expect(calls.length).toBe(0)
    expect(removed).toBe(true)
    expect(commits.length).toBe(1)
    expect(commits[0]!).toContain("🧹")
  })

  it("skips to cleanup when Learnings section is missing", async () => {
    const calls: AgentInvocation[] = []
    const commits: string[] = []
    let removed = false
    const planWithoutLearnings = [
      "# Feature",
      "",
      "## Action Items",
      "",
      "- [x] Done item",
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
    const fs = {
      ...mockFs(planWithoutLearnings),
      remove: () =>
        Effect.sync(() => {
          removed = true
        }),
    }
    await Effect.runPromise(
      learnAction({
        fs,
      }).pipe(Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer))),
    )
    expect(calls.length).toBe(0)
    expect(removed).toBe(true)
    expect(commits.length).toBe(1)
    expect(commits[0]!).toContain("🧹")
  })
})

describe("gatherState computes onlyLearningsModified", () => {
  it("uses git show HEAD:<file> for uncommitted changes", async () => {
    const committedContent = [
      "# Feature",
      "",
      "## Action Items",
      "",
      "- [x] Done",
      "",
      "## Learnings",
      "",
    ].join("\n")

    // Diff that modifies only line 8 (inside Learnings section of committed content)
    const diff = [
      "diff --git a/TODO.md b/TODO.md",
      "--- a/TODO.md",
      "+++ b/TODO.md",
      "@@ -8,0 +8,1 @@",
      "+- new learning",
    ].join("\n")

    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(true),
      getLastCommitMessage: () => Effect.succeed("🤖 build: done"),
      getDiff: () => Effect.succeed(diff),
      show: (ref) =>
        ref.includes("TODO.md")
          ? Effect.succeed(committedContent)
          : Effect.succeed(""),
    })

    const currentContent = [
      "# Feature",
      "",
      "## Action Items",
      "",
      "- [x] Done",
      "",
    ].join("\n")

    const fileOps = {
      readFile: () => Effect.succeed(currentContent),
      exists: () => Effect.succeed(true),
      getDiffContent: () => Effect.succeed(diff),
      remove: () => Effect.void,
    }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig())),
      ),
    )

    expect(state.onlyLearningsModified).toBe(true)
  })

  it("uses git show HEAD and HEAD~1:<file> for 🤦 commits", async () => {
    const preCommitContent = [
      "# Feature",
      "",
      "## Action Items",
      "",
      "- [x] Done",
      "",
      "## Learnings",
      "",
    ].join("\n")

    const commitDiff = [
      "diff --git a/TODO.md b/TODO.md",
      "--- a/TODO.md",
      "+++ b/TODO.md",
      "@@ -8,0 +8,1 @@",
      "+- new learning",
    ].join("\n")

    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed("🤦 feedback: added learning"),
      show: (ref) => {
        if (ref === "HEAD") return Effect.succeed(commitDiff)
        if (ref.includes("HEAD~1")) return Effect.succeed(preCommitContent)
        return Effect.succeed("")
      },
    })

    const fileOps = {
      readFile: () => Effect.succeed(preCommitContent + "- new learning\n"),
      exists: () => Effect.succeed(true),
      getDiffContent: () => Effect.succeed(""),
      remove: () => Effect.void,
    }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig())),
      ),
    )

    expect(state.onlyLearningsModified).toBe(true)
    expect(state.lastCommitPrefix).toBe("🤦")
  })
})

describe("gtd learn subcommand removed", () => {
  it("no standalone learn subcommand exists", async () => {
    const mod = await import("./cli.js")
    expect((mod.command as any).subcommands).toBeUndefined()
  })
})
