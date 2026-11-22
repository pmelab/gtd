/** Why this device cannot get push, or `undefined` when it can. */
export type PushBlock =
  | "Add gtd to your home screen first"
  | "This connection is not trusted"
  | "This browser has no Web Push"

export interface PushEnvironment {
  readonly userAgent: string
  readonly standalone: boolean
  readonly secure: boolean
  readonly hasServiceWorker: boolean
  readonly hasPushManager: boolean
  readonly hasNotification: boolean
}

export const environmentOf = (w: Window): PushEnvironment => ({
  userAgent: w.navigator.userAgent,
  standalone:
    (w.navigator as { standalone?: boolean }).standalone === true ||
    w.matchMedia("(display-mode: standalone)").matches,
  secure: w.isSecureContext,
  hasServiceWorker: "serviceWorker" in w.navigator,
  hasPushManager: "PushManager" in w,
  hasNotification: "Notification" in w,
})

// iPadOS 13+ says it is a Mac; only a touch screen gives it away.
const isIos = (userAgent: string): boolean => /iPhone|iPad|iPod/.test(userAgent)

export const pushBlock = (env: PushEnvironment): PushBlock | undefined => {
  if (isIos(env.userAgent) && !env.standalone) return "Add gtd to your home screen first"
  if (!env.secure) return "This connection is not trusted"
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) {
    return "This browser has no Web Push"
  }
  return undefined
}

/** The VAPID public key as the bytes `PushManager.subscribe` takes. */
export const keyBytes = (key: string): Uint8Array<ArrayBuffer> => {
  const base64 = key
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(key.length / 4) * 4, "=")
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/** The dashboard reloads when the supervisor runs another gtd version than the one that served it. */
export const staleVersion = (own: string | undefined, supervisor: string | undefined): boolean =>
  own !== undefined && own !== "" && supervisor !== undefined && own !== supervisor
