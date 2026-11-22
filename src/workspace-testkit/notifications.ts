import {
  isAdapterFailure,
  type DeviceKind,
  type DeviceSubscription,
  type Notification,
  type NotificationPriority,
  type NotificationsAdapter,
} from "../workspace/index.js"
import type { ContractCase } from "./index.js"

/** A notification as a device got it. */
export interface Delivered {
  readonly endpoint: string
  readonly title: string
  readonly body: string
  readonly url: string | undefined
  readonly priority: NotificationPriority
}

/**
 * A fresh world for one case. `adapter` is initialised and delivers to devices
 * that `delivered` reads back; `unreachable` is the same adapter aimed at a
 * push service that takes nothing.
 */
export interface NotificationsFixture {
  readonly adapter: NotificationsAdapter
  readonly unreachable: NotificationsAdapter
  /** What reached the devices, oldest first. */
  readonly delivered: () => Promise<readonly Delivered[]>
  readonly dispose: () => Promise<void>
}

export interface NotificationsHarness {
  readonly setup: () => Promise<NotificationsFixture>
}

const fail = (message: string): never => {
  throw new Error(message)
}

const withFixture =
  (harness: NotificationsHarness, body: (fixture: NotificationsFixture) => Promise<void>) =>
  async (): Promise<void> => {
    const fixture = await harness.setup()
    try {
      await body(fixture)
    } finally {
      await fixture.dispose()
    }
  }

const ALL: readonly DeviceKind[] = [
  "needsYou",
  "error",
  "proposed",
  "feedFailing",
  "configError",
  "mainStale",
]

const device = (
  endpoint: string,
  kinds: readonly DeviceKind[] = ALL,
  login = "me@example.com",
): DeviceSubscription => ({
  subscription: { endpoint, keys: { p256dh: "BPk", auth: "auth" } },
  kinds,
  login,
})

const notification = (overrides: Partial<Notification>): Notification => ({
  key: "needsYou:portal/login:0123456789abcdef0123456789abcdef01234567",
  kind: "needsYou",
  title: "portal/login needs you",
  body: "Review the plan",
  url: "https://workspace.example.ts.net/?worktree=%2Fhome%2Fme%2Fportal%2Flogin",
  priority: "high",
  ...overrides,
})

const shown = (list: readonly Delivered[]): string =>
  JSON.stringify(list.map(({ title, body, url, priority }) => ({ title, body, url, priority })))

const deliveredAs = async (
  fixture: NotificationsFixture,
  sent: readonly Notification[],
): Promise<void> => {
  const got = await fixture.delivered()
  const want = sent.map(({ title, body, url, priority }) => ({ title, body, url, priority }))
  if (shown(got) !== JSON.stringify(want))
    fail(`delivered ${shown(got)}, expected ${JSON.stringify(want)}`)
}

const titles = async (fixture: NotificationsFixture, endpoint: string): Promise<string[]> =>
  (await fixture.delivered()).filter((d) => d.endpoint === endpoint).map((d) => d.title)

/** The cases every notifications adapter passes, bundled or userland. */
export const notificationsContract = (harness: NotificationsHarness): readonly ContractCase[] => [
  {
    name: "publicKey() returns a key after init()",
    run: withFixture(harness, async (fixture) => {
      const key = await fixture.adapter.publicKey()
      if (typeof key !== "string" || key === "") fail("publicKey() returned no key")
    }),
  },
  {
    name: "device() is undefined for an endpoint it does not know",
    run: withFixture(harness, async (fixture) => {
      if ((await fixture.adapter.device("https://push.example/none")) !== undefined) {
        fail("device() knew an endpoint nobody subscribed")
      }
    }),
  },
  {
    name: "subscribe() keeps the device with its kinds, and unsubscribe() forgets it",
    run: withFixture(harness, async (fixture) => {
      const endpoint = "https://push.example/a"
      await fixture.adapter.subscribe(device(endpoint, ["error"]))
      const known = await fixture.adapter.device(endpoint)
      if (JSON.stringify(known?.kinds) !== JSON.stringify(["error"])) {
        fail(`device() answered ${JSON.stringify(known)}, expected kinds ["error"]`)
      }
      await fixture.adapter.unsubscribe(endpoint)
      if ((await fixture.adapter.device(endpoint)) !== undefined) {
        fail("device() still knew the endpoint after unsubscribe()")
      }
    }),
  },
  {
    name: "subscribe() with a known endpoint replaces the old record",
    run: withFixture(harness, async (fixture) => {
      const endpoint = "https://push.example/a"
      await fixture.adapter.subscribe(device(endpoint, ["error"]))
      await fixture.adapter.subscribe(device(endpoint, ["needsYou", "proposed"]))
      const known = await fixture.adapter.device(endpoint)
      if (JSON.stringify(known?.kinds) !== JSON.stringify(["needsYou", "proposed"])) {
        fail(`device() answered ${JSON.stringify(known)}, expected the new kinds`)
      }
      await fixture.adapter.publish(notification({}))
      if ((await fixture.delivered()).length !== 1) fail("a replaced device got more than one push")
    }),
  },
  {
    name: "publish() delivers the title, the body, the URL and each priority",
    run: withFixture(harness, async (fixture) => {
      await fixture.adapter.subscribe(device("https://push.example/a"))
      const sent = (["high", "default", "low"] as const).map((priority) =>
        notification({ key: `k-${priority}`, title: `a ${priority} one`, priority }),
      )
      for (const n of sent) await fixture.adapter.publish(n)
      await deliveredAs(fixture, sent)
    }),
  },
  {
    name: "publish() without a URL delivers no URL",
    run: withFixture(harness, async (fixture) => {
      await fixture.adapter.subscribe(device("https://push.example/a"))
      const sent = notification({ url: undefined, priority: "default" })
      await fixture.adapter.publish(sent)
      await deliveredAs(fixture, [sent])
    }),
  },
  {
    name: "publish() delivers hostile text unchanged",
    run: withFixture(harness, async (fixture) => {
      await fixture.adapter.subscribe(device("https://push.example/a"))
      const sent = notification({
        title: `über "deploy" $(rm -rf ~) \`id\` ; 'x'`,
        body: "line one\nline two: <b>ä</b> & %s ${HOME} 🚀",
        url: "https://workspace.example.ts.net/?worktree=%2Fhome%2Fme%2Fportal%20x&a=b",
      })
      await fixture.adapter.publish(sent)
      await deliveredAs(fixture, [sent])
    }),
  },
  {
    name: "publish() sends a worktree kind only to the devices that ticked it, and a note or reaction to every device",
    run: withFixture(harness, async (fixture) => {
      await fixture.adapter.subscribe(device("https://push.example/a", ["error"]))
      await fixture.adapter.subscribe(device("https://push.example/b", ["needsYou"]))
      await fixture.adapter.publish(notification({ kind: "needsYou", title: "needs" }))
      await fixture.adapter.publish(notification({ kind: "note", title: "a note" }))
      await fixture.adapter.publish(notification({ kind: "reaction", title: "a reaction" }))
      const a = JSON.stringify(await titles(fixture, "https://push.example/a"))
      const b = JSON.stringify(await titles(fixture, "https://push.example/b"))
      if (a !== JSON.stringify(["a note", "a reaction"])) fail(`device a got ${a}`)
      if (b !== JSON.stringify(["needs", "a note", "a reaction"])) fail(`device b got ${b}`)
    }),
  },
  {
    name: "publish() to an unreachable destination fails with the adapter error shape",
    run: withFixture(harness, async (fixture) => {
      await fixture.unreachable.subscribe(device("https://push.example/a"))
      const failure = await fixture.unreachable.publish(notification({})).catch((e: unknown) => e)
      const shape = isAdapterFailure(failure)
        ? `${failure.adapter}/${failure.op}`
        : `${String(failure)}, not { adapter, op, message, detail }`
      if (shape !== "notifications/publish") fail(`publish() failed as ${shape}`)
    }),
  },
]
