import { Either } from "effect"
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

export type SandboxViolationReason = "sandbox_violation"

export class SandboxViolationError {
  readonly _tag = "SandboxViolationError"
  readonly reason: SandboxViolationReason = "sandbox_violation"
  constructor(readonly message: string) {}
}

const isPathWithinAllowed = (
  targetPath: string,
  allowedPaths: ReadonlyArray<string>,
): boolean => {
  const normalized = targetPath.endsWith("/") ? targetPath : targetPath
  return allowedPaths.some((allowed) => {
    const normalizedAllowed = allowed.endsWith("/") ? allowed : allowed + "/"
    return normalized === allowed || normalized.startsWith(normalizedAllowed)
  })
}

export const checkFilesystemWrite = (
  targetPath: string,
  config: FilesystemConfig,
): Either.Either<void, SandboxViolationError> => {
  if (isPathWithinAllowed(targetPath, config.allowWrite)) {
    return Either.right(undefined)
  }
  return Either.left(
    new SandboxViolationError(
      `Sandbox violation: write to "${targetPath}" is denied. ` +
        `The path is outside the allowed write boundaries. ` +
        `To allow this, add the directory to "sandboxBoundaries.filesystem.allowWrite" in your .gtdrc.json.`,
    ),
  )
}

export const checkFilesystemRead = (
  targetPath: string,
  config: FilesystemConfig,
): Either.Either<void, SandboxViolationError> => {
  if (isPathWithinAllowed(targetPath, config.allowRead)) {
    return Either.right(undefined)
  }
  return Either.left(
    new SandboxViolationError(
      `Sandbox violation: read from "${targetPath}" is denied. ` +
        `The path is outside the allowed read boundaries. ` +
        `To allow this, add the directory to "sandboxBoundaries.filesystem.allowRead" in your .gtdrc.json.`,
    ),
  )
}

export const checkNetworkAccess = (
  domain: string,
  config: NetworkConfig,
): Either.Either<void, SandboxViolationError> => {
  if (config.allowedDomains.includes(domain)) {
    return Either.right(undefined)
  }
  return Either.left(
    new SandboxViolationError(
      `Sandbox violation: network access to "${domain}" is denied. ` +
        `The domain is not in the allowed domains list. ` +
        `To allow this, add "${domain}" to "sandboxBoundaries.network.allowedDomains" in your .gtdrc.json.`,
    ),
  )
}
