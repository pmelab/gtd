import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { CommandRunner } from "../CommandRunner.js"
import { GtdError } from "../Commentary.js"

/** A certificate and its matching private key, as PEM content — never file paths, so callers (the https server, tests) never re-read the filesystem. */
export interface CertPair {
  readonly cert: string
  readonly key: string
}

/** What a generated certificate needs to satisfy iOS's secure-context checks: the SAN must carry the bind IP as an actual IP entry (iOS ignores the CN) and the hostname, for whichever one a client dials. */
export interface SelfSignedCertRequest {
  readonly host: string
  readonly ip: string
}

/**
 * `node:crypto`'s `X509Certificate` parses certificates and cannot issue one,
 * so this shells out to `openssl`. 825 days is the longest validity iOS
 * accepts for a leaf certificate; the three `-addext` flags are each load-
 * bearing for iOS's Web Speech API secure-context check: SAN carrying the
 * bind IP (not just the CN, which iOS ignores), `serverAuth` extended key
 * usage, and a critical non-CA basic constraint.
 */
export const generateSelfSignedCert = (
  request: SelfSignedCertRequest,
): Effect.Effect<CertPair, GtdError, CommandRunner> =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    const dir = mkdtempSync(join(tmpdir(), "gtd-tls-"))
    const keyPath = join(dir, "key.pem")
    const certPath = join(dir, "cert.pem")
    const command = [
      "openssl req -x509 -newkey rsa:2048 -nodes -days 825",
      `-keyout ${keyPath}`,
      `-out ${certPath}`,
      `-subj "/CN=${request.host}"`,
      `-addext "subjectAltName=IP:${request.ip},DNS:${request.host}"`,
      `-addext "extendedKeyUsage=serverAuth"`,
      `-addext "basicConstraints=critical,CA:FALSE"`,
    ].join(" ")

    const outcome = yield* runner
      .bash(command)
      .pipe(
        Effect.mapError(
          (e) =>
            new GtdError(`gtd serve: could not run openssl to issue a certificate: ${e.message}`),
        ),
      )
    if (outcome.status !== 0) {
      return yield* Effect.fail(
        new GtdError("gtd serve: openssl exited without issuing a certificate", [
          `exit status: ${outcome.status ?? "signal"}`,
          ...outcome.output.trim().split("\n").filter(Boolean),
        ]),
      )
    }

    const pair = yield* Effect.try({
      try: (): CertPair => ({
        cert: readFileSync(certPath, "utf8"),
        key: readFileSync(keyPath, "utf8"),
      }),
      catch: (e) =>
        new GtdError(
          `gtd serve: openssl reported success but its output could not be read: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
    })

    yield* Effect.sync(() => rmSync(dir, { recursive: true, force: true }))
    return pair
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
        .pipe(
          Effect.mapError((e) => new GtdError(`gtd serve: could not read ${path}: ${e.message}`)),
        )
    const cert = yield* read(certPath)
    const key = yield* read(keyPath)
    return { cert, key }
  })
