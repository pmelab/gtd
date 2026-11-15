import type { UiHandler } from "./Ports.js"

/**
 * How requests reach the listener, which decides where the tailnet identity
 * comes from (ADR 0014): `serve` reads the header `tailscaled` sets, `direct`
 * asks `tailscale whois` about the peer address, and `proxy` (`--http`)
 * trusts the local proxy to have checked it already.
 */
export type Exposure = "serve" | "direct" | "proxy"

export interface GuardOptions {
  readonly exposure: Exposure
  /** The tailnet logins allowed in; `undefined` when they cannot be known (no `ui.users`, no node owner). */
  readonly users: () => Promise<readonly string[] | undefined>
  /** The tailnet login of the peer at `address`, `undefined` when it has none. */
  readonly whois: (address: string) => Promise<string | undefined>
}

const refuse = (status: number, message: string): Response =>
  new Response(`${message}\n`, { status, headers: { "content-type": "text/plain" } })

const identityOf = async (
  options: GuardOptions,
  request: Request,
  peer: string | undefined,
): Promise<string | undefined> => {
  if (options.exposure === "serve") {
    return request.headers.get("tailscale-user-login") ?? undefined
  }
  return peer === undefined ? undefined : options.whois(peer)
}

const isJson = (request: Request): boolean =>
  (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() ===
  "application/json"

const originMatches = (request: Request): boolean => {
  const origin = request.headers.get("origin")
  if (origin === null) return false
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  return [request.headers.get("host"), request.headers.get("x-forwarded-host")].includes(originHost)
}

const isSameOrigin = (request: Request): boolean =>
  request.headers.get("sec-fetch-site") === "same-origin" || originMatches(request)

const isAllowed = async (
  options: GuardOptions,
  request: Request,
  peer: string | undefined,
): Promise<boolean> => {
  if (options.exposure === "proxy") return true
  const [identity, users] = await Promise.all([identityOf(options, request, peer), options.users()])
  return identity !== undefined && (users ?? []).includes(identity)
}

const methodRefusal = (request: Request): Response | undefined => {
  if (request.method === "GET" || request.method === "HEAD") return undefined
  if (request.method !== "POST") return refuse(405, "gtd ui: only GET and POST are allowed")
  if (!isJson(request)) return refuse(415, "gtd ui: a POST needs a JSON content type")
  if (!isSameOrigin(request)) return refuse(403, "gtd ui: a cross-site POST is refused")
  return undefined
}

/** Why `request` must not reach the handler, or `undefined` when it may. */
const refusalFor = async (
  options: GuardOptions,
  request: Request,
  peer: string | undefined,
): Promise<Response | undefined> =>
  (await isAllowed(options, request, peer))
    ? methodRefusal(request)
    : refuse(403, "gtd ui: this tailnet identity is not in ui.users")

/**
 * Every request needs an allowed tailnet identity; every state change is a
 * same-origin JSON POST. A GET passes, because no GET changes state: tRPC
 * serves a mutation over POST only.
 */
export const guard =
  (options: GuardOptions, handler: UiHandler): UiHandler =>
  async (request, afterResponse, peer) =>
    (await refusalFor(options, request, peer)) ?? handler(request, afterResponse, peer)
