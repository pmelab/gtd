import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Parses the `@theme` block's `--color-*` declarations straight out of the
 * shipped stylesheet — never a duplicated JS copy of the palette — so a
 * value changed in `styles.css` without checking contrast here is caught by
 * THIS file re-reading the real source, not by a constant staying in sync by
 * hand.
 */
const readColorTokens = (): Record<string, string> => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
  const themeMatch = css.match(/@theme\s*{([^}]*)}/)
  if (themeMatch?.[1] === undefined) throw new Error("tokens.test.ts: no @theme block found")
  const tokens: Record<string, string> = {}
  for (const line of themeMatch[1].split("\n")) {
    const declaration = line.match(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6});/)
    if (declaration?.[1] !== undefined && declaration[2] !== undefined) {
      tokens[declaration[1]] = declaration[2]
    }
  }
  return tokens
}

const srgbToLinear = (channel: number): number => {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const relativeLuminance = (hex: string): number => {
  const value = hex.replace("#", "")
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

/** WCAG contrast ratio between two colours, order-independent. */
const contrastRatio = (a: string, b: string): number => {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const bright = Math.max(l1, l2)
  const dark = Math.min(l1, l2)
  return (bright + 0.05) / (dark + 0.05)
}

describe("styles.css contrast", () => {
  const tokens = readColorTokens()

  it("parsed every expected color token from the real @theme block", () => {
    for (const name of [
      "page",
      "surface",
      "border",
      "text",
      "muted",
      "accent",
      "accent-pressed",
      "disabled",
    ]) {
      expect(tokens[name], `missing --color-${name}`).toBeDefined()
    }
  })

  it("body text on page clears the 4.5:1 AA body-text threshold", () => {
    expect(contrastRatio(tokens.text!, tokens.page!)).toBeGreaterThanOrEqual(4.5)
  })

  it("muted (large) text on page clears the 3:1 AA large-text threshold", () => {
    expect(contrastRatio(tokens.muted!, tokens.page!)).toBeGreaterThanOrEqual(3)
  })

  it("a control boundary (border) against surface clears the 3:1 AA threshold", () => {
    expect(contrastRatio(tokens.border!, tokens.surface!)).toBeGreaterThanOrEqual(3)
  })

  it("the accent colour on page clears the 3:1 AA large-text/control threshold", () => {
    expect(contrastRatio(tokens.accent!, tokens.page!)).toBeGreaterThanOrEqual(3)
  })

  it("the accent-pressed colour on page clears the 3:1 AA large-text/control threshold", () => {
    expect(contrastRatio(tokens["accent-pressed"]!, tokens.page!)).toBeGreaterThanOrEqual(3)
  })

  it("body text on surface clears the 4.5:1 AA body-text threshold", () => {
    expect(contrastRatio(tokens.text!, tokens.surface!)).toBeGreaterThanOrEqual(4.5)
  })
})
