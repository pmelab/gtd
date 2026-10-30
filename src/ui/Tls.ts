import { join } from "node:path"
import { Effect, FileSystem } from "effect"
import { UiError, UiHost, UiShell } from "./Ports.js"
import { shellQuote } from "./Quote.js"

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
 * Runs `command(certPath, keyPath)` and reads both PEMs back, so nothing
 * downstream re-reads the filesystem. The scratch dir holds a private key; the
 * host removes it on every exit path.
 */
const issueInScratch = (
  tool: string,
  command: (certPath: string, keyPath: string) => string,
): Effect.Effect<CertPair, UiError, UiShell | UiHost> =>
  Effect.gen(function* () {
    const runner = yield* UiShell
    const host = yield* UiHost
    return yield* host.scratch((dir, read) =>
      runner.bash(command(join(dir, "cert.pem"), join(dir, "key.pem"))).pipe(
        Effect.mapError(
          (e) => new UiError(`gtd ui: could not run ${tool} to issue a certificate: ${e.message}`),
        ),
        Effect.flatMap((outcome) =>
          outcome.status !== 0
            ? Effect.fail(
                new UiError(`gtd ui: ${tool} exited without issuing a certificate`, [
                  `exit status: ${outcome.status ?? "signal"}`,
                  ...outcome.output.trim().split("\n").filter(Boolean),
                ]),
              )
            : Effect.try({
                try: (): CertPair => ({ cert: read("cert.pem"), key: read("key.pem") }),
                catch: (e) =>
                  new UiError(
                    `gtd ui: ${tool} reported success but its output could not be read: ${
                      e instanceof Error ? e.message : String(e)
                    }`,
                  ),
              }),
        ),
      ),
    )
  })

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
): Effect.Effect<CertPair, UiError, UiShell | UiHost> => {
  const subjectAltName =
    request.ip !== undefined ? `IP:${request.ip},DNS:${request.host}` : `DNS:${request.host}`
  return issueInScratch("openssl", (certPath, keyPath) =>
    [
      "openssl req -x509 -newkey rsa:2048 -nodes -days 825",
      `-keyout ${shellQuote(keyPath)}`,
      `-out ${shellQuote(certPath)}`,
      // Accepted, not fixed: `shellQuote` only stops SHELL execution — a
      // `host` containing `/` or `=` reaches openssl as an inert literal
      // but can still confuse openssl's OWN `-subj` parsing (which reads
      // `/`-separated `key=value` pairs). That surfaces as a failed
      // certificate request with a named error below, never code execution.
      `-subj ${shellQuote(`/CN=${request.host}`)}`,
      `-addext ${shellQuote(`subjectAltName=${subjectAltName}`)}`,
      `-addext "extendedKeyUsage=serverAuth"`,
      `-addext "basicConstraints=critical,CA:FALSE"`,
    ].join(" "),
  )
}

/**
 * Obtains a real Tailscale-issued certificate for `domain` via `tailscale
 * cert`, the only URL a real cert can ever match. `--cert-file -`/
 * `--key-file -` cannot be used for both PEMs at once (they'd interleave on
 * one stdout stream), so this writes to a scratch dir, like `generateSelfSignedCert`.
 */
export const obtainTailscaleCert = (
  domain: string,
): Effect.Effect<CertPair, UiError, UiShell | UiHost> =>
  issueInScratch("tailscale cert", (certPath, keyPath) =>
    [
      "tailscale cert",
      `--cert-file ${shellQuote(certPath)}`,
      `--key-file ${shellQuote(keyPath)}`,
      shellQuote(domain),
    ].join(" "),
  )

/**
 * Loads a certificate/key pair a config already names, used as-is — this
 * never shells out to `openssl`, structurally: it takes no `UiShell`.
 * A missing or unreadable path is an Effect failure, not a synchronous
 * throw, naming the offending path.
 */
export const loadCertPair = (
  certPath: string,
  keyPath: string,
): Effect.Effect<CertPair, UiError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const read = (path: string) =>
      fs
        .readFileString(path)
        .pipe(Effect.mapError((e) => new UiError(`gtd ui: could not read ${path}: ${e.message}`)))
    const cert = yield* read(certPath)
    const key = yield* read(keyPath)
    return { cert, key }
  })
