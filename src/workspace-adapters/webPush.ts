import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import webpush from "web-push"
import {
  AdapterError,
  type DeviceSubscription,
  type Notification,
  type NotificationPriority,
  type NotificationsAdapter,
} from "../workspace/index.js"

export interface WebPushOptions {
  /** The push call; the default sends through the `web-push` package. */
  readonly send?: (
    subscription: DeviceSubscription["subscription"],
    payload: string,
    options: {
      readonly urgency: "high" | "normal" | "low"
      readonly TTL: number
      readonly vapid: Vapid
    },
  ) => Promise<void>
}

interface Vapid {
  readonly subject: string
  readonly publicKey: string
  readonly privateKey: string
}

interface StoredDevice extends DeviceSubscription {
  readonly time: string
}

const URGENCY: Readonly<Record<NotificationPriority, "high" | "normal" | "low">> = {
  high: "high",
  default: "normal",
  low: "low",
}
const ONE_DAY = 24 * 60 * 60

const failure = (message: string, detail?: unknown): AdapterError =>
  new AdapterError({
    adapter: "notifications",
    op: "publish",
    message,
    ...(detail !== undefined ? { detail } : {}),
  })

const fileOf = (endpoint: string): string =>
  `${createHash("sha256").update(endpoint).digest("hex").slice(0, 32)}.json`

// The tag is the key without its commit, so a newer one replaces the older.
export const tagOf = (key: string): string => {
  const parts = key.split(":")
  return /^[0-9a-f]{40}$/.test(parts[2] ?? "")
    ? [parts[0], parts[1], ...parts.slice(3)].join(":")
    : key
}

/** The bundled notifications adapter: Web Push to the devices that opted in. */
export const webPush = (
  options: WebPushOptions = {},
): NotificationsAdapter & { readonly serving: (url: string) => void } => {
  // The VAPID `sub` claim is the dashboard URL, known once the server listens.
  let subject = "mailto:gtd@localhost"
  let directory: string | undefined
  let vapid: Vapid | undefined
  const send =
    options.send ??
    (async (subscription, payload, o) => {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { ...subscription.keys } },
        payload,
        {
          TTL: o.TTL,
          urgency: o.urgency,
          vapidDetails: {
            subject: o.vapid.subject,
            publicKey: o.vapid.publicKey,
            privateKey: o.vapid.privateKey,
          },
        },
      )
    })

  const state = (): string => {
    if (directory === undefined) throw new Error("webPush: init() was not called")
    return directory
  }
  const devicesDir = (): string => join(state(), "devices")

  const keys = (): Vapid => {
    if (vapid !== undefined) return vapid
    const file = join(state(), "vapid.json")
    let pair: { publicKey: string; privateKey: string }
    try {
      pair = JSON.parse(readFileSync(file, "utf8"))
    } catch {
      pair = webpush.generateVAPIDKeys()
      mkdirSync(state(), { recursive: true, mode: 0o700 })
      writeFileSync(file, JSON.stringify(pair), { mode: 0o600 })
      chmodSync(file, 0o600)
    }
    vapid = { subject, ...pair }
    return vapid
  }

  const records = (): StoredDevice[] => {
    try {
      return readdirSync(devicesDir()).flatMap((name) => {
        try {
          return [JSON.parse(readFileSync(join(devicesDir(), name), "utf8")) as StoredDevice]
        } catch {
          return []
        }
      })
    } catch {
      return []
    }
  }

  // A kind that is off in the config never reaches publish: the supervisor drops it.
  const wants = (device: StoredDevice, n: Notification): boolean =>
    n.kind === "note" || n.kind === "reaction" || device.kinds.includes(n.kind)

  return {
    serving: (url) => {
      // web-push rejects any subject that is not https: or mailto:.
      if (!url.startsWith("https:")) return
      subject = url
      if (vapid !== undefined) vapid = { ...vapid, subject: url }
    },
    init: ({ stateDirectory }) => {
      directory = stateDirectory
      mkdirSync(join(stateDirectory, "devices"), { recursive: true, mode: 0o700 })
      keys()
    },
    publicKey: () => keys().publicKey,
    subscribe: (device) => {
      mkdirSync(devicesDir(), { recursive: true, mode: 0o700 })
      const record: StoredDevice = { ...device, time: new Date().toISOString() }
      writeFileSync(
        join(devicesDir(), fileOf(device.subscription.endpoint)),
        JSON.stringify(record),
        {
          mode: 0o600,
        },
      )
    },
    unsubscribe: (endpoint) => {
      rmSync(join(devicesDir(), fileOf(endpoint)), { force: true })
    },
    device: (endpoint) => {
      const known = records().find((r) => r.subscription.endpoint === endpoint)
      return known === undefined ? undefined : { kinds: known.kinds }
    },
    publish: async (n) => {
      const payload = JSON.stringify({
        title: n.title,
        body: n.body,
        tag: tagOf(n.key),
        ...(n.url !== undefined ? { url: n.url } : {}),
      })
      const failed: string[] = []
      const details: unknown[] = []
      for (const device of records().filter((r) => wants(r, n))) {
        try {
          await send(device.subscription, payload, {
            urgency: URGENCY[n.priority],
            TTL: ONE_DAY,
            vapid: keys(),
          })
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) {
            rmSync(join(devicesDir(), fileOf(device.subscription.endpoint)), { force: true })
            continue
          }
          failed.push(device.login)
          details.push(error instanceof Error ? error.message : error)
        }
      }
      if (failed.length > 0) {
        throw failure(`push failed for ${failed.join(", ")}`, details)
      }
    },
  }
}
