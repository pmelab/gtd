import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { CommandRunner } from "../CommandRunner.js"
import { singleQuoted } from "./Shell.js"

/** What `parseServeStatus` publishes for a mapping found on the requested port: the tailnet hostname `tailscale serve` bound it to, and the loopback URL it forwards to. */
export interface ServeMapping {
  readonly hostname: string
  readonly targetUrl: string
}

/** The subset of `tailscale serve status --json`'s shape this module reads. `Web` is keyed `"<hostname>:<port>"`; each value's `Handlers["/"].Proxy` is the forwarding target for that mapping. */
interface RawServeStatus {
  readonly Web?: Record<
    string,
    {
      readonly Handlers?: Record<string, { readonly Proxy?: string }>
    }
  >
}

/**
 * Pure parse of `tailscale serve status --json`'s stdout, mirroring
 * `Tailscale.ts#parseTailscaleStatus`'s rule: `undefined` covers every
 * "nothing published here" case — unparseable JSON, no `Web` config at all,
 * or a config whose keys don't carry `servePort` — never a failure to the
 * caller.
 */
export const parseServeStatus = (json: string, servePort: number): ServeMapping | undefined => {
  let parsed: RawServeStatus
  try {
    parsed = JSON.parse(json) as RawServeStatus
  } catch {
    return undefined
  }
  const web = parsed.Web
  if (web === undefined) return undefined

  const suffix = `:${servePort}`
  const entry = Object.entries(web).find(([key]) => key.endsWith(suffix))
  if (entry === undefined) return undefined

  const [hostKey, value] = entry
  const targetUrl = value.Handlers?.["/"]?.Proxy
  if (targetUrl === undefined) return undefined

  return { hostname: hostKey.slice(0, -suffix.length), targetUrl }
}

export interface PublishServeRequest {
  readonly servePort: number
  readonly targetPort: number
}

/** A non-zero `tailscale serve` exit is a VALUE, not an Effect failure — Task 3's fallback path consumes `ok: false` to fall back to a direct bind, so this never fails the Effect on a scripted refusal. */
export type PublishServeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly output: string }

/**
 * Publishes a loopback target on `servePort` via `tailscale serve --bg`,
 * exactly the shape `probeTailscaleStatus`/`obtainTailscaleCert` already use
 * `CommandRunner.bash` for — no new port. `--set-path=/` matches this
 * package's one-mapping-per-instance design (`01-tailscale-serve-front-door.md`).
 */
export const publishServe = (
  request: PublishServeRequest,
): Effect.Effect<PublishServeResult, Error, CommandRunner> =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    const target = `http://127.0.0.1:${request.targetPort}`
    const command = [
      "tailscale serve --bg",
      `--https=${request.servePort}`,
      "--set-path=/",
      singleQuoted(target),
    ].join(" ")

    const outcome = yield* runner.bash(command)
    if (outcome.status !== 0) {
      return {
        ok: false,
        reason: `tailscale serve exited with status ${outcome.status ?? "signal"}`,
        output: outcome.stderr ?? outcome.output,
      }
    }
    return { ok: true }
  })

/**
 * Removes a mapping this instance published, via `tailscale serve --https=<servePort>
 * off` — the teardown half of `publishServe`, same non-zero-exit-is-a-value rule.
 */
export const unpublishServe = (
  servePort: number,
): Effect.Effect<PublishServeResult, Error, CommandRunner> =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    const outcome = yield* runner.bash(`tailscale serve --https=${servePort} off`)
    if (outcome.status !== 0) {
      return {
        ok: false,
        reason: `tailscale serve off exited with status ${outcome.status ?? "signal"}`,
        output: outcome.stderr ?? outcome.output,
      }
    }
    return { ok: true }
  })

/** The ownership record published alongside a live serve mapping, so teardown/orphan-checks touch only a mapping THIS instance published. `worktree` is plumbed through verbatim — the caller (Task 3/4) decides what path it holds. */
export interface ServeRecord {
  readonly pid: number
  readonly servePort: number
  readonly targetPort: number
  readonly target: string
  readonly worktree: string
}

// `~/.gtd/serve/` is the one gtd state directory outside a worktree — there is
// no other, so it's created on demand rather than assumed to pre-exist.
const serveDir = (): string => join(homedir(), ".gtd", "serve")
const serveRecordPath = (servePort: number): string => join(serveDir(), `${servePort}.json`)

/** `undefined` for a missing or unparseable record file — never thrown — matching this package's "empty is not a failure" rule elsewhere. */
export const readServeRecord = (servePort: number): ServeRecord | undefined => {
  const path = serveRecordPath(servePort)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ServeRecord
  } catch {
    return undefined
  }
}

export const writeServeRecord = (servePort: number, record: ServeRecord): void => {
  mkdirSync(serveDir(), { recursive: true })
  writeFileSync(serveRecordPath(servePort), JSON.stringify(record))
}

export const deleteServeRecord = (servePort: number): void => {
  const path = serveRecordPath(servePort)
  if (existsSync(path)) unlinkSync(path)
}
