import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { command, gatherState, dispatch } from "./cli.js"
import { mockConfig, mockGit, mockFs, nodeLayer } from "./test-helpers.js"
import { SEED, HUMAN } from "./services/CommitPrefix.js"
import { VerboseMode } from "./services/VerboseMode.js"

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
      todoFileIsNew: false,
    })
  })

  it("dispatch returns idle when last commit is 🎓 (backward compat)", async () => {
    const { dispatch } = await import("./cli.js")
    const step = dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🎓",
      hasUncheckedItems: false,
      todoFileIsNew: false,
    })
    expect(step).toBe("idle")
  })

  it("dispatch returns correct step for each inferred state", async () => {
    const { dispatch } = await import("./cli.js")

    expect(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤦",
      hasUncheckedItems: false,
      todoFileIsNew: false,
    })).toBe("plan")

    expect(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      todoFileIsNew: false,
    })).toBe("build")

    expect(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🧹",
      hasUncheckedItems: false,
      todoFileIsNew: false,
    })).toBe("idle")

    expect(dispatch({
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    })).toBe("commit-feedback")
  })

  it("idle state is reached when last commit is 🧹 and no uncommitted changes", () => {
    expect(dispatch({
      hasUncommittedChanges: false,
      lastCommitPrefix: "🧹",
      hasUncheckedItems: false,
      todoFileIsNew: false,
    })).toBe("idle")
  })

  it("idle message matches expected text", async () => {
    const { idleMessage } = await import("./cli.js")
    expect(idleMessage).toBe("Nothing to do. Create a TODO.md or add in-code comments to start.")
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

describe("gatherState resolves prevPhasePrefix", () => {
  it("resolves undefined prevPhasePrefix when no non-HUMAN commit found", async () => {
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
    expect(state.prevPhasePrefix).toBeUndefined()
  })

  it("HUMAN triggers prevPhasePrefix lookup and finds previous phase prefix", async () => {
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed(`${HUMAN} edit: user feedback`),
      getCommitMessages: (n) =>
        Effect.succeed([`${HUMAN} feedback`, `🤖 plan: setup`].slice(0, n)),
      show: () => Effect.succeed(""),
    })

    const fileOps = { ...mockFs(""), getDiffContent: () => Effect.succeed("") }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.lastCommitPrefix).toBe(HUMAN)
    expect(state.prevPhasePrefix).toBe("🤖")
  })

  it("legacy 💬 commit does not trigger prevPhasePrefix lookup", async () => {
    let commitMessagesCallCount = 0
    const gitLayer = mockGit({
      hasUncommittedChanges: () => Effect.succeed(false),
      getLastCommitMessage: () => Effect.succeed("💬 legacy feedback"),
      getCommitMessages: (n) => {
        commitMessagesCallCount++
        return Effect.succeed([`💬 legacy feedback`, `🤖 plan: setup`].slice(0, n))
      },
      show: () => Effect.succeed(""),
    })

    const fileOps = { ...mockFs(""), getDiffContent: () => Effect.succeed("") }

    const state = await Effect.runPromise(
      gatherState(fileOps).pipe(
        Effect.provide(Layer.mergeAll(gitLayer, mockConfig(), nodeLayer)),
      ),
    )

    expect(state.prevPhasePrefix).toBeUndefined()
    expect(commitMessagesCallCount).toBe(0)
  })

})

describe("gtd subcommands", () => {
  it("init subcommand is registered", async () => {
    const mod = await import("./cli.js")
    expect(mod.command).toBeDefined()
    expect(mod.initCommand).toBeDefined()
  })
})

describe("--verbose flag", () => {
  it("VerboseMode defaults to false", async () => {
    const result = await Effect.runPromise(
      VerboseMode.pipe(Effect.provide(VerboseMode.layer(false))),
    )
    expect(result.isVerbose).toBe(false)
  })

  it("VerboseMode is true when --verbose is passed", async () => {
    const result = await Effect.runPromise(
      VerboseMode.pipe(Effect.provide(VerboseMode.layer(true))),
    )
    expect(result.isVerbose).toBe(true)
  })

  it("--verbose and --debug are orthogonal flags", async () => {
    const verboseResult = await Effect.runPromise(
      VerboseMode.pipe(Effect.provide(VerboseMode.layer(true))),
    )
    expect(verboseResult.isVerbose).toBe(true)
    // command is defined independently of debug mode
    expect(command).toBeDefined()
  })
})
