import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { command, gatherState, dispatch, learnAction } from "./cli.js"
import { AgentService } from "./services/Agent.js"
import type { AgentInvocation } from "./services/Agent.js"
import { mockConfig, mockGit, mockFs, nodeLayer } from "./test-helpers.js"
import { SEED, FEEDBACK, EXPLORE, HUMAN } from "./services/CommitPrefix.js"

describe("gtd unified command", () => {
  it.effect("command is defined with init subcommand", () =>
    Effect.gen(function* () {
      expect(command).toBeDefined()
    }),
  )

  it("gatherState produces correct input for inferStep", async () => {
    const { gatherState } = await import("./cli.js")

    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed("🤖 plan: update TODO.md"),
    })

    const fileOps = {
      ...mockFs("- [x] done\n- [ ] pending"),
      getDiffContent: () => Effect.succeed(""),
    }

    const layer = Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(Effect.provide(layer)),
    )

    expect(state).toEqual({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    })
  })

  it("dispatch returns cleanup when last commit is 🎓", async () => {
    const { dispatch } = await import("./cli.js")
    const step = dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🎓",
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    })
    expect(step).toBe("cleanup")
  })

  it("dispatch returns correct step for each inferred state", async () => {
    const { dispatch } = await import("./cli.js")

    expect(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤦",
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    })).toBe("plan")

    expect(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    })).toBe("build")

    expect(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🧹",
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    })).toBe("idle")

    expect(dispatch({
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    })).toBe("commit-feedback")
  })

  it("dispatch returns learn when 🤦 + onlyLearningsModified", () => {
    expect(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤦",
      hasUncheckedItems: false,
      onlyLearningsModified: true,
      todoFileIsNew: false,
    })).toBe("learn")
  })

  it("idle state is reached when last commit is 🧹 and no uncommitted changes", () => {
    expect(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🧹",
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    })).toBe("idle")
  })

  it("idle message matches expected text", async () => {
    const { idleMessage } = await import("./cli.js")
    expect(idleMessage).toBe("Nothing to do. Create a TODO.md or add in-code comments to start.")
  })
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
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
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
      }).pipe(Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer))),
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

  it("creates empty 🎓 commit then 🧹 when Learnings section is empty", async () => {
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
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
      invoke: (params) =>
        Effect.sync(() => {
          calls.push(params)
          return { sessionId: undefined }
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
      }).pipe(Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer))),
    )
    expect(calls.length).toBe(0)
    expect(removed).toBe(true)
    expect(commits.length).toBe(2)
    expect(commits[0]!).toContain("🎓")
    expect(commits[1]!).toContain("🧹")
  })

  it("uses empty commit when agent makes no changes to learnings", async () => {
    const calls: AgentInvocation[] = []
    const commits: string[] = []
    const emptyCommits: string[] = []
    let removed = false
    const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
      invoke: (params) => {
        calls.push(params)
        return Effect.succeed({ sessionId: undefined })
      },
      isAvailable: () => Effect.succeed(true),
    })
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      commit: (msg) =>
        Effect.sync(() => {
          commits.push(msg)
        }),
      emptyCommit: (msg) =>
        Effect.sync(() => {
          emptyCommits.push(msg)
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
      }).pipe(Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer))),
    )
    // Agent was invoked but made no changes
    expect(calls.length).toBe(1)
    expect(emptyCommits).toContain("🎓 learn: no changes")
    expect(removed).toBe(true)
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
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
      invoke: (params) =>
        Effect.sync(() => {
          calls.push(params)
          return { sessionId: undefined }
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
      }).pipe(Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer))),
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
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
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
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.onlyLearningsModified).toBe(true)
    expect(state.lastCommitPrefix).toBe("🤦")
  })
})

describe("gatherState handles SEED and FEEDBACK for onlyLearningsModified", () => {
  it("after a 🌱 commit correctly infers plan as next step", async () => {
    const preCommitContent = [
      "# Feature",
      "",
      "## Action Items",
      "",
      "- [ ] Do something",
      "",
    ].join("\n")

    const commitDiff = [
      "diff --git a/TODO.md b/TODO.md",
      "--- /dev/null",
      "+++ b/TODO.md",
      "@@ -0,0 +1,5 @@",
      "+# Feature",
      "+",
      "+## Action Items",
      "+",
      "+- [ ] Do something",
    ].join("\n")

    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed("🌱 seed: initial plan"),
      show: (ref) => {
        if (ref === "HEAD") return Effect.succeed(commitDiff)
        if (ref.includes("HEAD~1")) return Effect.succeed("")
        return Effect.succeed("")
      },
    })

    const fileOps = {
      readFile: () => Effect.succeed(preCommitContent),
      exists: () => Effect.succeed(true),
      getDiffContent: () => Effect.succeed(""),
      remove: () => Effect.void,
    }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.lastCommitPrefix).toBe(SEED)
    expect(state.onlyLearningsModified).toBe(false)
    expect(dispatch(state)).toBe("explore")
  })

  it("after a 💬 commit correctly infers plan as next step", async () => {
    const preCommitContent = [
      "# Feature",
      "",
      "## Action Items",
      "",
      "- [ ] Do something",
      "",
    ].join("\n")

    const commitDiff = [
      "diff --git a/TODO.md b/TODO.md",
      "--- a/TODO.md",
      "+++ b/TODO.md",
      "@@ -5,1 +5,3 @@",
      " - [ ] Do something",
      "+",
      "+> Please reconsider this approach",
    ].join("\n")

    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed("💬 feedback: reconsider approach"),
      show: (ref) => {
        if (ref === "HEAD") return Effect.succeed(commitDiff)
        if (ref.includes("HEAD~1")) return Effect.succeed(preCommitContent)
        return Effect.succeed("")
      },
    })

    const fileOps = {
      readFile: () => Effect.succeed(preCommitContent + "\n> Please reconsider this approach\n"),
      exists: () => Effect.succeed(true),
      getDiffContent: () => Effect.succeed(""),
      remove: () => Effect.void,
    }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.lastCommitPrefix).toBe(FEEDBACK)
    expect(state.onlyLearningsModified).toBe(false)
    expect(dispatch(state)).toBe("plan")
  })

  it("after a 🌱 commit with only learnings modified detects onlyLearningsModified", async () => {
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
      getLastCommitMessage: () => Effect.succeed("🌱 seed: add learning"),
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
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.lastCommitPrefix).toBe(SEED)
    expect(state.onlyLearningsModified).toBe(true)
  })

  it("after a 💬 commit with only learnings modified detects onlyLearningsModified", async () => {
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
      getLastCommitMessage: () => Effect.succeed("💬 feedback: add learning"),
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
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.lastCommitPrefix).toBe(FEEDBACK)
    expect(state.onlyLearningsModified).toBe(true)
  })
})

describe("gatherState computes todoFileIsNew", () => {
  it("todoFileIsNew is true when TODO exists in HEAD but not HEAD~1", async () => {
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed("👷 fix: something"),
      show: (ref) => {
        if (ref === "HEAD:TODO.md") return Effect.succeed("# Plan\n")
        if (ref === "HEAD~1:TODO.md") return Effect.fail(new Error("not found"))
        return Effect.succeed("")
      },
    })

    const fileOps = {
      ...mockFs("# Plan\n"),
      getDiffContent: () => Effect.succeed(""),
    }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.todoFileIsNew).toBe(true)
  })

  it("todoFileIsNew is false when TODO exists in both HEAD and HEAD~1", async () => {
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed("👷 fix: something"),
      show: (ref) => {
        if (ref === "HEAD:TODO.md") return Effect.succeed("# Plan\n")
        if (ref === "HEAD~1:TODO.md") return Effect.succeed("# Plan\n")
        return Effect.succeed("")
      },
    })

    const fileOps = {
      ...mockFs("# Plan\n"),
      getDiffContent: () => Effect.succeed(""),
    }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.todoFileIsNew).toBe(false)
  })

  it("todoFileIsNew is true when show returns empty string for HEAD~1", async () => {
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed("add TODO.md"),
      show: (ref) => {
        if (ref === "HEAD:TODO.md") return Effect.succeed("# Plan\n")
        if (ref === "HEAD~1:TODO.md") return Effect.succeed("")
        return Effect.succeed("")
      },
    })

    const fileOps = {
      ...mockFs("# Plan\n"),
      getDiffContent: () => Effect.succeed(""),
    }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.todoFileIsNew).toBe(true)
  })

  it("todoFileIsNew is false when uncommitted changes exist", async () => {
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(true),
      getLastCommitMessage: () => Effect.succeed("👷 fix: something"),
      show: (ref) => {
        if (ref.includes("TODO.md")) return Effect.succeed("# Plan\n")
        return Effect.succeed("")
      },
    })

    const fileOps = {
      ...mockFs("# Plan\n"),
      getDiffContent: () => Effect.succeed(""),
    }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.todoFileIsNew).toBe(false)
  })
})

describe("gatherState resolves prevNonHumanPrefix", () => {
  it("resolves EXPLORE when git log is EXPLORE → HUMAN → HUMAN", async () => {
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed(`${HUMAN} edit: user feedback`),
      getCommitMessages: (n) =>
        Effect.succeed([
          `${HUMAN} edit: user feedback`,
          `${HUMAN} edit: more feedback`,
          `${EXPLORE} explore: propose options`,
          "🌱 seed: initial idea",
        ].slice(0, n)),
      show: () => Effect.succeed(""),
    })

    const fileOps = { ...mockFs(""), getDiffContent: () => Effect.succeed("") }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.lastCommitPrefix).toBe(HUMAN)
    expect(state.prevNonHumanPrefix).toBe(EXPLORE)
  })

  it("resolves undefined prevNonHumanPrefix when no non-HUMAN commit found", async () => {
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed(`${HUMAN} edit: user feedback`),
      getCommitMessages: (n) =>
        Effect.succeed([`${HUMAN} one`, `${HUMAN} two`].slice(0, n)),
      show: () => Effect.succeed(""),
    })

    const fileOps = { ...mockFs(""), getDiffContent: () => Effect.succeed("") }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.lastCommitPrefix).toBe(HUMAN)
    expect(state.prevNonHumanPrefix).toBeUndefined()
  })

  it("HUMAN after EXPLORE routes to explore via dispatch", async () => {
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed(`${HUMAN} edit: feedback`),
      getCommitMessages: (n) =>
        Effect.succeed([
          `${HUMAN} edit: feedback`,
          `${EXPLORE} explore: options`,
        ].slice(0, n)),
      show: () => Effect.succeed(""),
    })

    const fileOps = { ...mockFs(""), getDiffContent: () => Effect.succeed("") }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(dispatch(state)).toBe("explore")
  })
})

describe("gtd subcommands", () => {
  it("init subcommand is registered", async () => {
    const mod = await import("./cli.js")
    expect(mod.command).toBeDefined()
    expect(mod.initCommand).toBeDefined()
  })
})
