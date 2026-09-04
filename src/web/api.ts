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
