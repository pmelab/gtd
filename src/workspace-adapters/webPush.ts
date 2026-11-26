import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import webpush from "web-push"
import {
  AdapterError,
  type DeviceState,
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
  readonly failure?: NonNullable<DeviceState["failure"]>
  readonly broken?: boolean
}

// Statuses that a retry never fixes: the subscription or the VAPID key is wrong.
const PERMANENT = new Set([400, 401, 403])
const BROKEN_AFTER_MS = 24 * 60 * 60 * 1000

const hostOf = (endpoint: string): string => {
  try {
    return new URL(endpoint).host
  } catch {
    return "unknown"
  }
}

const isBroken = (status: number | undefined, since: string, now: Date): boolean =>
  status !== undefined &&
  PERMANENT.has(status) &&
  now.getTime() - Date.parse(since) >= BROKEN_AFTER_MS

const deviceName = (device: StoredDevice): string =>
  [device.login === "-" ? "" : device.login, device.platform ?? ""]
    .filter((x) => x !== "")
    .join(" ") || "-"

// web-push keeps the push service's reason in `body`; its message is fixed.
const messageOf = (error: unknown): string => {
  const base = error instanceof Error ? error.message : String(error)
  const body = (error as { body?: unknown }).body
  const reason = typeof body === "string" ? body.trim().slice(0, 200) : ""
  return reason === "" ? base : `${base} ${reason}`
}

/** Stores the failure on the device, marks it broken once a permanent status persists, and names it for the error. */
const recordFailure = (
  device: StoredDevice,
  error: unknown,
  save: (device: StoredDevice) => void,
): string => {
  const status = (error as { statusCode?: number }).statusCode
  const host = hostOf(device.subscription.endpoint)
  const message = messageOf(error)
  const now = new Date()
  const same = device.failure?.status === (status ?? null)
  const since = same ? device.failure!.since : now.toISOString()
  const broken = same && isBroken(status, since, now)
  save({
    ...device,
    failure: { host, status: status ?? null, message, since },
    ...(broken ? { broken: true } : {}),
  })
  return `${deviceName(device)} (${host} ${status ?? "no status"}: ${message})`
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
      mkdirSync(join(stateDirectory, "devices"), {
        recursive: true,
        mode: 0o700,
      })
      keys()
    },
    publicKey: () => keys().publicKey,
    subscribe: (device) => {
      mkdirSync(devicesDir(), { recursive: true, mode: 0o700 })
      const file = join(devicesDir(), fileOf(device.subscription.endpoint))
      // A kinds change is not a new subscription: keep the failure state.
      const known = records().find((r) => r.subscription.endpoint === device.subscription.endpoint)
      const same =
        known !== undefined &&
        known.subscription.keys.p256dh === device.subscription.keys.p256dh &&
        known.subscription.keys.auth === device.subscription.keys.auth
      const record: StoredDevice = {
        ...device,
        time: new Date().toISOString(),
        ...(same && known.failure !== undefined ? { failure: known.failure } : {}),
        ...(same && known.broken === true ? { broken: true } : {}),
      }
      writeFileSync(file, JSON.stringify(record), {
        mode: 0o600,
      })
    },
    unsubscribe: (endpoint) => {
      rmSync(join(devicesDir(), fileOf(endpoint)), { force: true })
    },
    device: (endpoint) => {
      const known = records().find((r) => r.subscription.endpoint === endpoint)
      if (known === undefined) return undefined
      return {
        kinds: known.kinds,
        ...(known.platform !== undefined ? { platform: known.platform } : {}),
        ...(known.failure !== undefined ? { failure: known.failure } : {}),
        ...(known.broken === true ? { broken: true } : {}),
      }
    },
    publish: async (n) => {
      const payload = JSON.stringify({
        title: n.title,
        body: n.body,
        tag: tagOf(n.key),
        ...(n.url !== undefined ? { url: n.url } : {}),
      })
      const failed: string[] = []
      const save = (device: StoredDevice): void =>
        writeFileSync(
          join(devicesDir(), fileOf(device.subscription.endpoint)),
          JSON.stringify(device),
          {
            mode: 0o600,
          },
        )
      for (const device of records().filter((r) => r.broken !== true && wants(r, n))) {
        try {
          await send(device.subscription, payload, {
            urgency: URGENCY[n.priority],
            TTL: ONE_DAY,
            vapid: keys(),
          })
          if (device.failure !== undefined) {
            const { failure: _failure, ...healthy } = device
            save(healthy)
          }
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) {
            rmSync(join(devicesDir(), fileOf(device.subscription.endpoint)), {
              force: true,
            })
            continue
          }
          failed.push(recordFailure(device, error, save))
        }
      }
      if (failed.length > 0) {
        throw failure(`push failed for ${failed.join(", ")}`)
      }
    },
  }
}
