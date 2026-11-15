import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { httpBatchLink } from "@trpc/client"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { trpc, trpcUrl } from "./api.js"
import { App } from "./App.js"

/** Server state goes through React Query; the tRPC link is created once per app instance and points at the API path the server put in the page. */
const queryClient = new QueryClient()
const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: trpcUrl(document) })] })

const container = document.getElementById("root")
if (container) {
  createRoot(container).render(
    <StrictMode>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </trpc.Provider>
    </StrictMode>,
  )
}
