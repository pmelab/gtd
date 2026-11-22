import { describe, expect, it } from "vitest"
import { keyBytes, pushBlock, staleVersion, type PushEnvironment } from "./push.js"

const ok: PushEnvironment = {
  userAgent: "Mozilla/5.0 (X11; Linux) Chrome",
  standalone: false,
  secure: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
}
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"

describe("pushBlock", () => {
  it("allows a trusted browser with Web Push", () => {
    expect(pushBlock(ok)).toBeUndefined()
  })
  it("asks an iPhone outside the home screen to add gtd first", () => {
    expect(pushBlock({ ...ok, userAgent: iphone, hasPushManager: false })).toBe(
      "Add gtd to your home screen first",
    )
  })
  it("allows an iPhone from the home screen", () => {
    expect(pushBlock({ ...ok, userAgent: iphone, standalone: true })).toBeUndefined()
  })
  it("refuses a connection that is not trusted", () => {
    expect(pushBlock({ ...ok, secure: false })).toBe("This connection is not trusted")
  })
  it("names a browser without Web Push", () => {
    expect(pushBlock({ ...ok, hasPushManager: false })).toBe("This browser has no Web Push")
  })
})

describe("staleVersion", () => {
  it("is true only when both versions are known and differ", () => {
    expect(staleVersion("1.0.0", "2.0.0")).toBe(true)
    expect(staleVersion("1.0.0", "1.0.0")).toBe(false)
    expect(staleVersion("1.0.0", undefined)).toBe(false)
    expect(staleVersion(undefined, "2.0.0")).toBe(false)
  })
})

describe("keyBytes", () => {
  it("decodes URL-safe base64", () => {
    expect([...keyBytes("-_8")]).toEqual([251, 255])
  })
})
