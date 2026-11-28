import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
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
    expect(subjects).toEqual(["mailto:gtd@example.com", "https://gtd.example"])
  })

  it("signs a JWT with a non-loopback sub, the push service as aud and an exp under 24 h", async () => {
    let vapid: Parameters<Send>[2]["vapid"] | undefined
    const adapter = webPush({
      send: async (_s, _p, o) => {
        vapid = o.vapid
      },
    })
    await adapter.init({ stateDirectory: mkdtempSync(join(tmpdir(), "gtd-webpush-")) })
    adapter.serving("http://127.0.0.1:7490/")
    await adapter.subscribe(device("https://push/a"))
    await adapter.publish(note())
    const headers = webpush.getVapidHeaders(
      "https://push.example",
      vapid!.subject,
      vapid!.publicKey,
      vapid!.privateKey,
      "aes128gcm",
    )
    const jwt = /t=([^,]+)/.exec(headers.Authorization)![1]!.split(".")[1]!
    const claims = JSON.parse(Buffer.from(jwt, "base64url").toString())
    expect(claims.sub).toMatch(/^(https:|mailto:)/)
    expect(claims.sub).not.toMatch(/localhost|127\.0\.0\.1/)
    expect(claims.aud).toBe("https://push.example")
    const ahead = claims.exp - Date.now() / 1000
    expect(ahead).toBeGreaterThan(0)
    expect(ahead).toBeLessThan(24 * 60 * 60)
  })

  it("names the subject option when the push service answers 403", async () => {
    const adapter = webPush({
      send: async () => {
        throw Object.assign(new Error("Received unexpected response code"), {
          statusCode: 403,
          body: "BadJwtToken",
        })
      },
    })
    await adapter.init({ stateDirectory: mkdtempSync(join(tmpdir(), "gtd-webpush-")) })
    await adapter.subscribe(device("https://push/a"))
    await expect(adapter.publish(note())).rejects.toThrow(/subject/)
  })

  it("passes a configured subject through unchanged, whatever URL the dashboard serves", async () => {
    const subjects: string[] = []
    const adapter = webPush({
      subject: "mailto:ops@example.com",
      send: async (_s, _p, o) => {
        subjects.push(o.vapid.subject)
      },
    })
    await adapter.init({ stateDirectory: mkdtempSync(join(tmpdir(), "gtd-webpush-")) })
    adapter.serving("https://gtd.example")
    adapter.serving("http://127.0.0.1:7490/")
    await adapter.subscribe(device("https://push/a"))
    await adapter.publish(note())
    expect(subjects).toEqual(["mailto:ops@example.com"])
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

  it("logs host, status and message for a 403, names the device, and keeps it", async () => {
    const { adapter } = await fresh(async (s) => {
      if (s.endpoint.includes("bad"))
        throw Object.assign(new Error("Received unexpected response code"), {
          statusCode: 403,
          body: '{"reason":"BadJwtToken"}',
        })
    })
    await adapter.subscribe({
      ...device("https://web.push.apple.com/bad", "-"),
      platform: "iOS Safari",
    })
    const error = await adapter.publish(note()).then(
      () => undefined,
      (e: unknown) => e as Error,
    )
    expect(error?.message).toContain("iOS Safari")
    expect(error?.message).toContain("web.push.apple.com 403:")
    expect(error?.message).toContain("BadJwtToken")
    expect(error?.message).not.toContain("/bad")
    expect(await adapter.device("https://web.push.apple.com/bad")).toMatchObject({
      platform: "iOS Safari",
      failure: {
        host: "web.push.apple.com",
        status: 403,
        message: expect.stringContaining("BadJwtToken"),
      },
    })
  })

  it("marks a device broken after the same 403 for a day, and stops sending to it", async () => {
    let calls = 0
    const { adapter, dir } = await fresh(async () => {
      calls++
      throw Object.assign(new Error("BadJwtToken"), { statusCode: 403 })
    })
    const endpoint = "https://fcm.googleapis.com/x"
    await adapter.subscribe(device(endpoint))
    await adapter.publish(note()).catch(() => {})
    expect((await adapter.device(endpoint))?.broken).toBeUndefined()
    // Age the first failure by two days.
    const file = join(dir, "devices", readdirSync(join(dir, "devices"))[0]!)
    const record = JSON.parse(readFileSync(file, "utf8"))
    record.failure.since = new Date(Date.now() - 2 * 86_400_000).toISOString()
    writeFileSync(file, JSON.stringify(record))
    await adapter.publish(note()).catch(() => {})
    expect((await adapter.device(endpoint))?.broken).toBe(true)
    await adapter.publish(note())
    expect(calls).toBe(2)
    await adapter.subscribe({ ...device(endpoint), kinds: ["needsYou", "error"] })
    expect((await adapter.device(endpoint))?.broken).toBe(true)
    await adapter.subscribe({
      ...device(endpoint),
      subscription: { endpoint, keys: { p256dh: "k2", auth: "a2" } },
    })
    expect((await adapter.device(endpoint))?.broken).toBeUndefined()
  })

  it("still delivers to a good device when another fails", async () => {
    const reached: string[] = []
    const { adapter } = await fresh(async (s) => {
      if (s.endpoint.endsWith("bad")) throw Object.assign(new Error("no"), { statusCode: 403 })
      reached.push(s.endpoint)
    })
    await adapter.subscribe(device("https://push/bad"))
    await adapter.subscribe(device("https://push/good"))
    await adapter.publish(note()).catch(() => {})
    expect(reached).toEqual(["https://push/good"])
  })
})
