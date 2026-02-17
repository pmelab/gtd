import { describe, it, expect, beforeEach, afterEach } from "@effect/vitest"
import { Effect } from "effect"
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { AgentProvider, AgentInvocation } from "./Agent.js"
import { AgentError } from "./Agent.js"
import type { AgentEvent } from "./AgentEvent.js"
import { AgentEvents } from "./AgentEvent.js"
import { SandboxAgent, buildSandboxConfig } from "./agents/Sandbox.js"
import {
  checkFilesystemWrite,
  checkFilesystemRead,
  checkNetworkAccess,
} from "./SandboxBoundaries.js"
import { mergeConfigs, type ConfigResult } from "./ConfigResolver.js"

const makeInvocation = (overrides?: Partial<AgentInvocation>): AgentInvocation => ({
  prompt: "test prompt",
  systemPrompt: "test system",
  mode: "build",
  cwd: "/tmp/test-cwd",
  ...overrides,
})

const makeMockProvider = (
  overrides?: Partial<AgentProvider>,
): AgentProvider => ({
  name: "mock",
  providerType: "pi",
  isAvailable: () => Effect.succeed(true),
  invoke: (params) => Effect.succeed({ sessionId: undefined }),
  ...overrides,
})

describe("E2E: filesystem boundary fail-stop and config-driven escalation", () => {
  let testDir: string
  let outsideDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "gtd-e2e-fs-"))
    outsideDir = join(tmpdir(), "gtd-test-output-" + Date.now())
    await mkdir(outsideDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
    await rm(outsideDir, { recursive: true, force: true })
  })

  it("write escalation: run → fail-stop → config update → re-run → success", async () => {
    // Step 1: Build sandbox config with default boundaries (cwd only)
    const configFile = join(testDir, ".gtdrc.json")
    await writeFile(
      configFile,
      JSON.stringify({
        sandboxEnabled: true,
      }),
      "utf-8",
    )

    const configs1: ConfigResult[] = [
      {
        config: JSON.parse(await readFile(configFile, "utf-8")),
        filepath: configFile,
      },
    ]
    const resolved1 = mergeConfigs(configs1)
    expect(resolved1.sandboxEnabled).toBe(true)

    // Step 2: Build sandbox config and verify write to outside dir is denied
    const sandboxConfig1 = buildSandboxConfig(
      makeInvocation({ cwd: testDir }),
      "pi",
      { filesystem: resolved1.sandboxBoundaries.filesystem },
    )

    const writeCheck1 = checkFilesystemWrite(
      join(outsideDir, "output.txt"),
      sandboxConfig1.filesystem,
    )
    expect(writeCheck1._tag).toBe("Left")
    if (writeCheck1._tag === "Left") {
      expect(writeCheck1.left.message).toContain(outsideDir)
      expect(writeCheck1.left.message).toContain("allowWrite")
      expect(writeCheck1.left.reason).toBe("sandbox_violation")
    }

    // Step 3: Update config to allow writing to the outside dir
    await writeFile(
      configFile,
      JSON.stringify({
        sandboxEnabled: true,
        sandboxBoundaries: {
          filesystem: {
            allowWrite: [outsideDir],
          },
        },
      }),
      "utf-8",
    )

    // Step 4: Re-resolve config and verify write is now allowed
    const configs2: ConfigResult[] = [
      {
        config: JSON.parse(await readFile(configFile, "utf-8")),
        filepath: configFile,
      },
    ]
    const resolved2 = mergeConfigs(configs2)
    const sandboxConfig2 = buildSandboxConfig(
      makeInvocation({ cwd: testDir }),
      "pi",
      { filesystem: resolved2.sandboxBoundaries.filesystem },
    )

    const writeCheck2 = checkFilesystemWrite(
      join(outsideDir, "output.txt"),
      sandboxConfig2.filesystem,
    )
    expect(writeCheck2._tag).toBe("Right")
  })

  it("read escalation: run → fail-stop → config update → re-run → success", async () => {
    // Step 1: Create a file outside cwd to read
    const externalFile = join(outsideDir, "data.txt")
    await writeFile(externalFile, "external data", "utf-8")

    const configFile = join(testDir, ".gtdrc.json")
    await writeFile(
      configFile,
      JSON.stringify({
        sandboxEnabled: true,
      }),
      "utf-8",
    )

    const configs1: ConfigResult[] = [
      {
        config: JSON.parse(await readFile(configFile, "utf-8")),
        filepath: configFile,
      },
    ]
    const resolved1 = mergeConfigs(configs1)

    // Step 2: Verify read from outside dir is denied
    const sandboxConfig1 = buildSandboxConfig(
      makeInvocation({ cwd: testDir }),
      "pi",
      { filesystem: resolved1.sandboxBoundaries.filesystem },
    )

    const readCheck1 = checkFilesystemRead(externalFile, sandboxConfig1.filesystem)
    expect(readCheck1._tag).toBe("Left")
    if (readCheck1._tag === "Left") {
      expect(readCheck1.left.message).toContain(outsideDir)
      expect(readCheck1.left.message).toContain("allowRead")
      expect(readCheck1.left.reason).toBe("sandbox_violation")
    }

    // Step 3: Update config to allow reading from the outside dir
    await writeFile(
      configFile,
      JSON.stringify({
        sandboxEnabled: true,
        sandboxBoundaries: {
          filesystem: {
            allowRead: [outsideDir],
          },
        },
      }),
      "utf-8",
    )

    // Step 4: Re-resolve config and verify read is now allowed
    const configs2: ConfigResult[] = [
      {
        config: JSON.parse(await readFile(configFile, "utf-8")),
        filepath: configFile,
      },
    ]
    const resolved2 = mergeConfigs(configs2)
    const sandboxConfig2 = buildSandboxConfig(
      makeInvocation({ cwd: testDir }),
      "pi",
      { filesystem: resolved2.sandboxBoundaries.filesystem },
    )

    const readCheck2 = checkFilesystemRead(externalFile, sandboxConfig2.filesystem)
    expect(readCheck2._tag).toBe("Right")
  })
})

describe("E2E: network boundary fail-stop and config-driven escalation", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "gtd-e2e-net-"))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it("network escalation: run → fail-stop → config update → re-run → success", async () => {
    const untrustedDomain = "evil-api.example.com"

    // Step 1: Set up config with sandbox enabled, no extra domains
    const configFile = join(testDir, ".gtdrc.json")
    await writeFile(
      configFile,
      JSON.stringify({
        sandboxEnabled: true,
      }),
      "utf-8",
    )

    const configs1: ConfigResult[] = [
      {
        config: JSON.parse(await readFile(configFile, "utf-8")),
        filepath: configFile,
      },
    ]
    const resolved1 = mergeConfigs(configs1)

    // Step 2: Build sandbox config and verify network access to untrusted domain is denied
    const sandboxConfig1 = buildSandboxConfig(
      makeInvocation({ cwd: testDir }),
      "claude",
      { network: resolved1.sandboxBoundaries.network },
    )

    const netCheck1 = checkNetworkAccess(untrustedDomain, sandboxConfig1.network)
    expect(netCheck1._tag).toBe("Left")
    if (netCheck1._tag === "Left") {
      expect(netCheck1.left.message).toContain(untrustedDomain)
      expect(netCheck1.left.message).toContain("allowedDomains")
      expect(netCheck1.left.reason).toBe("sandbox_violation")
    }

    // Step 3: Update config to allow the domain
    await writeFile(
      configFile,
      JSON.stringify({
        sandboxEnabled: true,
        sandboxBoundaries: {
          network: {
            allowedDomains: [untrustedDomain],
          },
        },
      }),
      "utf-8",
    )

    // Step 4: Re-resolve config and verify domain is now allowed
    const configs2: ConfigResult[] = [
      {
        config: JSON.parse(await readFile(configFile, "utf-8")),
        filepath: configFile,
      },
    ]
    const resolved2 = mergeConfigs(configs2)
    const sandboxConfig2 = buildSandboxConfig(
      makeInvocation({ cwd: testDir }),
      "claude",
      { network: resolved2.sandboxBoundaries.network },
    )

    const netCheck2 = checkNetworkAccess(untrustedDomain, sandboxConfig2.network)
    expect(netCheck2._tag).toBe("Right")
  })
})
