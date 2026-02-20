#!/usr/bin/env node
/**
 * Sandbox boundary check helper for bats E2E tests.
 *
 * Usage:
 *   npx tsx tests/integration/helpers/sandbox-check.ts <cwd> <configFile> <checkType> <target> [providerType]
 *
 * Where:
 *   checkType: "read" | "write" | "network"
 *   target:    file path (for read/write) or domain (for network)
 *   providerType: "pi" | "opencode" | "claude" (default: "pi")
 *
 * Exits 0 if access is allowed, 1 with violation message if denied.
 */
import { readFileSync } from "node:fs"
import { mergeConfigs, type ConfigResult } from "../../../src/services/ConfigResolver.js"
import { buildSandboxConfig } from "../../../src/services/agents/Sandbox.js"
import {
  checkFilesystemWrite,
  checkFilesystemRead,
  checkNetworkAccess,
} from "../../../src/services/SandboxBoundaries.js"
import type { AgentProviderType } from "../../../src/services/ForbiddenTools.js"

const [cwd, configFile, checkType, target, providerType = "pi"] = process.argv.slice(2)

if (!cwd || !configFile || !checkType || !target) {
  console.error("Usage: sandbox-check.ts <cwd> <configFile> <checkType> <target> [providerType]")
  process.exit(2)
}

const raw = JSON.parse(readFileSync(configFile, "utf-8"))
const configs: ConfigResult[] = [{ config: raw, filepath: configFile }]
const resolved = mergeConfigs(configs)

const sandboxConfig = buildSandboxConfig(
  { prompt: "", systemPrompt: "", mode: "build", cwd },
  providerType as AgentProviderType,
  {
    filesystem: resolved.sandboxBoundaries.filesystem,
    network: resolved.sandboxBoundaries.network,
  },
)

let result: import("effect").Either.Either<void, import("../../../src/services/SandboxBoundaries.js").SandboxViolationError>

switch (checkType) {
  case "write":
    result = checkFilesystemWrite(target, sandboxConfig.filesystem)
    break
  case "read":
    result = checkFilesystemRead(target, sandboxConfig.filesystem)
    break
  case "network":
    result = checkNetworkAccess(target, sandboxConfig.network)
    break
  default:
    console.error(`Unknown check type: ${checkType}`)
    process.exit(2)
}

if (result._tag === "Left") {
  console.error(result.left.message)
  process.exit(1)
} else {
  console.log("Access allowed")
  process.exit(0)
}
