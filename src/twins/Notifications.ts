import { AdapterError, type Notification, type NotificationsAdapter } from "../workspace/index.js"
import type { NotificationsHarness } from "../workspace-testkit/index.js"

export interface InMemoryNotifications {
  readonly adapter: NotificationsAdapter
  /** Every notification delivered, oldest first. */
  readonly published: () => readonly Notification[]
  /** Every publish fails with this message until it is called with `undefined`. */
  readonly unavailable: (message: string | undefined) => void
}

/** The notifications adapter's in-memory twin: a list of what it delivered. */
export const inMemoryNotifications = (): InMemoryNotifications => {
  const published: Notification[] = []
  let outage: string | undefined
  return {
    adapter: {
      publish: async (notification) => {
        if (outage !== undefined) {
          throw new AdapterError({ adapter: "notifications", op: "publish", message: outage })
        }
        published.push({ ...notification })
      },
    },
    published: () => [...published],
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
      delivered: async () => twin.published(),
      dispose: async () => {},
    }
  },
}
