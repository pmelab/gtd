import { useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TRPCClientError, type TRPCLink } from "@trpc/client"
import { observable } from "@trpc/server/observable"
import type { AppRouter } from "../../ui/Router.js"
import { trpc } from "../api.js"

/**
 * A terminating tRPC link for stories/tests: resolves any of `resolvers`' own
 * procedure paths (each called once per request, with the input, so a story
 * can bump a counter, vary its return value across repeated calls, or read
 * off `input` to answer differently per hunk/anchor), no HTTP and no real
 * router involved — the real router (`Router.ts` → `Beat.ts`) imports Node
 * built-ins (`node:child_process`, `node:fs`) that don't exist in the
 * browser this story actually runs in. A resolver that THROWS is
 * translated into a real `observer.error` — a mutation-failure story
 * (`Review.stories.tsx`'s "reverts on a refused write") throws to simulate a
 * `CONFLICT` refusal, so `mutateAsync`'s own promise rejects exactly like it
 * would against the real router.
 */
const mockLink = (
  resolvers: Readonly<Record<string, (input: unknown) => unknown>>,
): TRPCLink<AppRouter> => {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const resolve = resolvers[op.path]
        if (resolve === undefined) {
          observer.error(TRPCClientError.from(new Error(`no mock configured for "${op.path}"`)))
          return
        }
        try {
          observer.next({ result: { type: "data", data: resolve(op.input) } })
          observer.complete()
        } catch (error) {
          observer.error(
            TRPCClientError.from(error instanceof Error ? error : new Error(String(error))),
          )
        }
      })
}

/**
 * Wraps `children` in the same `trpc.Provider`/`QueryClientProvider` nesting
 * `main.tsx` sets up for the real app, over the mock link above — so a story
 * can render a real tRPC-backed container (`Plan`, `Review`, …) and prove a
 * real `useQuery`/`refetch` round-trip actually happens. `resolvers` is the
 * one escape hatch, for any procedure path (`step`, `view`, `diff`, …) a
 * story needs to mock, keyed by the SAME path string `AppRouter`'s own
 * procedure is registered under.
 */
export const TrpcTestProvider = ({
  resolvers = {},
  children,
}: {
  readonly resolvers?: Readonly<Record<string, (input: unknown) => unknown>>
  readonly children: ReactNode
}) => {
  const [queryClient] = useState(() => new QueryClient())
  const [client] = useState(() => trpc.createClient({ links: [mockLink(resolvers)] }))
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}
