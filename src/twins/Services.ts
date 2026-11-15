import { AdapterError, type Service, type ServicesAdapter } from "../workspace/index.js"
import type { ServicesHarness } from "../workspace-testkit/index.js"

interface Defined {
  readonly url: string | undefined
  /** Why the service fails as it starts; it starts when absent. */
  readonly fails: string | undefined
  running: boolean
  error: string | undefined
}

export interface InMemoryServices {
  readonly adapter: ServicesAdapter
  /** A stopped service of the worktree, which `up` starts or, with `fails`, fails to start. */
  readonly define: (
    worktree: string,
    name: string,
    options?: { readonly url?: string; readonly fails?: string },
  ) => void
  /** A service in the state the adapter reports for it, as if it had got there on its own. */
  readonly report: (worktree: string, service: Service) => void
  /** Every call fails with this message until it is called with `undefined`. */
  readonly unavailable: (message: string | undefined) => void
}

/** The services adapter's in-memory twin: each worktree's services as a table. */
export const inMemoryServices = (): InMemoryServices => {
  const worktrees = new Map<string, Map<string, Defined>>()
  let outage: string | undefined
  const servicesOf = (worktree: string): Map<string, Defined> => {
    let found = worktrees.get(worktree)
    if (found === undefined) worktrees.set(worktree, (found = new Map()))
    return found
  }
  const reachable = (op: string): void => {
    if (outage !== undefined) throw new AdapterError({ adapter: "services", op, message: outage })
  }

  const adapter: ServicesAdapter = {
    list: async (_project, worktree) => {
      reachable("list")
      return [...servicesOf(worktree)].map(([name, s]) => ({
        name,
        url: s.url,
        running: s.running,
        error: s.error,
      }))
    },
    up: async (_project, worktree) => {
      reachable("up")
      const failed: string[] = []
      for (const [name, s] of servicesOf(worktree)) {
        s.running = s.fails === undefined
        s.error = s.fails
        if (s.fails !== undefined) failed.push(name)
      }
      if (failed.length > 0) {
        throw new AdapterError({
          adapter: "services",
          op: "up",
          message: `${failed.join(", ")} did not start`,
        })
      }
    },
    down: async (_project, worktree) => {
      reachable("down")
      for (const s of servicesOf(worktree).values()) s.running = false
    },
  }

  return {
    adapter,
    define: (worktree, name, options = {}) =>
      void servicesOf(worktree).set(name, {
        url: options.url,
        fails: options.fails,
        running: false,
        error: undefined,
      }),
    report: (worktree, { name, url, running, error }) =>
      void servicesOf(worktree).set(name, { url, fails: error, running, error }),
    unavailable: (message) => {
      outage = message
    },
  }
}

/** The contract kit's harness for the twin. */
export const inMemoryServicesHarness: ServicesHarness = {
  setup: async () => {
    const twin = inMemoryServices()
    for (const worktree of ["/workspace/demo", "/workspace/demo.wt/twin"]) {
      twin.define(worktree, "web", { url: "https://web.demo.localhost" })
      twin.define(worktree, "broken", { fails: "exit code 3" })
    }
    return {
      adapter: twin.adapter,
      project: "demo",
      worktree: "/workspace/demo",
      twin: "/workspace/demo.wt/twin",
      bare: "/workspace/demo.wt/bare",
      dispose: async () => {},
    }
  },
}
