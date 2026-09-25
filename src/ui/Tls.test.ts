import { X509Certificate } from "node:crypto"
import * as fs from "node:fs"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NodeContext } from "@effect/platform-node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Effect, Exit } from "effect"
import { CommandRunner } from "../CommandRunner.js"
import { Host } from "../platform/index.js"
import { GtdError } from "../Commentary.js"
import { generateSelfSignedCert, loadCertPair, obtainTailscaleCert } from "./Tls.js"

// `{ spy: true }` keeps every real `node:fs` implementation (a plain
// `vi.spyOn(fs, "mkdtempSync")` below throws — Node's ESM module namespace
// isn't configurable, so only a `vi.mock`-registered module can be spied on)
// while still letting `withTrackedTlsTmpDir` wrap ONE export for the
// duration of one run.
vi.mock("node:fs", { spy: true })

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-tls-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/**
 * Runs `run`, capturing the exact `gtd-tls-*` directory `mkdtempSync` creates
 * during it — by spying on the real `node:fs` export, the same shared module
 * instance `Tls.ts`'s own `mkdtempSync` import resolves to, and calling
 * through to the real implementation. A bare before/after directory-listing
 * diff over the whole OS tmpdir is racy under vitest's default file
 * parallelism: a SIBLING test file (`Server.test.ts` shells out to a real
 * `openssl`/`tailscale` flow too) can create its own `gtd-tls-*` dir there
 * during this test's own window, failing an assertion this test never
 * caused. Tracking the one path THIS run created sidesteps that entirely.
 */
const withTrackedTlsTmpDir = async (run: () => Promise<unknown>): Promise<string> => {
  const realMkdtempSync = fs.mkdtempSync
  let created: string | undefined
  const spy = vi.spyOn(fs, "mkdtempSync").mockImplementation((...args: [string, unknown?]) => {
    const dir = realMkdtempSync(...(args as Parameters<typeof fs.mkdtempSync>))
    created = dir as string
    return dir
  })
  try {
    await run()
  } finally {
    spy.mockRestore()
  }
  if (created === undefined) throw new Error("mkdtempSync was never called during this run")
  return created
}

const runWithLiveOpenssl = <A>(eff: Effect.Effect<A, GtdError, CommandRunner>) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(CommandRunner.Live),
      Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      Effect.provide(NodeContext.layer),
    ),
  )

describe("generateSelfSignedCert", () => {
  it("produces a certificate whose extended key usage names TLS server authentication", async () => {
    const { cert } = await runWithLiveOpenssl(
      generateSelfSignedCert({ host: "example.local", ip: "192.168.1.5" }),
    )
    const x509 = new X509Certificate(cert)
    // Node's X509Certificate has no friendly-name getter for Extended Key
    // Usage — `.keyUsage` (despite the name) returns the EKU OID list, and
    // 1.3.6.1.5.5.7.3.1 is id-kp-serverAuth, i.e. "TLS Web Server
    // Authentication" in openssl's own `-text` rendering.
    expect(x509.keyUsage).toContain("1.3.6.1.5.5.7.3.1")
  })

  it("carries the bind IP in the SAN as an IP entry, not only a DNS name", async () => {
    const { cert } = await runWithLiveOpenssl(
      generateSelfSignedCert({ host: "example.local", ip: "192.168.1.5" }),
    )
    const x509 = new X509Certificate(cert)
    expect(x509.subjectAltName).toContain("IP Address:192.168.1.5")
    expect(x509.subjectAltName).toContain("DNS:example.local")
  })

  it("with ip omitted (a non-literal --host, e.g. a hostname), the SAN carries DNS only — no rejected IP: literal", async () => {
    // openssl's `-addext subjectAltName=IP:...` rejects a non-literal value
    // outright ("Error Loading command line extensions"); a caller with a
    // hostname `--host` must omit `ip` rather than pass the hostname there.
    const { cert } = await runWithLiveOpenssl(generateSelfSignedCert({ host: "example.local" }))
    const x509 = new X509Certificate(cert)
    expect(x509.subjectAltName).toContain("DNS:example.local")
    expect(x509.subjectAltName).not.toContain("IP Address:")
  })

  it("issues a certificate valid for 825 days or fewer", async () => {
    const { cert } = await runWithLiveOpenssl(
      generateSelfSignedCert({ host: "example.local", ip: "192.168.1.5" }),
    )
    const x509 = new X509Certificate(cert)
    const days =
      (new Date(x509.validTo).getTime() - new Date(x509.validFrom).getTime()) /
      (24 * 60 * 60 * 1000)
    // `openssl req -days 825` computes `notBefore`/`notAfter` from two
    // separate reads of the system clock — under load (e.g. the full `npm
    // test` run, many processes contending for CPU during RSA key
    // generation) they can straddle a whole-second boundary, so the span
    // lands a couple of SECONDS past the exact 825*86400s mark, not because
    // the issued validity window is actually longer. Rounding to the
    // nearest whole day absorbs that sub-day jitter while still catching a
    // real regression (e.g. `-days 826`, a whole day off).
    expect(Math.round(days)).toBeLessThanOrEqual(825)
  })

  it("also returns the matching private key, parseable by node:crypto", async () => {
    const { cert, key } = await runWithLiveOpenssl(
      generateSelfSignedCert({ host: "example.local", ip: "192.168.1.5" }),
    )
    expect(cert).toContain("BEGIN CERTIFICATE")
    expect(key).toContain("PRIVATE KEY")
  })

  it("T1: a .gtdrc-supplied ui.host containing a command substitution never executes it — real openssl, just a failed certificate request", async () => {
    const marker = join(tmpDir, "pwned")
    const exit = await Effect.runPromiseExit(
      generateSelfSignedCert({ host: `$(touch ${marker})` }).pipe(
        Effect.provide(CommandRunner.Live),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        Effect.provide(NodeContext.layer),
      ),
    )
    // The would-be side effect of shell-executing the substitution never
    // happened — proof `host` reached openssl as an inert literal string,
    // never interpreted by bash.
    expect(existsSync(marker)).toBe(false)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("T1: a host containing a slash confuses openssl's own -subj parsing — a named GtdError, never code execution", async () => {
    // Accepted, not fixed (Tls.ts's own comment at the `-subj` line):
    // `singleQuoted` stops the SHELL from ever seeing a real `/`, but
    // openssl's `-subj "/CN=..."` itself reads `/`-separated `key=value`
    // pairs, so a host containing `/` (or `=`) still confuses openssl's OWN
    // parser. Real openssl, no fake CommandRunner — this must fail with a
    // GtdError, not hang, not throw uncaught, and never execute anything.
    const thrown = await Effect.runPromise(
      generateSelfSignedCert({ host: "exa/mple.local" }).pipe(
        Effect.provide(CommandRunner.Live),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        Effect.provide(NodeContext.layer),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(GtdError)
  })

  it("fails naming the openssl binary when the spawn reports a non-zero exit (e.g. absent)", async () => {
    const missingOpenssl = CommandRunner.layer(() =>
      Effect.succeed({ status: 127, output: "bash: openssl: command not found\n" }),
    )
    const thrown = await Effect.runPromise(
      generateSelfSignedCert({ host: "example.local", ip: "192.168.1.5" }).pipe(
        Effect.provide(missingOpenssl),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    expect(thrown.message).toContain("openssl")
  })

  it("removes its private-key tmpdir even after openssl reports a non-zero exit", async () => {
    const nonZeroExit = CommandRunner.layer(() =>
      Effect.succeed({ status: 1, output: "openssl: some failure\n" }),
    )
    const created = await withTrackedTlsTmpDir(() =>
      Effect.runPromiseExit(
        generateSelfSignedCert({ host: "example.local" }).pipe(Effect.provide(nonZeroExit)),
      ),
    )
    expect(existsSync(created)).toBe(false)
  })

  it("removes its private-key tmpdir even when reading back the issued cert/key fails", async () => {
    // Reports success without actually writing cert.pem/key.pem into the
    // tmpdir generateSelfSignedCert created — the read-back Effect.try fails.
    const liesAboutSuccess = CommandRunner.layer(() => Effect.succeed({ status: 0, output: "" }))
    let exit: Exit.Exit<unknown, unknown> | undefined
    const created = await withTrackedTlsTmpDir(async () => {
      exit = await Effect.runPromiseExit(
        generateSelfSignedCert({ host: "example.local" }).pipe(Effect.provide(liesAboutSuccess)),
      )
    })
    expect(Exit.isFailure(exit!)).toBe(true)
    expect(existsSync(created)).toBe(false)
  })
})

describe("obtainTailscaleCert", () => {
  /** Extracts the `--cert-file`/`--key-file` paths a real `tailscale cert` would be given, and fakes writing PEM content there — mirrors the `--cert-file -`/`--key-file -` constraint the doc comment names: two files, never one interleaved stream. */
  const fakeCertFile = (command: string, flag: "--cert-file" | "--key-file"): string => {
    const match = command.match(new RegExp(`${flag} '([^']+)'`))
    if (!match?.[1]) throw new Error(`fake tailscale cert: no ${flag} in command: ${command}`)
    return match[1]
  }

  it("shells out to `tailscale cert <domain>`, writing both PEMs to a temp dir and reading them back as a CertPair", async () => {
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      writeFileSync(
        fakeCertFile(command, "--cert-file"),
        "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
      )
      writeFileSync(
        fakeCertFile(command, "--key-file"),
        "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
      )
      return Effect.succeed({ status: 0, output: "" })
    })
    const pair = await Effect.runPromise(
      obtainTailscaleCert("host.tailnet.ts.net").pipe(Effect.provide(runner)),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("tailscale cert")
    expect(commands[0]).toContain("'host.tailnet.ts.net'")
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
    expect(pair.key).toContain("BEGIN PRIVATE KEY")
  })

  it("fails naming tailscale cert's own output on a non-zero exit — no fallback", async () => {
    const runner = CommandRunner.layer(() =>
      Effect.succeed({ status: 1, output: "tailscale cert: access denied\n" }),
    )
    const thrown = await Effect.runPromise(
      obtainTailscaleCert("host.tailnet.ts.net").pipe(Effect.provide(runner), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    expect(thrown.message).toContain("tailscale cert")
    expect(thrown.detail.join("\n")).toContain("access denied")
  })

  it("removes its private-key tmpdir even after a non-zero exit", async () => {
    const runner = CommandRunner.layer(() => Effect.succeed({ status: 1, output: "denied" }))
    const created = await withTrackedTlsTmpDir(() =>
      Effect.runPromiseExit(
        obtainTailscaleCert("host.tailnet.ts.net").pipe(Effect.provide(runner)),
      ),
    )
    expect(existsSync(created)).toBe(false)
  })

  it("removes its private-key tmpdir even when reading back the issued cert/key fails", async () => {
    const liesAboutSuccess = CommandRunner.layer(() => Effect.succeed({ status: 0, output: "" }))
    let exit: Exit.Exit<unknown, unknown> | undefined
    const created = await withTrackedTlsTmpDir(async () => {
      exit = await Effect.runPromiseExit(
        obtainTailscaleCert("host.tailnet.ts.net").pipe(Effect.provide(liesAboutSuccess)),
      )
    })
    expect(Exit.isFailure(exit!)).toBe(true)
    expect(existsSync(created)).toBe(false)
  })

  it("fails naming tailscale on a spawn failure (binary absent)", async () => {
    const missingTailscale = CommandRunner.layer(() =>
      Effect.fail(new Error("spawn tailscale ENOENT")),
    )
    const thrown = await Effect.runPromise(
      obtainTailscaleCert("host.tailnet.ts.net").pipe(
        Effect.provide(missingTailscale),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    expect(thrown.message).toContain("tailscale")
  })
})

describe("loadCertPair", () => {
  it("uses a config-provided certificate and key as-is, without invoking openssl", async () => {
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    // No CommandRunner is provided at all — loadCertPair's own type never
    // requires it, so it structurally cannot shell out to openssl.
    const pair = await Effect.runPromise(
      loadCertPair(certPath, keyPath).pipe(Effect.provide(NodeContext.layer)),
    )
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
    expect(pair.key).toContain("BEGIN PRIVATE KEY")
  })

  it("refuses with a GtdError, not an uncaught throw, when the certificate path is missing", async () => {
    const certPath = join(tmpDir, "does-not-exist-cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    const exit = await Effect.runPromiseExit(
      loadCertPair(certPath, keyPath).pipe(Effect.provide(NodeContext.layer)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    const thrown = await Effect.runPromise(
      loadCertPair(certPath, keyPath).pipe(Effect.provide(NodeContext.layer), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    expect(thrown.message).toContain(certPath)
  })

  it("refuses with a GtdError when the key path is missing", async () => {
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "does-not-exist-key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")

    const thrown = await Effect.runPromise(
      loadCertPair(certPath, keyPath).pipe(Effect.provide(NodeContext.layer), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    expect(thrown.message).toContain(keyPath)
  })
})
