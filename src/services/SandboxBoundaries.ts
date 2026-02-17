import type { AgentProviderType } from "./ForbiddenTools.js"

export type BoundaryLevel = "restricted" | "standard" | "elevated"

export const BOUNDARY_LEVELS: ReadonlyArray<BoundaryLevel> = ["restricted", "standard", "elevated"]

export type WorkflowPhase = "plan" | "build" | "learn"

export const boundaryForPhase = (phase: WorkflowPhase): BoundaryLevel => {
  switch (phase) {
    case "plan":
      return "restricted"
    case "build":
      return "standard"
    case "learn":
      return "restricted"
  }
}

export const AGENT_ESSENTIAL_DOMAINS: Record<AgentProviderType, ReadonlyArray<string>> = {
  pi: ["api.anthropic.com"],

  opencode: [
    "api.anthropic.com",
    "api.openai.com",
    "generativelanguage.googleapis.com",
  ],

  claude: ["api.anthropic.com", "sentry.io"],
}

export interface FilesystemConfig {
  readonly allowRead: ReadonlyArray<string>
  readonly allowWrite: ReadonlyArray<string>
}

export interface FilesystemUserOverrides {
  readonly allowRead?: ReadonlyArray<string>
  readonly allowWrite?: ReadonlyArray<string>
}

export const defaultFilesystemConfig = (
  cwd: string,
  overrides?: FilesystemUserOverrides,
): FilesystemConfig => {
  const allowRead = [...new Set([cwd, ...(overrides?.allowRead ?? [])])]
  const allowWrite = [...new Set([cwd, ...(overrides?.allowWrite ?? [])])]
  return { allowRead, allowWrite }
}

export interface NetworkConfig {
  readonly allowedDomains: ReadonlyArray<string>
}

export interface NetworkUserOverrides {
  readonly allowedDomains?: ReadonlyArray<string>
}

export const defaultNetworkConfig = (
  providerType: AgentProviderType,
  overrides?: NetworkUserOverrides,
): NetworkConfig => {
  const essential = AGENT_ESSENTIAL_DOMAINS[providerType]
  const allowedDomains = [...new Set([...essential, ...(overrides?.allowedDomains ?? [])])]
  return { allowedDomains }
}
