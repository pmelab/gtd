import { createTRPCReact } from "@trpc/react-query"
import type { AppRouter } from "../serve/Router.js"

/**
 * Typed against `AppRouter` only — no hand-written duplicate of a procedure's
 * input/output shape lives here. A later task calls `trpc.someProcedure.useQuery()`
 * / `.useMutation()`; this file only wires the transport.
 */
export const trpc = createTRPCReact<AppRouter>()

/** Relative to the served origin, so it works regardless of host/port. */
export const TRPC_URL = "/trpc"

/** `serve/Write.ts#WriteResult`'s refusal half, read back off a `writeNote` mutation's error — mirrors `serve/Router.ts#WriteNoteRefusal`'s two fields exactly, kept as a plain type here (never importing `serve/Router.ts`) so this stays a thin client-side shape. */
export interface WriteRefusalInfo {
  readonly reason: "stale-token" | "not-resting" | "file-vanished" | "anchor-unresolved"
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
