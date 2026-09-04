import { describe, expect, it } from "vitest"
import { renderQrCode } from "./Qr.js"

describe("renderQrCode", () => {
  it("renders a known URL as a non-empty multi-line QR block", () => {
    const output = renderQrCode("https://example.com")

    expect(output.length).toBeGreaterThan(0)
    const lines = output.split("\n")
    expect(lines.length).toBeGreaterThan(1)
    // qrcode-terminal's `small` renderer draws modules with these block glyphs.
    expect(/[▀▄█ ]/.test(output)).toBe(true)
  })

  it("renders different URLs to different output", () => {
    const a = renderQrCode("https://example.com/a")
    const b = renderQrCode("https://example.com/b")

    expect(a).not.toBe(b)
  })
})
