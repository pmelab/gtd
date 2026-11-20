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

describe("the pitchfork adapter's publicPort", () => {
  const listing = (url: string | null): string =>
    JSON.stringify([{ namespace: "p", name: "web", status: "running", url }])

  const urlWith = async (
    reported: string | null,
    publicPort?: number,
  ): Promise<string | undefined> => {
    const dir = mkdtempSync(join(tmpdir(), "pf-"))
    try {
      const fake = join(dir, "pitchfork")
      writeFileSync(fake, `#!/bin/sh\ncat <<'EOF'\n${listing(reported)}\nEOF\n`)
      chmodSync(fake, 0o755)
      const services = await pitchfork({
        bin: fake,
        ...(publicPort === undefined ? {} : { publicPort }),
      }).list("p", dir)
      return services[0]?.url
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it("drops the port when it is the scheme's default", async () => {
    expect(await urlWith("https://web.p.test:8443", 443)).toBe("https://web.p.test")
  })
  it("replaces the port otherwise", async () => {
    expect(await urlWith("https://web.p.test:8443", 9443)).toBe("https://web.p.test:9443")
  })
  it("leaves URLs alone without the option", async () => {
    expect(await urlWith("https://web.p.test:8443")).toBe("https://web.p.test:8443")
  })
  it("leaves a URL without a port alone", async () => {
    expect(await urlWith("https://web.p.test", 9443)).toBe("https://web.p.test")
  })
  it("replaces an explicit default port", async () => {
    expect(await urlWith("http://web.p.test:80", 8080)).toBe("http://web.p.test:8080")
    expect(await urlWith("https://web.p.test:443", 8443)).toBe("https://web.p.test:8443")
  })
  it("drops the port for http with 80", async () => {
    expect(await urlWith("http://web.p.test:8080", 80)).toBe("http://web.p.test")
  })
  it("keeps the path, query and slash", async () => {
    expect(await urlWith("https://h:8443/", 9443)).toBe("https://h:9443/")
    expect(await urlWith("https://h:8443/path?x=1", 9443)).toBe("https://h:9443/path?x=1")
    expect(await urlWith("http://h:1?x", 2)).toBe("http://h:2?x")
  })
  it("leaves an unparsable URL alone", async () => {
    expect(await urlWith("not a url", 9443)).toBe("not a url")
  })
  it("keeps a missing URL missing", async () => {
    expect(await urlWith(null, 443)).toBeUndefined()
  })
  it("rejects an invalid publicPort", () => {
    for (const bad of [0, 65536, 1.5, Number.NaN]) {
      expect(() => pitchfork({ publicPort: bad })).toThrow(/publicPort/)
    }
  })
})
