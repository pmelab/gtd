import { createTRPCReact } from "@trpc/react-query"
import type { AppRouter } from "../ui/index.js"

/**
 * Typed against `AppRouter` only — no hand-written duplicate of a procedure's
 * input/output shape lives here. A later task calls `trpc.someProcedure.useQuery()`
 * / `.useMutation()`; this file only wires the transport.
 */
export const trpc = createTRPCReact<AppRouter>()

/** Where the server said the page's API is: `gtd ui` serves it at `/trpc`, a workspace gate page under its own path. */
export const trpcUrl = (doc: Document): string =>
  doc.querySelector<HTMLMetaElement>('meta[name="gtd-trpc"]')?.content ?? "/trpc"

/** `ui/Write.ts#WriteResult`'s refusal half, read back off a `writeNote` mutation's error — mirrors `ui/Router.ts#WriteNoteRefusal`'s two fields exactly, kept as a plain type here (never importing `ui/Router.ts`) so this stays a thin client-side shape. `reason` mirrors `ui/Write.ts#WriteRefusalReason` verbatim, including the one reachable-but-not-among-T8's-four value (`note-collision`) — see that type's own doc comment for why it's distinct from `anchor-unresolved`. */
export interface WriteRefusalInfo {
  readonly reason:
    | "stale-token"
    | "not-resting"
    | "file-vanished"
    | "anchor-unresolved"
    | "note-collision"
  readonly moved?: "sha" | "content-hash"
}

/**
 * Reads the four-way typed refusal off a `writeNote` mutation's thrown error
 * — `error.data.writeRefusal`, as `Router.ts`'s `errorFormatter` attaches it
 * — or `undefined` for anything else (a network failure, a malformed-input
 * rejection). Never reads `error.message`: every gtd refusal's message text
 * is for a human reading a log, not for a client to switch on.
 */
export const writeRefusalFrom = (error: unknown): WriteRefusalInfo | undefined => {
  if (typeof error !== "object" || error === null) return undefined
  const data = (error as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return undefined
  const refusal = (data as { writeRefusal?: unknown }).writeRefusal
  if (typeof refusal !== "object" || refusal === null) return undefined
  const reason = (refusal as { reason?: unknown }).reason
  if (typeof reason !== "string") return undefined
  const moved = (refusal as { moved?: unknown }).moved
  if (moved === "sha" || moved === "content-hash") {
    return {
      reason: reason as WriteRefusalInfo["reason"],
      moved,
    }
  }
  return { reason: reason as WriteRefusalInfo["reason"] }
}

/** `ui/ReadSteeringFile.ts#ReadSteeringFileResult`'s refusal half, read back off a `readSteeringFile` query's error — mirrors `WriteRefusalInfo`'s own shape and doc comment. `reason` mirrors `ui/ReadSteeringFile.ts`'s own union verbatim. */
export interface ReadRefusalInfo {
  readonly reason: "file-vanished" | "head-unresolved"
}

/**
 * Reads the typed refusal off a `readSteeringFile` query's thrown error —
 * `error.data.readRefusal`, as `Router.ts`'s `errorFormatter` attaches it —
 * or `undefined` for anything else, exactly mirroring `writeRefusalFrom`.
 */
export const readRefusalFrom = (error: unknown): ReadRefusalInfo | undefined => {
  if (typeof error !== "object" || error === null) return undefined
  const data = (error as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return undefined
  const refusal = (data as { readRefusal?: unknown }).readRefusal
  if (typeof refusal !== "object" || refusal === null) return undefined
  const reason = (refusal as { reason?: unknown }).reason
  if (typeof reason !== "string") return undefined
  return { reason: reason as ReadRefusalInfo["reason"] }
}

/** The reason a Proceed was refused, as `Router.ts`'s `errorFormatter` attaches it; `undefined` for any other error. */
export const proceedRefusalFrom = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined
  const data = (error as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return undefined
  const refusal = (data as { proceedRefusal?: unknown }).proceedRefusal
  if (typeof refusal !== "object" || refusal === null) return undefined
  const message = (refusal as { message?: unknown }).message
  return typeof message === "string" ? message : undefined
}
