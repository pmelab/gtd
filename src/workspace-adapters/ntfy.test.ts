import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { NotificationPriority } from "../workspace/index.js"
import {
  notificationsContract,
  type Delivered,
  type NotificationsHarness,
} from "../workspace-testkit/index.js"
import { ntfy } from "./ntfy.js"

const which = (command: string): string | undefined => {
  try {
    return execFileSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).trim()
  } catch {
    return undefined
  }
}

const NTFY = which("ntfy")

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })

const PRIORITIES: Readonly<Record<number, NotificationPriority>> = {
  4: "high",
  3: "default",
  2: "low",
}

interface Message {
  readonly event: string
  readonly title?: string
  readonly message?: string
  readonly click?: string
  readonly priority?: number
}

describe("ntfy()", () => {
  it("refuses a topic that ntfy does not take", () => {
    expect(() => ntfy({ topic: "" })).toThrow(/topic/)
    expect(() => ntfy({ topic: "a/b" })).toThrow(/topic/)
  })

  it("refuses a server that is no http(s) URL", () => {
    expect(() => ntfy({ topic: "gtd-x", server: "ntfy.sh" })).toThrow(/server/)
  })
})

// A private server on a free port: no case reaches ntfy.sh.
describe.skipIf(NTFY === undefined)("ntfy() against a private ntfy server", () => {
  let server: ChildProcess | undefined
  let base = ""
  let url = ""

  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), "gtd-ntfy-"))
    const config = join(base, "server.yml")
    writeFileSync(config, "")
    const port = await freePort()
    url = `http://127.0.0.1:${port}`
    server = spawn(NTFY!, ["serve", "-c", config, "--listen-http", `127.0.0.1:${port}`], {
      stdio: "ignore",
    })
    for (let tries = 0; tries < 100; tries++) {
      if (
        await fetch(`${url}/v1/health`).then(
          (r) => r.ok,
          () => false,
        )
      )
        return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error("the private ntfy server did not start")
  }, 20_000)

  afterAll(() => {
    server?.kill()
    rmSync(base, { recursive: true, force: true })
  })

  const harness: NotificationsHarness = {
    setup: async () => {
      const topic = `gtd-test-${randomBytes(6).toString("hex")}`
      const closed = await freePort()
      return {
        adapter: ntfy({ server: url, topic }),
        unreachable: ntfy({ server: `http://127.0.0.1:${closed}`, topic }),
        delivered: async () => {
          const response = await fetch(`${url}/${topic}/json?poll=1`)
          const lines = (await response.text()).split("\n").filter((line) => line !== "")
          return lines
            .map((line) => JSON.parse(line) as Message)
            .filter((m) => m.event === "message")
            .map(
              (m): Delivered => ({
                title: m.title ?? "",
                body: m.message ?? "",
                url: m.click,
                priority: PRIORITIES[m.priority ?? 3] ?? "default",
              }),
            )
        },
        dispose: async () => {},
      }
    },
  }

  describe("passes the notifications contract", () => {
    for (const contractCase of notificationsContract(harness)) {
      it(contractCase.name, contractCase.run)
    }
  })
})
