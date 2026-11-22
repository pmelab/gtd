import {
  AdapterError,
  type DeviceSubscription,
  type Notification,
  type NotificationsAdapter,
} from "../workspace/index.js"
import type { Delivered, NotificationsHarness } from "../workspace-testkit/index.js"

export interface InMemoryNotifications {
  readonly adapter: NotificationsAdapter
  /** Every notification published, oldest first, whether or not a device wanted it. */
  readonly published: () => readonly Notification[]
  /** What reached each device, oldest first. */
  readonly deliveries: () => readonly Delivered[]
  /** Every publish fails with this message until it is called with `undefined`. */
  readonly unavailable: (message: string | undefined) => void
}

/** The notifications adapter's in-memory twin: the devices it keeps and what it delivered. */
export const inMemoryNotifications = (): InMemoryNotifications => {
  const published: Notification[] = []
  const delivered: Delivered[] = []
  const devices = new Map<string, DeviceSubscription>()
  let outage: string | undefined
  return {
    adapter: {
      init: () => {},
      publicKey: () => "twin-public-key",
      subscribe: (device) => {
        devices.set(device.subscription.endpoint, device)
      },
      unsubscribe: (endpoint) => {
        devices.delete(endpoint)
      },
      device: (endpoint) => {
        const known = devices.get(endpoint)
        return known === undefined ? undefined : { kinds: known.kinds }
      },
      publish: async (notification) => {
        if (outage !== undefined) {
          throw new AdapterError({ adapter: "notifications", op: "publish", message: outage })
        }
        published.push({ ...notification })
        for (const [endpoint, device] of devices) {
          const kind = notification.kind
          if (kind !== "note" && kind !== "reaction" && !device.kinds.includes(kind)) continue
          delivered.push({
            endpoint,
            title: notification.title,
            body: notification.body,
            url: notification.url,
            priority: notification.priority,
          })
        }
      },
    },
    published: () => [...published],
    deliveries: () => [...delivered],
    unavailable: (message) => {
      outage = message
    },
  }
}

/** The contract kit's harness for the twin. */
export const inMemoryNotificationsHarness: NotificationsHarness = {
  setup: async () => {
    const twin = inMemoryNotifications()
    const unreachable = inMemoryNotifications()
    unreachable.unavailable("no route to the phone")
    return {
      adapter: twin.adapter,
      unreachable: unreachable.adapter,
      delivered: async () => twin.deliveries(),
      dispose: async () => {},
    }
  },
}
