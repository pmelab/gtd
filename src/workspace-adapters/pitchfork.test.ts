import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { servicesContract, type ServicesHarness } from "../workspace-testkit/index.js"
import { pitchfork } from "./pitchfork.js"

const which = (command: string): string | undefined => {
  try {
    return execFileSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).trim()
  } catch {
    return undefined
  }
}

const PITCHFORK = which("pitchfork")

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })

// A private supervisor: its socket, state and logs live in the test's own
// directory, so no case reaches the person's pitchfork. The path stays short
// because the socket path has a length limit.
let base = ""
let bin = ""
let worlds = 0

const config = (proxyPort: number, webPort: number): string =>
  [
    "[settings.proxy]",
    "enable = true",
    "https = false",
    `port = ${proxyPort}`,
    "",
    "[daemons.web]",
    `run = '${process.execPath} -e "require(\\"node:http\\").createServer((q, s) => s.end()).listen(process.env.PORT)"'`,
    `port = { expect = [${webPort}], bump = true }`,
    "ready_delay = 1",
    "",
    "[daemons.broken]",
    "run = 'sh -c \"echo boom >&2; exit 3\"'",
    "",
  ].join("\n")

const harness: ServicesHarness = {
  setup: async () => {
    const world = join(base, `w${++worlds}`)
    const worktree = join(world, "demo")
    const twin = join(world, "demo-twin")
    const bare = join(world, "bare")
    const proxyPort = await freePort()
    const webPort = await freePort()
    for (const dir of [worktree, twin]) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "pitchfork.toml"), config(proxyPort, webPort))
    }
    mkdirSync(bare, { recursive: true })
    const adapter = pitchfork({ bin })
    return {
      adapter,
      project: "demo",
      worktree,
      twin,
      bare,
      dispose: async () => {
        await adapter.down("demo", worktree)
        await adapter.down("demo", twin)
      },
    }
  },
}

describe.skipIf(PITCHFORK === undefined)("the pitchfork adapter", () => {
  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "gtd-pf-")))
    bin = join(base, "pitchfork")
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        `export PITCHFORK_STATE_DIR='${base}/state'`,
        `export PITCHFORK_LOGS_DIR='${base}/logs'`,
        `export PITCHFORK_CONFIG_DIR='${base}/config'`,
        `exec '${PITCHFORK}' "$@"`,
        "",
      ].join("\n"),
    )
    chmodSync(bin, 0o755)
  })

  afterAll(() => {
    if (base === "") return
    execFileSync(bin, ["supervisor", "stop"], { stdio: "ignore" })
    rmSync(base, { recursive: true, force: true })
  })

  describe("passes the services contract", () => {
    for (const contractCase of servicesContract(harness)) {
      it(contractCase.name, contractCase.run, 60_000)
    }
  })

  it("fails to list a worktree that does not exist with the adapter error shape", async () => {
    await expect(pitchfork({ bin }).list("demo", join(base, "gone"))).rejects.toMatchObject({
      adapter: "services",
      op: "list",
    })
  })
})
