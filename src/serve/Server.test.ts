import * as https from "node:https"
import * as http from "node:http"
import * as net from "node:net"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { Effect, Exit, Fiber, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { GtdError } from "../Commentary.js"
import { CommandRunner } from "../CommandRunner.js"
import { Cwd } from "../Cwd.js"
import type { ServeConfig } from "../ConfigSchema.js"
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

  it("calls through to the real system scan by default — the actual integration point, not a duplicate of Bind.test.ts's own unit tests", async () => {
    // No `pickHost` override: exercises the real default parameter
    // (`pickBindHostFromSystem`) end to end. This machine's test environment
    // has no Tailscale interface, so the outcome is the refusal — proving
    // Server.ts actually reached the real scan rather than short-circuiting.
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
      ),
    )

    // Give the forked fiber a turn to run past the blocking Effect.never.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(written[0]).toBe("https://100.90.1.2:4443/\n")
    expect(written[1]).toContain("\n")
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
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(listenCalled).toBe(false)
  })
})
