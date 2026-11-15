import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { httpBatchLink } from "@trpc/client"
import { StrictMode, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { trpc, trpcUrl } from "./api.js"
import { App } from "./App.js"
import { isDashboard, workspaceTrpc } from "./workspace/api.js"
import { Dashboard } from "./workspace/Dashboard.js"

/** Server state goes through React Query; the tRPC link is created once per app instance and points at the API path the server put in the page. */
const queryClient = new QueryClient()
const link = httpBatchLink({ url: trpcUrl(document) })

/** One client serves both pages: `gtd workspace`'s dashboard, and a gate page. */
const page = (): ReactNode => {
  if (isDashboard(document)) {
    const client = workspaceTrpc.createClient({ links: [link] })
    return (
      <workspaceTrpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Dashboard />
        </QueryClientProvider>
      </workspaceTrpc.Provider>
    )
  }
  const client = trpc.createClient({ links: [link] })
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  )
}

const container = document.getElementById("root")
if (container) {
  createRoot(container).render(<StrictMode>{page()}</StrictMode>)
}
