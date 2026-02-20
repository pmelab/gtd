import { When } from "@cucumber/cucumber"
import { execSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { GtdWorld } from "../world.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")
const SANDBOX_CHECK = join(PROJECT_ROOT, "tests/integration/helpers/sandbox-check.ts")

function writeGtdrc(dir: string, content: string) {
  writeFileSync(join(dir, ".gtdrc.json"), content)
}

function runSandboxCheck(
  world: GtdWorld,
  cwd: string,
  configFile: string,
  checkType: string,
  target: string,
  provider = "pi",
) {
  try {
    const stdout = execSync(
      `npx tsx ${SANDBOX_CHECK} ${JSON.stringify(cwd)} ${JSON.stringify(configFile)} ${checkType} ${JSON.stringify(target)} ${provider}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    )
    world.lastResult = { exitCode: 0, stdout, stderr: "" }
  } catch (err: unknown) {
    const e = err as { status: number; stdout: string; stderr: string }
    world.lastResult = {
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    }
  }
}

function ensureConfig(world: GtdWorld) {
  const dir = world.sandboxDir!
  if (!existsSync(join(dir, ".gtdrc.json"))) {
    writeGtdrc(dir, '{ "sandboxEnabled": true }')
  }
}

When(
  "I check sandbox {string} for {string} as {string}",
  function (this: GtdWorld, checkType: string, target: string, provider: string) {
    ensureConfig(this)
    runSandboxCheck(
      this,
      this.sandboxDir!,
      join(this.sandboxDir!, ".gtdrc.json"),
      checkType,
      target,
      provider,
    )
  },
)

When("I check sandbox {string} for outside path", function (this: GtdWorld, checkType: string) {
  ensureConfig(this)
  const target =
    checkType === "write"
      ? join(this.outsideDir!, "output.txt")
      : join(this.outsideDir!, "data.txt")
  runSandboxCheck(
    this,
    this.sandboxDir!,
    join(this.sandboxDir!, ".gtdrc.json"),
    checkType,
    target,
  )
})

When(
  "I check sandbox {string} for inside path {string}",
  function (this: GtdWorld, checkType: string, path: string) {
    ensureConfig(this)
    runSandboxCheck(
      this,
      this.sandboxDir!,
      join(this.sandboxDir!, ".gtdrc.json"),
      checkType,
      join(this.sandboxDir!, path),
    )
  },
)

When(
  "sandbox config adds network allowedDomains {string}",
  function (this: GtdWorld, domain: string) {
    writeGtdrc(
      this.sandboxDir!,
      JSON.stringify({
        sandboxEnabled: true,
        sandboxBoundaries: {
          network: { allowedDomains: [domain] },
        },
      }),
    )
  },
)

When("sandbox config adds filesystem allowWrite for outside path", function (this: GtdWorld) {
  writeGtdrc(
    this.sandboxDir!,
    JSON.stringify({
      sandboxEnabled: true,
      sandboxBoundaries: {
        filesystem: { allowWrite: [this.outsideDir!] },
      },
    }),
  )
})

When("sandbox config adds filesystem allowRead for outside path", function (this: GtdWorld) {
  writeGtdrc(
    this.sandboxDir!,
    JSON.stringify({
      sandboxEnabled: true,
      sandboxBoundaries: {
        filesystem: { allowRead: [this.outsideDir!] },
      },
    }),
  )
})
