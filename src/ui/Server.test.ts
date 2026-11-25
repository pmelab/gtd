import * as https from "node:https"
import * as http from "node:http"
import * as net from "node:net"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseTailscaleStatus, generateSelfSignedCert, type CertPair } from "./index.js"

/**
 * `resolveBindHost`'s default `pickHost` scans the REAL `os.networkInterfaces()`
 * — on a runner joined to a tailnet that scan finds a genuine 100.64.0.0/10
 * address and every "no Tailscale interface" assertion here reds for a reason
 * unrelated to the server. The default `{}` is "no tailnet".
 */
const networkOverride = vi.hoisted(() => ({
  current: {} as NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>,
}))
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return {
    ...actual,
    networkInterfaces: () => networkOverride.current,
  }
})

import { Host, NodeServices } from "../platform/index.js"
import { liveUiHost, UiError, UiShell } from "./index.js"
import { liveUiShell } from "./Ports.fixture.js"
import type { UiConfig } from "./Server.js"
import { UiListener, resolveBindHost, resolveCertPair } from "./Server.js"

let tmpDir: string
let gitDirs: string[]

beforeEach(() => {
  tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "gtd-ui-test-")))
  gitDirs = []
})

afterEach(() => {
  networkOverride.current = {}
  rmSync(tmpDir, { recursive: true, force: true })
  for (const dir of gitDirs) rmSync(dir, { recursive: true, force: true })
})

const noShell = UiShell.layer(() => Effect.fail(new Error("UiShell unexpectedly invoked")))

describe("resolveBindHost", () => {
  it("prefers an explicit --host over everything else", async () => {
    const host = await Effect.runPromise(
      resolveBindHost("1.2.3.4", { host: "9.9.9.9" }, () => "100.90.1.2"),
    )
    expect(host).toBe("1.2.3.4")
  })

  it("falls back to a configured ui.host when --host is absent", async () => {
    const host = await Effect.runPromise(
      resolveBindHost(undefined, { host: "9.9.9.9" }, () => "100.90.1.2"),
    )
    expect(host).toBe("9.9.9.9")
  })

  it("falls back to a Tailscale scan when neither --host nor config.host is given", async () => {
    const host = await Effect.runPromise(resolveBindHost(undefined, undefined, () => "100.90.1.2"))
    expect(host).toBe("100.90.1.2")
  })

  it("refuses with a UiError naming both remedies when no host resolves at all", async () => {
    const thrown = await Effect.runPromise(
      resolveBindHost(undefined, undefined, () => undefined).pipe(Effect.flip),
    )
    expect(thrown).toBeInstanceOf(UiError)
    expect(thrown.message + thrown.detail.join("\n")).toContain("--host")
    expect(thrown.message + thrown.detail.join("\n")).toMatch(/tailnet|Tailscale/)
  })
})

describe("resolveCertPair", () => {
  it("--self-signed generates a certificate even when ui.cert/ui.key are configured — the explicit flag wins", async () => {
    const config: UiConfig = { cert: "/some/cert.pem", key: "/some/key.pem" }
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: true }, config, "100.90.1.2", "100.90.1.2", undefined).pipe(
        Effect.provide(noShell),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
        Effect.flip,
      ),
    )
    // The fake UiShell fails every call — reaching its error proves
    // the self-signed path (not loadCertPair) was taken.
    expect(thrown.message).toContain("UiShell unexpectedly invoked")
  })

  it("with a hostname --host (not an IP literal), passes no IP: literal to openssl — only DNS", async () => {
    // openssl's `-addext subjectAltName=IP:...` rejects a non-literal value
    // outright; a hostname `--host` (e.g. "localhost") must not be handed
    // to Tls.ts's `ip` field, only to `host` (DNS).
    const commands: string[] = []
    const runner = UiShell.layer((command) => {
      commands.push(command)
      return Effect.succeed({ status: 0, output: "" })
    })
    await Effect.runPromiseExit(
      resolveCertPair({ selfSigned: true }, undefined, "localhost", "localhost", undefined).pipe(
        Effect.provide(runner),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
      ),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("DNS:localhost")
    expect(commands[0]).not.toContain("IP:localhost")
  })

  it("with the probe answering a tailnet hostname and no --host, the SAN carries the DISPLAY hostname as DNS: and the bind IP as IP: — never the bind IP as both", async () => {
    // Regression: --self-signed used to receive only bindHost, so a
    // probe-detected hostname URL over an IP bind got a SAN of
    // IP:<bind-ip>,DNS:<bind-ip> while the printed URL said
    // https://<tailnet-hostname>:.../ — a name mismatch on every load.
    const commands: string[] = []
    const runner = UiShell.layer((command) => {
      commands.push(command)
      return Effect.succeed({ status: 0, output: "" })
    })
    await Effect.runPromiseExit(
      resolveCertPair({ selfSigned: true }, undefined, "100.90.1.2", "host.tailnet.ts.net", {
        hostname: "host.tailnet.ts.net",
        certDomains: [],
      }).pipe(
        Effect.provide(runner),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
      ),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("DNS:host.tailnet.ts.net")
    expect(commands[0]).toContain("IP:100.90.1.2")
    expect(commands[0]).not.toContain("DNS:100.90.1.2")
  })

  it("uses a configured ui.cert/ui.key pair as-is when --self-signed is absent", async () => {
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    const pair = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false },
        { cert: certPath, key: keyPath },
        "100.90.1.2",
        "100.90.1.2",
        undefined,
      ).pipe(
        Effect.provide(noShell),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
      ),
    )
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
    expect(pair.key).toContain("BEGIN PRIVATE KEY")
  })

  it("refuses with a UiError naming both remedies when neither --self-signed nor a configured pair is given", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: false }, undefined, "100.90.1.2", "100.90.1.2", undefined).pipe(
        Effect.provide(noShell),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(UiError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("--self-signed")
    expect(rendered).toMatch(/ui\.cert/)
  })

  it("names the missing half when only ui.cert is configured — not the generic 'no certificate is configured'", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false },
        { cert: "/some/cert.pem" },
        "100.90.1.2",
        "100.90.1.2",
        undefined,
      ).pipe(
        Effect.provide(noShell),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(UiError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("ui.key")
    expect(rendered).not.toContain("no certificate is configured")
  })

  it("names the missing half when only ui.key is configured — not the generic 'no certificate is configured'", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false },
        { key: "/some/key.pem" },
        "100.90.1.2",
        "100.90.1.2",
        undefined,
      ).pipe(
        Effect.provide(noShell),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(UiError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("ui.cert")
    expect(rendered).not.toContain("no certificate is configured")
  })

  it("obtains a real tailscale cert for the probed hostname when neither --self-signed nor a configured pair is given, and certDomains is non-empty", async () => {
    const commands: string[] = []
    const runner = UiShell.layer((command) => {
      commands.push(command)
      const certMatch = command.match(/--cert-file '([^']+)'/)
      const keyMatch = command.match(/--key-file '([^']+)'/)
      if (certMatch?.[1]) {
        writeFileSync(
          certMatch[1],
          "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
        )
      }
      if (keyMatch?.[1]) {
        writeFileSync(keyMatch[1], "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      }
      return Effect.succeed({ status: 0, output: "" })
    })
    const pair = await Effect.runPromise(
      resolveCertPair({ selfSigned: false }, undefined, "100.90.1.2", "100.90.1.2", {
        hostname: "host.tailnet.ts.net",
        certDomains: ["host.tailnet.ts.net"],
      }).pipe(
        Effect.provide(runner),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
      ),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("tailscale cert")
    expect(commands[0]).toContain("'host.tailnet.ts.net'")
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
  })

  it("drives the tailscale cert branch from a real `tailscale status --json` shape — proves the branch is reachable, not just the hand-built status object", async () => {
    // Regression for the top-level-vs-Self.CertDomains bug: this parses a
    // real-shaped status payload through parseTailscaleStatus (rather than
    // constructing a TailscaleStatus literal directly, as the other tests in
    // this describe block do) so the test fails against the pre-fix parser,
    // which always produced an empty certDomains and fell through to refusal.
    const realStatus = parseTailscaleStatus(
      JSON.stringify({
        BackendState: "Running",
        CertDomains: ["philipps-macbook-pro-m5.tailb2e719.ts.net"],
        Self: { DNSName: "philipps-macbook-pro-m5.tailb2e719.ts.net." },
      }),
    )
    const commands: string[] = []
    const runner = UiShell.layer((command) => {
      commands.push(command)
      const certMatch = command.match(/--cert-file '([^']+)'/)
      const keyMatch = command.match(/--key-file '([^']+)'/)
      if (certMatch?.[1]) {
        writeFileSync(
          certMatch[1],
          "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
        )
      }
      if (keyMatch?.[1]) {
        writeFileSync(keyMatch[1], "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      }
      return Effect.succeed({ status: 0, output: "" })
    })
    const pair = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false },
        undefined,
        "100.90.1.2",
        "100.90.1.2",
        realStatus,
      ).pipe(
        Effect.provide(runner),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
      ),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("tailscale cert")
    expect(commands[0]).toContain("'philipps-macbook-pro-m5.tailb2e719.ts.net'")
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
  })

  it("falls through to the refusal, naming the Tailscale path, when the probe answered but certDomains is empty", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: false }, undefined, "100.90.1.2", "100.90.1.2", {
        hostname: "host.tailnet.ts.net",
        certDomains: [],
      }).pipe(
        Effect.provide(noShell),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(UiError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("--self-signed")
    expect(rendered).toMatch(/ui\.cert/)
    expect(rendered).toMatch(/tailnet|Tailscale/)
  })

  it("fails outright on a non-zero tailscale cert exit — no fallback to the refusal, no fallback to self-signed", async () => {
    const runner = UiShell.layer(() =>
      Effect.succeed({ status: 1, output: "tailscale cert: rate limited\n" }),
    )
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: false }, undefined, "100.90.1.2", "100.90.1.2", {
        hostname: "host.tailnet.ts.net",
        certDomains: ["host.tailnet.ts.net"],
      }).pipe(
        Effect.provide(runner),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(UiError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).not.toContain("no certificate is configured")
    expect(rendered).toContain("rate limited")
  })
})

describe("UiListener.Live", () => {
  let cert: CertPair

  beforeEach(async () => {
    cert = await Effect.runPromise(
      generateSelfSignedCert({ host: "127.0.0.1", ip: "127.0.0.1" }).pipe(
        Effect.provide(liveUiShell),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        Effect.provide(liveUiHost),
        Effect.provide(NodeServices.layer),
      ),
    )
  })

  it("with tls, behaves exactly as today — a plain http request to the same port fails, a TLS request succeeds", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* UiListener
      }).pipe(Effect.provide(UiListener.Live)),
    )

    const bound = await Effect.runPromise(
      service.listen({
        tls: cert,
        host: "127.0.0.1",
        port: 0,
        handler: () => Promise.resolve(new Response("ok")),
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

  it("with no tls, binds a plain http:// listener that answers a real loopback request", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* UiListener
      }).pipe(Effect.provide(UiListener.Live)),
    )

    const bound = await Effect.runPromise(
      service.listen({
        host: "127.0.0.1",
        port: 0,
        handler: () => Promise.resolve(new Response("plain ok")),
      }),
    )

    try {
      const result = await new Promise<string>((resolve, reject) => {
        http
          .get({ host: "127.0.0.1", port: bound.port }, (res) => {
            let body = ""
            res.on("data", (chunk) => (body += chunk))
            res.on("end", () => resolve(body))
          })
          .on("error", reject)
      })
      expect(result).toBe("plain ok")
    } finally {
      bound.close()
    }
  })

  it("answers a request whose Host header is no valid URL authority, and keeps serving", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* UiListener
      }).pipe(Effect.provide(UiListener.Live)),
    )
    const bound = await Effect.runPromise(
      service.listen({
        host: "127.0.0.1",
        port: 0,
        handler: (request) => Promise.resolve(new Response(new URL(request.url).pathname)),
      }),
    )
    const raw = (head: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = net.connect(bound.port, "127.0.0.1", () =>
          socket.end(`${head}\r\nConnection: close\r\n\r\n`),
        )
        let reply = ""
        socket.on("data", (chunk) => (reply += chunk))
        socket.on("end", () => resolve(reply))
        socket.on("error", reject)
      })
    try {
      expect(await raw("GET /state HTTP/1.1\r\nHost: [")).toMatch(
        /^HTTP\/1\.1 200[\s\S]*\r\n\/state\r\n/,
      )
      expect(await raw("GET http://[ HTTP/1.1\r\nHost: x")).toMatch(/^HTTP\/1\.1 400/)
      expect(await raw("GET /again HTTP/1.1\r\nHost: x")).toMatch(/\r\n\/again\r\n/)
    } finally {
      bound.close()
    }
  })

  it("refuses with a UiError naming EADDRINUSE when the port is already bound", async () => {
    const occupied = net.createServer()
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve))
    const address = occupied.address()
    const port = typeof address === "object" && address !== null ? address.port : 0

    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* UiListener
      }).pipe(Effect.provide(UiListener.Live)),
    )

    const thrown = await Effect.runPromise(
      service
        .listen({
          tls: cert,
          host: "127.0.0.1",
          port,
          handler: () => Promise.resolve(new Response()),
        })
        .pipe(Effect.flip),
    )
    occupied.close()

    expect(thrown).toBeInstanceOf(UiError)
    expect(thrown.message).toContain("already in use")
  })
})
