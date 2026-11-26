import type {
  DeviceSubscription,
  NotificationsAdapter,
  WorkspaceSettings,
} from "../workspace/index.js"
import type { AuditLog } from "./Audit.js"
import type { Store } from "./Store.js"

/** Who asks, for the audit line of a subscribe or an unsubscribe. */
interface PushCaller {
  readonly identity: string
  readonly endpoint: string
}

/** The adapter's devices, with the audit log and the endpoints the start line looks for. */
export const pushRoutes = (
  adapter: NotificationsAdapter,
  store: Store,
  audit: AuditLog,
  now: () => string,
) => {
  const written = (caller: PushCaller, action: "subscribe" | "unsubscribe"): void =>
    audit.write({ time: now(), ...caller, action, outcome: "accepted" })
  return {
    publicKey: async () => adapter.publicKey(),
    device: async (endpoint: string) => adapter.device(endpoint),
    subscribe: async (
      caller: PushCaller,
      subscription: DeviceSubscription["subscription"],
      kinds: readonly string[],
      platform?: string,
    ) => {
      await adapter.subscribe({
        subscription,
        kinds: kinds as DeviceSubscription["kinds"],
        login: caller.identity,
        ...(platform !== undefined ? { platform } : {}),
      })
      store.savePushed([...new Set([...store.pushed(), subscription.endpoint])])
      written(caller, "subscribe")
    },
    unsubscribe: async (caller: PushCaller, endpoint: string) => {
      await adapter.unsubscribe(endpoint)
      store.savePushed(store.pushed().filter((e) => e !== endpoint))
      written(caller, "unsubscribe")
    },
    /** The start line: it shows only while no device is subscribed. */
    startLine: async (url: string): Promise<string> => {
      for (const endpoint of store.pushed()) {
        if ((await adapter.device(endpoint)) !== undefined) return ""
      }
      return `notifications: turn on push in the dashboard at ${url}\n`
    },
  }
}

/** Tells an adapter that wants it (`webPush()`, for its VAPID subject) the dashboard URL. */
export const announceUrl = (adapter: NotificationsAdapter, url: string): void => {
  ;(adapter as { serving?: (url: string) => void }).serving?.(url)
}

/** The configured notifications adapter, or the bundled one, after its `init`. */
export const startNotifications = async (
  settings: WorkspaceSettings,
  host: { readonly defaultNotifications: () => NotificationsAdapter },
  stateDirectory: string,
): Promise<NotificationsAdapter> => {
  const adapter = settings.adapters?.notifications ?? host.defaultNotifications()
  await adapter.init({ stateDirectory })
  return adapter
}
