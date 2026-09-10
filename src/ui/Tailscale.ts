import { Effect } from "effect"
import { CommandRunner } from "../CommandRunner.js"

/** What `resolveBindHost`/`resolveCertPair` need out of `tailscale status --json`: a display hostname and the domains a `tailscale cert` call is available for. */
export interface TailscaleStatus {
  readonly hostname: string
  readonly certDomains: readonly string[]
}

/** The subset of `tailscale status --json`'s shape this module reads — everything else in that payload is ignored. */
interface RawTailscaleStatus {
  readonly BackendState?: string
  readonly CertDomains?: readonly string[]
  readonly Self?: {
    readonly DNSName?: string
  }
}

/**
 * Pure parse of `tailscale status --json`'s stdout — never spawns anything,
 * so it's unit-tested directly rather than through the subprocess probe
 * below. `undefined` covers every "detection came back empty" case this
 * package's requirements name: unparseable JSON, a backend that isn't
 * `"Running"`, a missing `Self`, or MagicDNS off (neither `CertDomains` nor
 * `DNSName` gives a name) — each must fall back to today's IP, never fail.
 */
export const parseTailscaleStatus = (json: string): TailscaleStatus | undefined => {
  let parsed: RawTailscaleStatus
  try {
    parsed = JSON.parse(json) as RawTailscaleStatus
  } catch {
    return undefined
  }
  if (parsed.BackendState !== "Running") return undefined
  if (parsed.Self === undefined) return undefined

  const certDomains = parsed.CertDomains ?? []
  const dnsName = parsed.Self.DNSName
  // `CertDomains[0]` is the safer source (no trailing dot); `DNSName` is a
  // fully-qualified DNS root and must be stripped of its trailing dot before
  // it lands in a URL.
  const hostname =
    certDomains[0] ?? (dnsName === undefined ? undefined : dnsName.replace(/\.$/, ""))
  if (hostname === undefined || hostname === "") return undefined

  return { hostname, certDomains }
}

/**
 * Probes the real system via `CommandRunner` (already in `resolveCertPair`'s
 * requirements — no new port). Every empty case — the binary absent from
 * `$PATH`, a spawn failure, a non-zero exit — resolves to `undefined` rather
 * than failing the Effect: detection is a best-effort default, never a
 * reason for `gtd ui` to refuse.
 */
export const probeTailscaleStatus = (): Effect.Effect<
  TailscaleStatus | undefined,
  never,
  CommandRunner
> =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    const outcome = yield* runner
      .bash("tailscale status --json")
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    if (outcome === undefined || outcome.status !== 0) return undefined
    return parseTailscaleStatus(outcome.output)
  })
