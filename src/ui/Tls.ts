import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { CommandRunner } from "../CommandRunner.js"
import { GtdError } from "../Commentary.js"
import { singleQuoted } from "./Shell.js"

/** A certificate and its matching private key, as PEM content — never file paths, so callers (the https server, tests) never re-read the filesystem. */
export interface CertPair {
  readonly cert: string
  readonly key: string
}

/**
 * What a generated certificate needs to satisfy iOS's secure-context checks:
 * the SAN must carry the bind IP as an actual IP entry (iOS ignores the CN)
 * and the hostname, for whichever one a client dials. `ip` is OPTIONAL and
 * MUST be an actual IPv4/IPv6 literal, never a hostname — openssl's
 * `-addext subjectAltName=IP:...` rejects a non-literal value outright
 * (`gtd ui --host localhost --self-signed` puts a hostname where the
 * default Tailscale-scan path always puts a literal). Callers with a
 * hostname `--host` pass `ip: undefined`; the SAN then carries DNS only.
 */
export interface SelfSignedCertRequest {
  readonly host: string
  readonly ip?: string
}

/**
 * `node:crypto`'s `X509Certificate` parses certificates and cannot issue one,
 * so this shells out to `openssl`. 825 days is the longest validity iOS
 * accepts for a leaf certificate; the three `-addext` flags are each load-
 * bearing for iOS to trust the leaf at all: SAN carrying the bind IP (not
 * just the CN, which iOS ignores), `serverAuth` extended key usage, and a
 * critical non-CA basic constraint.
 */
export const generateSelfSignedCert = (
  request: SelfSignedCertRequest,
): Effect.Effect<CertPair, GtdError, CommandRunner> =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    const dir = mkdtempSync(join(tmpdir(), "gtd-tls-"))
    const keyPath = join(dir, "key.pem")
    const certPath = join(dir, "cert.pem")
    const subjectAltName =
      request.ip !== undefined ? `IP:${request.ip},DNS:${request.host}` : `DNS:${request.host}`
    const command = [
      "openssl req -x509 -newkey rsa:2048 -nodes -days 825",
      `-keyout ${singleQuoted(keyPath)}`,
      `-out ${singleQuoted(certPath)}`,
      // Accepted, not fixed: `singleQuoted` only stops SHELL execution — a
      // `host` containing `/` or `=` reaches openssl as an inert literal
      // but can still confuse openssl's OWN `-subj` parsing (which reads
      // `/`-separated `key=value` pairs). That surfaces as a failed
      // certificate request with a named error below, never code execution.
      `-subj ${singleQuoted(`/CN=${request.host}`)}`,
      `-addext ${singleQuoted(`subjectAltName=${subjectAltName}`)}`,
      `-addext "extendedKeyUsage=serverAuth"`,
      `-addext "basicConstraints=critical,CA:FALSE"`,
    ].join(" ")

    return yield* runner.bash(command).pipe(
      Effect.mapError(
        (e) => new GtdError(`gtd ui: could not run openssl to issue a certificate: ${e.message}`),
      ),
      Effect.flatMap((outcome) =>
        outcome.status !== 0
          ? Effect.fail(
              new GtdError("gtd ui: openssl exited without issuing a certificate", [
                `exit status: ${outcome.status ?? "signal"}`,
                ...outcome.output.trim().split("\n").filter(Boolean),
              ]),
            )
          : Effect.try({
              try: (): CertPair => ({
                cert: readFileSync(certPath, "utf8"),
                key: readFileSync(keyPath, "utf8"),
              }),
              catch: (e) =>
                new GtdError(
                  `gtd ui: openssl reported success but its output could not be read: ${
                    e instanceof Error ? e.message : String(e)
                  }`,
                ),
            }),
      ),
      // The tmpdir holds the private key (mode 0700, but still on disk) —
      // removed on EVERY exit path (a failed spawn, a non-zero exit, a
      // read-back failure, or success), never only the success path a
      // previous version left it on.
      Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
    )
  })

/**
 * Obtains a real Tailscale-issued certificate for `domain` via `tailscale
 * cert`, the only URL a real cert can ever match. `--cert-file -`/
 * `--key-file -` cannot be used for both PEMs at once (they'd interleave on
 * one stdout stream), so this writes to a temp dir — the same `mkdtempSync`
 * shape `generateSelfSignedCert` uses above — and reads both back as plain
 * strings so the result is a `CertPair` and nothing downstream re-reads the
 * filesystem. The temp dir (it holds a private key) is removed on every exit
 * path via `Effect.ensuring`, mirroring `generateSelfSignedCert`.
 */
export const obtainTailscaleCert = (
  domain: string,
): Effect.Effect<CertPair, GtdError, CommandRunner> =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    const dir = mkdtempSync(join(tmpdir(), "gtd-tls-"))
    const keyPath = join(dir, "key.pem")
    const certPath = join(dir, "cert.pem")
    const command = [
      "tailscale cert",
      `--cert-file ${singleQuoted(certPath)}`,
      `--key-file ${singleQuoted(keyPath)}`,
      singleQuoted(domain),
    ].join(" ")

    return yield* runner.bash(command).pipe(
      Effect.mapError(
        (e) =>
          new GtdError(`gtd ui: could not run tailscale cert to issue a certificate: ${e.message}`),
      ),
      Effect.flatMap((outcome) =>
        outcome.status !== 0
          ? Effect.fail(
              new GtdError("gtd ui: tailscale cert exited without issuing a certificate", [
                `exit status: ${outcome.status ?? "signal"}`,
                ...outcome.output.trim().split("\n").filter(Boolean),
              ]),
            )
          : Effect.try({
              try: (): CertPair => ({
                cert: readFileSync(certPath, "utf8"),
                key: readFileSync(keyPath, "utf8"),
              }),
              catch: (e) =>
                new GtdError(
                  `gtd ui: tailscale cert reported success but its output could not be read: ${
                    e instanceof Error ? e.message : String(e)
                  }`,
                ),
            }),
      ),
      Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
    )
  })

/**
 * Loads a certificate/key pair a config already names, used as-is — this
 * never shells out to `openssl`, structurally: it takes no `CommandRunner`.
 * A missing or unreadable path is an Effect failure, not a synchronous
 * throw, naming the offending path.
 */
export const loadCertPair = (
  certPath: string,
  keyPath: string,
): Effect.Effect<CertPair, GtdError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const read = (path: string) =>
      fs
        .readFileString(path)
        .pipe(Effect.mapError((e) => new GtdError(`gtd ui: could not read ${path}: ${e.message}`)))
    const cert = yield* read(certPath)
    const key = yield* read(keyPath)
    return { cert, key }
  })
