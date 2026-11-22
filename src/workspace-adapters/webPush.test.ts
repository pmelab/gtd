import { mkdtempSync, rmSync, statSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import webpush from "web-push"
import type { DeviceSubscription, Notification } from "../workspace/index.js"
import {
  notificationsContract,
  type Delivered,
  type NotificationsHarness,
} from "../workspace-testkit/index.js"
import { tagOf, webPush, type WebPushOptions } from "./webPush.js"

type Send = NonNullable<WebPushOptions["send"]>
interface Sent {
  readonly endpoint: string
  readonly payload: { title: string; body: string; url?: string; tag: string }
  readonly urgency: string
  readonly TTL: number
}

const harness: NotificationsHarness = {
  setup: async () => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-webpush-"))
    const sent: Sent[] = []
    const record: Send = async (subscription, payload, o) => {
      sent.push({
        endpoint: subscription.endpoint,
        payload: JSON.parse(payload),
        urgency: o.urgency,
        TTL: o.TTL,
      })
    }
    const adapter = webPush({ send: record })
    const unreachable = webPush({
      send: async () => {
        throw new Error("no route to the push service")
      },
    })
    await adapter.init({ stateDirectory: dir })
    await unreachable.init({
      stateDirectory: mkdtempSync(join(tmpdir(), "gtd-webpush-")),
    })
    const priorities = { high: "high", normal: "default", low: "low" } as const
    return {
      adapter,
      unreachable,
      delivered: async (): Promise<readonly Delivered[]> =>
        sent.map((s) => ({
          endpoint: s.endpoint,
          title: s.payload.title,
          body: s.payload.body,
          url: s.payload.url,
          priority: priorities[s.urgency as keyof typeof priorities],
        })),
      dispose: async () => rmSync(dir, { recursive: true, force: true }),
    }
  },
}

const device = (endpoint: string, login = "me@example.com"): DeviceSubscription => ({
  subscription: { endpoint, keys: { p256dh: "k", auth: "a" } },
  kinds: ["needsYou"],
  login,
})

const note = (overrides: Partial<Notification> = {}): Notification => ({
  key: "needsYou:portal/login:0123456789abcdef0123456789abcdef01234567",
  kind: "needsYou",
  title: "t",
  body: "b",
  url: "https://w/",
  priority: "high",
  ...overrides,
})

const fresh = async (send: Send) => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-webpush-"))
  const adapter = webPush({ send })
  await adapter.init({ stateDirectory: dir })
  return { adapter, dir }
}

describe("webPush()", () => {
  describe("passes the notifications contract", () => {
    for (const contractCase of notificationsContract(harness)) {
      it(contractCase.name, contractCase.run)
    }
  })

  it("keeps the VAPID key pair in the state directory with mode 0600, and reuses it", async () => {
    const { adapter, dir } = await fresh(async () => {})
    const key = await adapter.publicKey()
    expect(statSync(join(dir, "vapid.json")).mode & 0o777).toBe(0o600)
    const again = webPush()
    await again.init({ stateDirectory: dir })
    expect(await again.publicKey()).toBe(key)
  })

  it("keeps each device in the state directory, so a new state directory means opting in again", async () => {
    const { adapter, dir } = await fresh(async () => {})
    await adapter.subscribe(device("https://push/a"))
    expect(readdirSync(join(dir, "devices"))).toHaveLength(1)
    const reopened = webPush()
    await reopened.init({ stateDirectory: dir })
    expect(await reopened.device("https://push/a")).toEqual({
      kinds: ["needsYou"],
    })
    const other = webPush()
    await other.init({
      stateDirectory: mkdtempSync(join(tmpdir(), "gtd-webpush-")),
    })
    expect(await other.device("https://push/a")).toBeUndefined()
  })

  it("maps the priority to the urgency, with a TTL of one day and a tag without the commit", async () => {
    const sent: Sent[] = []
    const { adapter } = await fresh(async (s, payload, o) => {
      sent.push({
        endpoint: s.endpoint,
        payload: JSON.parse(payload),
        urgency: o.urgency,
        TTL: o.TTL,
      })
    })
    await adapter.subscribe(device("https://push/a"))
    for (const priority of ["high", "default", "low"] as const) {
      await adapter.publish(note({ priority }))
    }
    expect(sent.map((s) => s.urgency)).toEqual(["high", "normal", "low"])
    expect(sent.every((s) => s.TTL === 86_400)).toBe(true)
    expect(sent[0]!.payload.tag).toBe("needsYou:portal/login")
  })

  it("keeps a VAPID subject web-push accepts when the dashboard serves plain http", async () => {
    const subjects: string[] = []
    const { adapter } = await fresh(async (_s, _p, o) => {
      // The real check: web-push throws on a subject that is not https: or mailto:.
      webpush.getVapidHeaders(
        "https://push",
        o.vapid.subject,
        o.vapid.publicKey,
        o.vapid.privateKey,
        "aes128gcm",
      )
      subjects.push(o.vapid.subject)
    })
    await adapter.subscribe(device("https://push/a"))
    adapter.serving("http://127.0.0.1:4000")
    await adapter.publish(note())
    adapter.serving("https://gtd.example")
    await adapter.publish(note())
    expect(subjects).toEqual(["mailto:gtd@localhost", "https://gtd.example"])
  })

  it("keeps a key without a commit as its tag", () => {
    expect(tagOf("feedFailing:board")).toBe("feedFailing:board")
  })

  it("deletes a device the push service answers 404 or 410 for, with no error", async () => {
    const { adapter } = await fresh(async (s) => {
      throw Object.assign(new Error("gone"), {
        statusCode: s.endpoint.endsWith("a") ? 404 : 410,
      })
    })
    await adapter.subscribe(device("https://push/a"))
    await adapter.subscribe(device("https://push/b"))
    await adapter.publish(note())
    expect(await adapter.device("https://push/a")).toBeUndefined()
    expect(await adapter.device("https://push/b")).toBeUndefined()
  })

  it("tries every device, then fails once with the logins of the failed devices", async () => {
    const tried: string[] = []
    const { adapter } = await fresh(async (s) => {
      tried.push(s.endpoint)
      if (s.endpoint !== "https://push/ok")
        throw Object.assign(new Error("boom"), { statusCode: 500 })
    })
    await adapter.subscribe(device("https://push/x", "ann@example.com"))
    await adapter.subscribe(device("https://push/ok", "bob@example.com"))
    await adapter.subscribe(device("https://push/y", "cy@example.com"))
    const error = await adapter.publish(note()).then(
      () => undefined,
      (e: unknown) => e as Error,
    )
    expect(tried).toHaveLength(3)
    expect(error?.message).toContain("ann@example.com")
    expect(error?.message).toContain("cy@example.com")
    expect(error?.message).not.toContain("bob@example.com")
  })
})
