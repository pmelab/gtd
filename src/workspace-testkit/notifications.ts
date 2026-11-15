import {
  isAdapterFailure,
  type Notification,
  type NotificationPriority,
  type NotificationsAdapter,
} from "../workspace/index.js"
import type { ContractCase } from "./index.js"

/** A notification as the person's device got it. */
export interface Delivered {
  readonly title: string
  readonly body: string
  readonly url: string | undefined
  readonly priority: NotificationPriority
}

/**
 * A fresh world for one case. `adapter` delivers to a destination that
 * `delivered` reads back; `unreachable` is the same adapter aimed at a
 * destination that takes nothing.
 */
export interface NotificationsFixture {
  readonly adapter: NotificationsAdapter
  readonly unreachable: NotificationsAdapter
  /** What reached the destination, oldest first. */
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

const notification = (overrides: Partial<Notification>): Notification => ({
  key: "needsYou:portal/login:0123456789abcdef0123456789abcdef01234567",
  title: "portal/login needs you",
  body: "Review the plan",
  url: "https://workspace.example.ts.net/portal/login/gate",
  priority: "high",
  ...overrides,
})

const deliveredAs = async (
  fixture: NotificationsFixture,
  sent: readonly Notification[],
): Promise<void> => {
  const got = await fixture.delivered()
  const want = sent.map(({ title, body, url, priority }) => ({ title, body, url, priority }))
  const shown = (list: readonly Delivered[]) =>
    JSON.stringify(list.map(({ title, body, url, priority }) => ({ title, body, url, priority })))
  if (shown(got) !== shown(want)) fail(`delivered ${shown(got)}, expected ${shown(want)}`)
}

/** The cases every notifications adapter passes, bundled or userland. */
export const notificationsContract = (harness: NotificationsHarness): readonly ContractCase[] => [
  {
    name: "publish() delivers the title, the body, the URL and each priority",
    run: withFixture(harness, async (fixture) => {
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
      const sent = notification({ url: undefined, priority: "default" })
      await fixture.adapter.publish(sent)
      await deliveredAs(fixture, [sent])
    }),
  },
  {
    name: "publish() delivers hostile text unchanged",
    run: withFixture(harness, async (fixture) => {
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
    name: "publish() to an unreachable destination fails with the adapter error shape",
    run: withFixture(harness, async (fixture) => {
      const failure = await fixture.unreachable.publish(notification({})).then(
        () => fail("publish() to an unreachable destination resolved"),
        (error: unknown) => error,
      )
      if (!isAdapterFailure(failure)) {
        fail(`publish() failed with ${String(failure)}, not { adapter, op, message, detail }`)
      }
      const { adapter, op } = failure as { adapter: string; op: string }
      if (adapter !== "notifications" || op !== "publish") {
        fail(`it failed as { adapter: "${adapter}", op: "${op}" }, not notifications/publish`)
      }
    }),
  },
]
