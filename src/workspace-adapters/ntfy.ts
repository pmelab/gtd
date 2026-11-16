import {
  AdapterError,
  type NotificationPriority,
  type NotificationsAdapter,
} from "../workspace/index.js"

export interface NtfyOptions {
  /** The topic to publish to. Anyone who knows it can read it: pick one nobody guesses. */
  readonly topic: string
  /** The ntfy server; default `https://ntfy.sh`. */
  readonly server?: string
  /** An access token, for a protected topic. */
  readonly token?: string
}

// ntfy's own rule for a topic name.
const TOPIC = /^[-_A-Za-z0-9]{1,64}$/
const PRIORITY: Readonly<Record<NotificationPriority, number>> = { high: 4, default: 3, low: 2 }

const failure = (message: string, detail?: unknown): AdapterError =>
  new AdapterError({
    adapter: "notifications",
    op: "publish",
    message,
    ...(detail !== undefined && detail !== "" ? { detail } : {}),
  })

/**
 * The bundled notifications adapter: publishes to an ntfy topic. The message
 * goes as JSON, so a title or body in any language reaches the phone as is.
 */
export const ntfy = (options: NtfyOptions): NotificationsAdapter => {
  if (!TOPIC.test(options.topic)) {
    throw new Error(`ntfy: topic must be 1 to 64 letters, digits, "-" or "_"`)
  }
  const server = (options.server ?? "https://ntfy.sh").replace(/\/+$/, "")
  if (!/^https?:\/\/[^/]/.test(server)) {
    throw new Error(`ntfy: server must be an http(s) URL, not ${JSON.stringify(options.server)}`)
  }
  return {
    publish: async ({ title, body, url, priority }) => {
      let response: Response
      try {
        response = await fetch(`${server}/`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.token !== undefined ? { authorization: `Bearer ${options.token}` } : {}),
          },
          body: JSON.stringify({
            topic: options.topic,
            title,
            message: body,
            priority: PRIORITY[priority],
            ...(url !== undefined ? { click: url } : {}),
          }),
        })
      } catch (error) {
        throw failure(
          `ntfy unreachable at ${server}`,
          error instanceof Error ? error.message : error,
        )
      }
      if (!response.ok) {
        throw failure(`ntfy answered ${response.status}`, await response.text().catch(() => ""))
      }
    },
  }
}
