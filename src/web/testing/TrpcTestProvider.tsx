import { useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TRPCClientError, type TRPCLink } from "@trpc/client"
import { observable } from "@trpc/server/observable"
import type { AppRouter } from "../../serve/Router.js"
import { trpc } from "../api.js"

/**
 * A terminating tRPC link for stories/tests: resolves a `fleet` query from
 * `resolveFleet()` (called once per request, so a story can bump a counter
 * or vary its return value across repeated calls), no HTTP and no real
 * router involved — the real router (`Router.ts` → `Beat.ts` → `Discover.ts`)
 * imports Node built-ins (`node:child_process`, `node:fs`) that don't exist
 * in the browser this story actually runs in.
 */
const mockFleetLink = (resolveFleet: () => unknown): TRPCLink<AppRouter> => {
  return () =>
    ({ op }) =>
      observable((observer) => {
        if (op.path !== "fleet") {
          observer.error(TRPCClientError.from(new Error(`no mock configured for "${op.path}"`)))
          return
        }
        observer.next({ result: { type: "data", data: resolveFleet() } })
        observer.complete()
      })
}

/**
 * Wraps `children` in the same `trpc.Provider`/`QueryClientProvider` nesting
 * `main.tsx` sets up for the real app, over the mock link above — so a story
 * can render `Fleet` (the container, not just `FleetView`) and prove a real
 * `useQuery`/`refetch` round-trip actually happens.
 */
export const TrpcTestProvider = ({
  resolveFleet,
  children,
}: {
  readonly resolveFleet: () => unknown
  readonly children: ReactNode
}) => {
  const [queryClient] = useState(() => new QueryClient())
  const [client] = useState(() => trpc.createClient({ links: [mockFleetLink(resolveFleet)] }))
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}
