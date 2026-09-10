import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { CommandRunner } from "../CommandRunner.js"
import {
  deleteServeRecord,
  parseServeStatus,
  publishServe,
  readServeRecord,
  unpublishServe,
  writeServeRecord,
} from "./Serve.js"

describe("parseServeStatus", () => {
  it("returns undefined on unparseable JSON", () => {
    expect(parseServeStatus("not json", 443)).toBeUndefined()
  })

  it("returns undefined when there is no serve config at all", () => {
    expect(parseServeStatus(JSON.stringify({}), 443)).toBeUndefined()
  })

  it("returns undefined when no mapping targets the requested port", () => {
    const json = JSON.stringify({
      TCP: { "8443": { HTTPS: true } },
      Web: {
        "host.tailb2e719.ts.net:8443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:9000" } },
        },
      },
    })
    expect(parseServeStatus(json, 443)).toBeUndefined()
  })

  it("returns the hostname and target URL for a mapping on the requested port", () => {
    const json = JSON.stringify({
      TCP: { "443": { HTTPS: true } },
      Web: {
        "host.tailb2e719.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } },
        },
      },
    })
    expect(parseServeStatus(json, 443)).toEqual({
      hostname: "host.tailb2e719.ts.net",
      targetUrl: "http://127.0.0.1:8787",
    })
  })

  // Verbatim capture of `tailscale serve status --json` on a node with one
  // HTTPS mapping published on 443 forwarding to a local dev server. Ground
  // truth for the `Web`/`Handlers`/`Proxy` shape — a future reshape should be
  // checked against this, not another hand-written guess.
  const REAL_CAPTURE = JSON.stringify({
    TCP: {
      "443": {
        HTTPS: true,
      },
    },
    Web: {
      "philipps-macbook-pro-m5.tailb2e719.ts.net:443": {
        Handlers: {
          "/": {
            Proxy: "http://127.0.0.1:8787",
          },
        },
      },
    },
  })

  it("parses the real capture into the expected hostname and target URL", () => {
    expect(parseServeStatus(REAL_CAPTURE, 443)).toEqual({
      hostname: "philipps-macbook-pro-m5.tailb2e719.ts.net",
      targetUrl: "http://127.0.0.1:8787",
    })
  })
})

describe("publishServe", () => {
  it("runs tailscale serve --bg through CommandRunner with the expected flags", async () => {
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      return Effect.succeed({ status: 0, output: "" })
    })
    const result = await Effect.runPromise(
      publishServe({ servePort: 443, targetPort: 8787 }).pipe(Effect.provide(runner)),
    )
    expect(commands).toEqual([
      "tailscale serve --bg --https=443 --set-path=/ 'http://127.0.0.1:8787'",
    ])
    expect(result).toEqual({ ok: true })
  })

  it("yields ok: false with the reason and verbatim stderr, never a failed Effect, on a non-zero exit", async () => {
    const runner = CommandRunner.layer(() =>
      Effect.succeed({
        status: 1,
        output: "starting serve\ntailscale serve: no tailnet HTTPS certs available\n",
        stderr: "tailscale serve: no tailnet HTTPS certs available\n",
      }),
    )
    const result = await Effect.runPromise(
      publishServe({ servePort: 443, targetPort: 8787 }).pipe(Effect.provide(runner)),
    )
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({
      output: "tailscale serve: no tailnet HTTPS certs available\n",
    })
  })
})

describe("unpublishServe", () => {
  it("runs tailscale serve --https=<port> off through CommandRunner", async () => {
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      return Effect.succeed({ status: 0, output: "" })
    })
    const result = await Effect.runPromise(unpublishServe(443).pipe(Effect.provide(runner)))
    expect(commands).toEqual(["tailscale serve --https=443 off"])
    expect(result).toEqual({ ok: true })
  })

  it("yields ok: false, never a failed Effect, on a non-zero exit", async () => {
    const runner = CommandRunner.layer(() =>
      Effect.succeed({ status: 1, output: "", stderr: "no mapping on that port" }),
    )
    const result = await Effect.runPromise(unpublishServe(443).pipe(Effect.provide(runner)))
    expect(result).toEqual({
      ok: false,
      reason: "tailscale serve off exited with status 1",
      output: "no mapping on that port",
    })
  })
})

// A port unlikely to collide with anything a live `gtd ui` run would publish
// a record under, since these tests write/read/delete against the REAL
// `~/.gtd/serve/` directory (there is no injected filesystem for this
// scratch-file record, matching `Tls.ts`'s sync `node:fs` convention).
const testPort = 65535

describe("serve record", () => {
  afterEach(() => {
    deleteServeRecord(testPort)
  })

  it("round-trips: write then read yields the same five fields", () => {
    const record = {
      pid: 12345,
      servePort: testPort,
      targetPort: 54321,
      target: "http://127.0.0.1:54321",
      worktree: "/repo/some-worktree",
    }
    writeServeRecord(testPort, record)
    expect(readServeRecord(testPort)).toEqual(record)
  })

  it("read on a missing file yields undefined rather than throwing", () => {
    expect(readServeRecord(testPort)).toBeUndefined()
  })

  it("writes the record under <base>/.gtd/serve/<servePort>.json, actually creating the parent directory when it's genuinely absent", () => {
    // A fresh mkdtemp dir has no `.gtd/` at all yet — unlike the real
    // `homedir()` these other tests share (already created by an earlier
    // `writeServeRecord` call in the same suite run), so this is the one
    // case that can't pass by coincidence without `mkdirSync`'s own
    // `{ recursive: true }`.
    const base = mkdtempSync(join(tmpdir(), "gtd-serve-base-"))
    try {
      const serveDirPath = join(base, ".gtd", "serve")
      expect(existsSync(serveDirPath)).toBe(false)

      writeServeRecord(
        testPort,
        {
          pid: 1,
          servePort: testPort,
          targetPort: 2,
          target: "http://127.0.0.1:2",
          worktree: "/repo/w",
        },
        base,
      )

      expect(existsSync(join(serveDirPath, `${testPort}.json`))).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("the injected base is a test-only seam — omitting it still resolves against the real homedir()", () => {
    writeServeRecord(testPort, {
      pid: 1,
      servePort: testPort,
      targetPort: 2,
      target: "http://127.0.0.1:2",
      worktree: "/repo/w",
    })
    const path = join(homedir(), ".gtd", "serve", `${testPort}.json`)
    expect(existsSync(path)).toBe(true)
  })

  it("delete removes a written record", () => {
    writeServeRecord(testPort, {
      pid: 1,
      servePort: testPort,
      targetPort: 2,
      target: "http://127.0.0.1:2",
      worktree: "/repo/w",
    })
    deleteServeRecord(testPort)
    expect(readServeRecord(testPort)).toBeUndefined()
  })
})
