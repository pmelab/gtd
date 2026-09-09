import { X509Certificate } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NodeContext } from "@effect/platform-node"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"
import { CommandRunner } from "../CommandRunner.js"
import { Cwd } from "../Cwd.js"
import { GtdError } from "../Commentary.js"
import { generateSelfSignedCert, loadCertPair } from "./Tls.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-tls-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const runWithLiveOpenssl = <A>(eff: Effect.Effect<A, GtdError, CommandRunner>) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(CommandRunner.Live),
      Effect.provide(Cwd.layer(tmpDir)),
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
    expect(days).toBeLessThanOrEqual(825)
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
        Effect.provide(Cwd.layer(tmpDir)),
        Effect.provide(NodeContext.layer),
      ),
    )
    // The would-be side effect of shell-executing the substitution never
    // happened — proof `host` reached openssl as an inert literal string,
    // never interpreted by bash.
    expect(existsSync(marker)).toBe(false)
    expect(Exit.isFailure(exit)).toBe(true)
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

  const gtdTlsDirs = (): string[] =>
    readdirSync(tmpdir()).filter((name) => name.startsWith("gtd-tls-"))

  it("removes its private-key tmpdir even after openssl reports a non-zero exit", async () => {
    const before = gtdTlsDirs()
    const nonZeroExit = CommandRunner.layer(() =>
      Effect.succeed({ status: 1, output: "openssl: some failure\n" }),
    )
    await Effect.runPromiseExit(
      generateSelfSignedCert({ host: "example.local" }).pipe(Effect.provide(nonZeroExit)),
    )
    expect(gtdTlsDirs()).toEqual(before)
  })

  it("removes its private-key tmpdir even when reading back the issued cert/key fails", async () => {
    const before = gtdTlsDirs()
    // Reports success without actually writing cert.pem/key.pem into the
    // tmpdir generateSelfSignedCert created — the read-back Effect.try fails.
    const liesAboutSuccess = CommandRunner.layer(() => Effect.succeed({ status: 0, output: "" }))
    const exit = await Effect.runPromiseExit(
      generateSelfSignedCert({ host: "example.local" }).pipe(Effect.provide(liesAboutSuccess)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(gtdTlsDirs()).toEqual(before)
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
