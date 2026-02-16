import { Effect, Layer } from "effect"
import { GtdConfigService, type GtdConfig } from "./services/Config.js"
import { GitService, type GitOperations } from "./services/Git.js"

export const defaultTestConfig: GtdConfig = {
  file: "TODO.md",
  agent: "auto",
  agentPlan: "plan",
  agentBuild: "code",
  agentLearn: "plan",
  testCmd: "",
  testRetries: 10,
  commitPrompt: "{{diff}}",
  agentInactivityTimeout: 300,
  agentForbiddenTools: [],
}

export const mockConfig = (overrides: Partial<GtdConfig> = {}) =>
  Layer.succeed(GtdConfigService, { ...defaultTestConfig, ...overrides })

export const mockGit = (overrides: Partial<GitOperations> = {}) => {
  const base: GitOperations = {
    getDiff: () => Effect.succeed(""),
    hasUnstagedChanges: () => Effect.succeed(false),
    hasUncommittedChanges: () => Effect.succeed(false),
    getLastCommitMessage: () => Effect.succeed(""),
    add: (() => Effect.void) as GitOperations["add"],
    addAll: () => Effect.void,
    commit: (() => Effect.void) as GitOperations["commit"],
    show: () => Effect.succeed(""),
    atomicCommit: ((files: ReadonlyArray<string> | "all", message: string) =>
      Effect.gen(function* () {
        if (files === "all") yield* base.addAll()
        else yield* base.add(files)
        yield* base.commit(message)
      })) as GitOperations["atomicCommit"],
    stageByPatch: () => Effect.void,
    ...overrides,
  }
  if (overrides.atomicCommit) {
    base.atomicCommit = overrides.atomicCommit
  }
  return Layer.succeed(GitService, base)
}

export const mockFs = (content: string) => ({
  readFile: () => Effect.succeed(content),
  exists: () => Effect.succeed(content !== ""),
  getDiffContent: () => Effect.succeed(""),
  remove: () => Effect.void,
})
