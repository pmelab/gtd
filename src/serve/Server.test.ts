import * as https from "node:https"
import * as http from "node:http"
import * as net from "node:net"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client"
import { Effect, Exit, Fiber, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AppRouter } from "./Router.js"

// `resolveBindHost`'s default `pickHost` reaches the real
// `os.networkInterfaces()` — mocked so the "calls through to the real system
// scan by default" test below is deterministic on any machine, tailnet or
// not, rather than depending on this runner having no Tailscale interface.
vi.mock("./Bind.js", () => ({ pickBindHostFromSystem: () => undefined }))

import { GtdError } from "../Commentary.js"
import { CommandRunner } from "../CommandRunner.js"
import { Cwd } from "../Cwd.js"
import type { ServeConfig } from "../ConfigSchema.js"
import { renderQrCode } from "./Qr.js"
import { generateSelfSignedCert, type CertPair } from "./Tls.js"
import {
  HttpsServer,
  resolveBindHost,
  resolveCertPair,
  resolveClientHtml,
  runServeCommand,
} from "./Server.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-serve-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const noCommandRunner = CommandRunner.layer(() =>
  Effect.fail(new Error("CommandRunner unexpectedly invoked")),
)

describe("resolveBindHost", () => {
  it("prefers an explicit --host over everything else", async () => {
    const host = await Effect.runPromise(
      resolveBindHost("1.2.3.4", { host: "9.9.9.9" }, () => "100.90.1.2"),
    )
    expect(host).toBe("1.2.3.4")
  })

  it("falls back to a configured serve.host when --host is absent", async () => {
    const host = await Effect.runPromise(
      resolveBindHost(undefined, { host: "9.9.9.9" }, () => "100.90.1.2"),
    )
    expect(host).toBe("9.9.9.9")
  })

  it("falls back to a Tailscale scan when neither --host nor config.host is given", async () => {
    const host = await Effect.runPromise(resolveBindHost(undefined, undefined, () => "100.90.1.2"))
    expect(host).toBe("100.90.1.2")
  })

  it("calls through to pickBindHostFromSystem by default — the actual integration point, not a duplicate of Bind.test.ts's own unit tests", async () => {
    // No `pickHost` override: exercises the real default parameter
    // (`pickBindHostFromSystem`, mocked above to always return undefined so
    // this is deterministic regardless of the runner's actual network) —
    // proving Server.ts reached that seam rather than short-circuiting.
    const exit = await Effect.runPromiseExit(resolveBindHost(undefined, undefined))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("refuses with a GtdError naming both remedies when no host resolves at all", async () => {
    const thrown = await Effect.runPromise(
      resolveBindHost(undefined, undefined, () => undefined).pipe(Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    expect(thrown.message + thrown.detail.join("\n")).toContain("--host")
    expect(thrown.message + thrown.detail.join("\n")).toMatch(/tailnet|Tailscale/)
  })
})

describe("resolveCertPair", () => {
  it("--self-signed generates a certificate even when serve.cert/serve.key are configured — the explicit flag wins", async () => {
    const config: ServeConfig = { cert: "/some/cert.pem", key: "/some/key.pem" }
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: true, dev: false }, config, "100.90.1.2").pipe(
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.flip,
      ),
    )
    // The fake CommandRunner fails every call — reaching its error proves
    // the self-signed path (not loadCertPair) was taken.
    expect(thrown.message).toContain("CommandRunner unexpectedly invoked")
  })

  it("with a hostname --host (not an IP literal), passes no IP: literal to openssl — only DNS", async () => {
    // openssl's `-addext subjectAltName=IP:...` rejects a non-literal value
    // outright; a hostname `--host` (e.g. "localhost") must not be handed
    // to Tls.ts's `ip` field, only to `host` (DNS).
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      return Effect.succeed({ status: 0, output: "" })
    })
    await Effect.runPromiseExit(
      resolveCertPair({ selfSigned: true, dev: false }, undefined, "localhost").pipe(
        Effect.provide(runner),
        Effect.provide(NodeContext.layer),
      ),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("DNS:localhost")
    expect(commands[0]).not.toContain("IP:localhost")
  })

  it("uses a configured serve.cert/serve.key pair as-is when --self-signed is absent", async () => {
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    const pair = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false, dev: false },
        { cert: certPath, key: keyPath },
        "100.90.1.2",
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer)),
    )
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
    expect(pair.key).toContain("BEGIN PRIVATE KEY")
  })

  it("refuses with a GtdError naming both remedies when neither --self-signed nor a configured pair is given", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: false, dev: false }, undefined, "100.90.1.2").pipe(
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("--self-signed")
    expect(rendered).toMatch(/serve\.cert/)
  })

  it("names the missing half when only serve.cert is configured — not the generic 'no certificate is configured'", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false, dev: false },
        { cert: "/some/cert.pem" },
        "100.90.1.2",
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("serve.key")
    expect(rendered).not.toContain("no certificate is configured")
  })

  it("names the missing half when only serve.key is configured — not the generic 'no certificate is configured'", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false, dev: false },
        { key: "/some/key.pem" },
        "100.90.1.2",
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("serve.cert")
    expect(rendered).not.toContain("no certificate is configured")
  })
})

describe("HttpsServer.Live", () => {
  let cert: CertPair

  beforeEach(async () => {
    cert = await Effect.runPromise(
      generateSelfSignedCert({ host: "127.0.0.1", ip: "127.0.0.1" }).pipe(
        Effect.provide(CommandRunner.Live),
        Effect.provide(Cwd.layer(tmpDir)),
        Effect.provide(NodeContext.layer),
      ),
    )
  })

  it("binds unconditionally as HTTPS — a plain http request to the same port fails, a TLS request succeeds", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* HttpsServer
      }).pipe(Effect.provide(HttpsServer.Live)),
    )

    const bound = await Effect.runPromise(
      service.listen(cert, "127.0.0.1", 0, (_req, res) => {
        res.writeHead(200)
        res.end("ok")
      }),
    )

    try {
      const httpsResult = await new Promise<string>((resolve, reject) => {
        https
          .get({ host: "127.0.0.1", port: bound.port, rejectUnauthorized: false }, (res) => {
            let body = ""
            res.on("data", (chunk) => (body += chunk))
            res.on("end", () => resolve(body))
          })
          .on("error", reject)
      })
      expect(httpsResult).toBe("ok")

      const plainHttpFailed = await new Promise<boolean>((resolve) => {
        const req = http.get({ host: "127.0.0.1", port: bound.port }, () => {
          resolve(false)
        })
        req.on("error", () => resolve(true))
        req.setTimeout(2000, () => {
          req.destroy()
          resolve(true)
        })
      })
      expect(plainHttpFailed).toBe(true)
    } finally {
      bound.close()
    }
  })

  it("refuses with a GtdError naming EADDRINUSE when the port is already bound", async () => {
    const occupied = net.createServer()
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve))
    const address = occupied.address()
    const port = typeof address === "object" && address !== null ? address.port : 0

    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* HttpsServer
      }).pipe(Effect.provide(HttpsServer.Live)),
    )

    const thrown = await Effect.runPromise(
      service.listen(cert, "127.0.0.1", port, () => {}).pipe(Effect.flip),
    )
    occupied.close()

    expect(thrown).toBeInstanceOf(GtdError)
    expect(thrown.message).toContain("already in use")
  })
})

describe("resolveClientHtml", () => {
  it("in production, uses the build-time inlined constant and reads nothing off disk", async () => {
    const explodingFs = FileSystem.makeNoop({
      readFileString: () => Effect.die(new Error("unexpectedly read from disk in production")),
    })
    const runner = { bash: () => Effect.fail(new Error("unexpectedly shelled out in production")) }

    const html = await Effect.runPromise(
      resolveClientHtml(false, runner, explodingFs) as Effect.Effect<string, GtdError>,
    )
    expect(html).toContain("<!doctype html>")
  })

  it("in production, the inlined script has no bare (non-relative) import specifier — every dependency is actually bundled in", async () => {
    // tsdown externalizes every `dependencies` entry by default; a bare
    // `import … from "react"` left in an inlined `<script type="module">`
    // has no import map and nothing served at that path, so the client
    // fails to load in every browser with an empty #root and no visible
    // error on the page itself. This pins `tsdown.config.ts`'s `web` build
    // config actually bundling react/@trpc/*/@tanstack/react-query, not just
    // producing SOME output.
    const explodingFs = FileSystem.makeNoop({
      readFileString: () => Effect.die(new Error("unexpectedly read from disk in production")),
    })
    const runner = { bash: () => Effect.fail(new Error("unexpectedly shelled out in production")) }

    const html = await Effect.runPromise(
      resolveClientHtml(false, runner, explodingFs) as Effect.Effect<string, GtdError>,
    )
    const bareImports = [...html.matchAll(/^\s*import[^;]*\sfrom\s+["']([^"']+)["']/gm)]
      .map((m) => m[1])
      .filter((specifier) => specifier !== undefined && !specifier.startsWith("."))
    expect(bareImports).toEqual([])
  })

  it("in production, the inlined script is exactly one <script> tag — a naive string .replace would expand a literal $& inside the bundle into a stray, script-terminating </script>", async () => {
    // A replacement STRING (not function) treats `$&`/`$'`/`` $` ``/`$$`
    // inside the bundled client JS as replacement-pattern syntax — React's
    // key-escaping calls `.replace(re, "$&/")` twice, which a naive inline
    // step expands into an extra literal `</script>`, truncating the real
    // module script mid-file. A correct inline always has exactly one.
    const explodingFs = FileSystem.makeNoop({
      readFileString: () => Effect.die(new Error("unexpectedly read from disk in production")),
    })
    const runner = { bash: () => Effect.fail(new Error("unexpectedly shelled out in production")) }

    const html = await Effect.runPromise(
      resolveClientHtml(false, runner, explodingFs) as Effect.Effect<string, GtdError>,
    )
    expect(html.match(/<\/script>/g)?.length).toBe(1)
  })

  it("under --dev, rebuilds the client via CommandRunner and reads both files fresh off disk", async () => {
    const readCalls: string[] = []
    const devFs = FileSystem.makeNoop({
      readFileString: (path: string) => {
        readCalls.push(path)
        return path.endsWith("index.html")
          ? Effect.succeed(
              '<!doctype html><body><script type="module" src="./main.js"></script></body>',
            )
          : Effect.succeed("console.log('dev build')")
      },
    })
    const bashCalls: string[] = []
    const runner = {
      bash: (command: string) => {
        bashCalls.push(command)
        return Effect.succeed({ status: 0, output: "" })
      },
    }

    const html = await Effect.runPromise(
      resolveClientHtml(true, runner, devFs) as Effect.Effect<string, GtdError>,
    )
    expect(bashCalls.some((c) => c.includes("tsdown"))).toBe(true)
    expect(readCalls.some((p) => p.endsWith("index.html"))).toBe(true)
    expect(readCalls.some((p) => p.endsWith("main.js"))).toBe(true)
    expect(html).toContain("console.log('dev build')")
    expect(html).not.toContain('src="./main.js"')
  })
})

describe("runServeCommand", () => {
  const fakeOut = () => {
    const written: string[] = []
    return { out: { write: (chunk: string) => written.push(chunk), flush: () => {} }, written }
  }

  it("prints the https:// URL on its own line, then a QR code encoding that exact URL, before blocking", async () => {
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    let closed = false
    const fakeHttpsServer = Layer.succeed(HttpsServer, {
      listen: () => Effect.succeed({ port: 4443, close: () => (closed = true) }),
    })

    const fiber = Effect.runFork(
      runServeCommand(
        { selfSigned: false, dev: false },
        { host: "100.90.1.2", cert: certPath, key: keyPath },
        out,
      ).pipe(
        Effect.provide(fakeHttpsServer),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Cwd.Live),
      ),
    )

    // Give the forked fiber a turn to run past the blocking Effect.never.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(written[0]).toBe("https://100.90.1.2:4443/\n")
    // Pinned against the renderer's own output for the SAME URL just
    // printed above — deterministic, and it fails the moment the URL handed
    // to `renderQrCode` stops matching the one printed on the prior line.
    expect(written[1]).toBe(`${renderQrCode("https://100.90.1.2:4443/")}\n`)
    expect(written.length).toBe(2)

    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(closed).toBe(true)
  })

  it("refuses before ever reaching HttpsServer when no host resolves", async () => {
    const { out } = fakeOut()
    let listenCalled = false
    const fakeHttpsServer = Layer.succeed(HttpsServer, {
      listen: () => {
        listenCalled = true
        return Effect.succeed({ port: 1, close: () => {} })
      },
    })

    const exit = await Effect.runPromiseExit(
      runServeCommand({ selfSigned: false, dev: false }, undefined, out).pipe(
        Effect.provide(fakeHttpsServer),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({} as never)),
        Effect.provide(Cwd.Live),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(listenCalled).toBe(false)
  })
})

/** Awaits `promise`, asserts it rejects with a real `TRPCClientError` (proof the request actually reached the real HTTP adapter and `errorFormatter`, unlike `createCaller` in unit tests elsewhere), and returns its `.data` — the one shape every `*Refusal` assertion below shares. */
const refusalDataFrom = async <T>(promise: Promise<unknown>): Promise<T | undefined> => {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(TRPCClientError)
  return (error as InstanceType<typeof TRPCClientError>).data as T | undefined
}

/** Generates a self-signed cert into `dir`, starts a real `runServeCommand` over a scripted `CommandRunner` (`false` always exits 1 with the given stdout/stderr), and polls for the bound URL `out.write` prints once `HttpsServer.Live` actually binds the ephemeral port. Pulled out of the test itself so ITS OWN complexity is the tRPC assertions, not also this setup. */
const startScriptedServer = async (
  dir: string,
): Promise<{ readonly boundUrl: string; readonly fiber: Fiber.RuntimeFiber<void, unknown> }> => {
  const certPath = join(dir, "cert.pem")
  const keyPath = join(dir, "key.pem")
  const cert = await Effect.runPromise(
    generateSelfSignedCert({ host: "127.0.0.1", ip: "127.0.0.1" }).pipe(
      Effect.provide(CommandRunner.Live),
      Effect.provide(Cwd.layer(dir)),
      Effect.provide(NodeContext.layer),
    ),
  )
  writeFileSync(certPath, cert.cert)
  writeFileSync(keyPath, cert.key)

  const written: string[] = []
  const out = { write: (chunk: string) => written.push(chunk), flush: () => {} }

  const scriptedRunner = CommandRunner.layer(() =>
    Effect.succeed({
      status: 1,
      output: "partial\nline1\nline2\n",
      stdout: "partial\n",
      stderr: "line1\nline2\n",
    }),
  )

  const fiber = Effect.runFork(
    runServeCommand(
      { selfSigned: false, dev: false, port: 0 },
      { host: "127.0.0.1", cert: certPath, key: keyPath, port: 0 },
      out,
    ).pipe(
      Effect.provide(HttpsServer.Live),
      Effect.provide(scriptedRunner),
      Effect.provide(NodeContext.layer),
      Effect.provide(Cwd.Live),
    ),
  )

  for (let i = 0; i < 50; i += 1) {
    if (written[0] !== undefined) return { boundUrl: written[0].trim(), fiber }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("server never printed its bound URL")
}

describe("the tRPC API surface mounted under /trpc", () => {
  it("reaches Router.ts's runCommand through the real HTTPS adapter end-to-end, with a refusal's stdout/stderr/exitCode separately readable and stderr's two lines intact", async () => {
    const { boundUrl, fiber } = await startScriptedServer(tmpDir)

    // Real client dials a real self-signed HTTPS server — accepting that
    // untrusted cert is the only thing disabled here, matching what a phone
    // client does against `gtd serve --self-signed` today.
    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })

      const data = await refusalDataFrom<{
        refusal?: { stdout: string; stderr: string; exitCode: number | null }
      }>(client.runCommand.mutate({ command: "false" }))
      expect(data?.refusal?.stdout).toBe("partial\n")
      expect(data?.refusal?.stderr).toBe("line1\nline2\n")
      expect(data?.refusal?.stderr.split("\n")).toEqual(["line1", "line2", ""])
      expect(data?.refusal?.exitCode).toBe(1)

      // T2's "an unknown mode yields a typed refusal, not an empty screen":
      // `createCaller` (unit tests elsewhere) never runs `errorFormatter` at
      // all, so only a REAL client dialing a REAL server proves
      // `viewRefusal` actually reaches this far, as `writeRefusal` above
      // just did for `runCommand`.
      const viewData = await refusalDataFrom<{ viewRefusal?: { reason: string } }>(
        client.view.query({ mode: "not-a-real-mode", content: "x" }),
      )
      expect(viewData?.viewRefusal?.reason).toBe("unsupported-mode")

      // Same proof for `readSteeringFile`'s own refusal, mirroring
      // `writeRefusal`'s pattern (`src/web/api.ts#writeRefusalFrom`) — there
      // is no `readRefusalFrom` client helper yet, so this is the one place
      // `readRefusal` reaching a real client is pinned at all.
      const readData = await refusalDataFrom<{ readRefusal?: { reason: string } }>(
        client.readSteeringFile.query({
          worktreePath: tmpDir,
          filePath: "does-not-exist.md",
          mode: "qa",
        }),
      )
      expect(readData?.readRefusal?.reason).toBe("file-vanished")
    } finally {
      if (previousTlsReject === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
      else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = previousTlsReject
    }

    await Effect.runPromise(Fiber.interrupt(fiber))
  })
})
