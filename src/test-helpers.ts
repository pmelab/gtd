import { Effect, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GtdConfigService, type GtdConfig } from "./services/Config.js"
import { GitService, type GitOperations } from "./services/Git.js"
import { VerboseMode } from "./services/VerboseMode.js"

export const defaultTestConfig: GtdConfig = {
  file: "TODO.md",
  modelPlan: undefined,
  modelBuild: undefined,
  modelLearn: undefined,
  modelCommit: undefined,
  testCmd: "",
  testRetries: 10,
  commitPrompt: "{{diff}}",
  agentInactivityTimeout: 300,
  configSources: [],
}

export const mockConfig = (overrides: Partial<GtdConfig> = {}) =>
  Layer.succeed(GtdConfigService, { ...defaultTestConfig, ...overrides })

export const mockGit = (overrides: Partial<GitOperations> = {}) => {
  const base: GitOperations = {
    getDiff: () => Effect.succeed(""),
    hasUnstagedChanges: () => Effect.succeed(false),
    hasUncommittedChanges: () => Effect.succeed(true),
    getLastCommitMessage: () => Effect.succeed(""),
    getCommitMessages: () => Effect.succeed([]),
    add: (() => Effect.void) as GitOperations["add"],
    addAll: () => Effect.void,
    commit: (() => Effect.void) as GitOperations["commit"],
    emptyCommit: (message) => base.commit(message),
    show: () => Effect.succeed(""),
    atomicCommit: ((files: ReadonlyArray<string> | "all", message: string) =>
      Effect.gen(function* () {
        if (files === "all") yield* base.addAll()
        else yield* base.add(files)
        yield* base.commit(message)
      })) as GitOperations["atomicCommit"],
    amendFiles: () => Effect.void,
    stageByPatch: () => Effect.void,
    ...overrides,
  }
  return Layer.succeed(GitService, base)
}

export const mockFs = (content: string) => ({
  readFile: () => Effect.succeed(content),
  writeFile: () => Effect.void,
  exists: () => Effect.succeed(content !== ""),
  getDiffContent: () => Effect.succeed(""),
  remove: () => Effect.void,
})

export const nodeLayer = Layer.mergeAll(NodeContext.layer, VerboseMode.layer(false))
