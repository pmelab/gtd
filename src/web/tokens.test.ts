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

/** `.diff-dimmed`'s own `opacity` — the ONE number `Hunk.tsx`'s dimmed-context rows are painted at — parsed from the real stylesheet, never a duplicated JS constant. */
const readDimmedOpacity = (): number => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
  const match = css.match(/\.diff-dimmed\s*{\s*opacity:\s*([\d.]+);/)
  if (match?.[1] === undefined) throw new Error("tokens.test.ts: no .diff-dimmed opacity found")
  return Number(match[1])
}

/**
 * What a browser actually paints for `opacity: N` on a foreground-only
 * element: the foreground colour composited at `opacity` over whatever sits
 * behind it — never a literal CSS `color`, since the dimmed rows never get
 * one of their own (T3: opacity on the foreground, not a new colour token).
 */
const blendOverBackground = (foreground: string, background: string, opacity: number): string => {
  const fg = foreground.replace("#", "")
  const bg = background.replace("#", "")
  const mix = (i: number) => {
    const f = parseInt(fg.slice(i, i + 2), 16)
    const b = parseInt(bg.slice(i, i + 2), 16)
    return Math.round(opacity * f + (1 - opacity) * b)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${mix(0)}${mix(2)}${mix(4)}`
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
      "divider",
      "warning",
      "danger",
      "link",
      "code",
      "quote",
      "diff-add",
      "diff-del",
      "heading-a",
      "heading-b",
      "heading-c",
      "syntax-kw",
      "syntax-str",
      "syntax-num",
      "syntax-typ",
      "syntax-com",
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

  it("the warning colour (a chunk's footnote badge) on page clears the 4.5:1 AA body-text threshold", () => {
    expect(contrastRatio(tokens.warning!, tokens.page!)).toBeGreaterThanOrEqual(4.5)
  })

  it("the danger colour (a destructive control's label) on page clears the 4.5:1 AA body-text threshold", () => {
    expect(contrastRatio(tokens.danger!, tokens.page!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(["link", "warning", "danger", "heading-a", "heading-b", "heading-c"])(
    "%s reads as body text on the page (4.5:1 AA)",
    (name) => {
      expect(contrastRatio(tokens[name]!, tokens.page!)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it("code text clears AA on the surface it is painted on", () => {
    expect(contrastRatio(tokens.code!, tokens.surface!)).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * A syntax token has to stay readable on THREE backgrounds, not one: the
   * page, and both diff line fills. A colour picked against the page alone
   * is the failure this catches — an added line is exactly where code is
   * read most carefully.
   */
  it.each(["syntax-kw", "syntax-str", "syntax-num", "syntax-typ", "syntax-com"])(
    "%s clears AA on the page and on both diff backgrounds",
    (name) => {
      for (const background of ["page", "diff-add", "diff-del"]) {
        expect(
          contrastRatio(tokens[name]!, tokens[background]!),
          `${name} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    },
  )

  it("each diff fill is distinguishable from the page it sits on", () => {
    for (const name of ["diff-add", "diff-del"]) {
      expect(contrastRatio(tokens[name]!, tokens.page!), name).toBeGreaterThan(1.2)
    }
  })

  /**
   * A divider is NOT a control boundary and deliberately misses 3:1 — it
   * separates rows rather than outlining anything tappable. The pair of
   * bounds is the point: visible against the page, and quieter than
   * `border`, which is the token a control must keep using.
   */
  it("the divider is visible against the page yet quieter than a control boundary", () => {
    expect(contrastRatio(tokens.divider!, tokens.page!)).toBeGreaterThan(1.2)
    expect(contrastRatio(tokens.divider!, tokens.page!)).toBeLessThan(
      contrastRatio(tokens.border!, tokens.page!),
    )
  })

  /**
   * T3's own opacity-only rule, pinned on the actual blended colour a
   * browser paints. `.diff-dimmed` (`Hunk.tsx#DiffLines`) wraps a dimmed
   * row's WHOLE text — every `TOKEN_COLOR` span inside it, not just plain
   * `text` — and a dimmed row keeps its own kind's `LINE_BACKGROUND` (T3:
   * opacity is foreground-only), which for the pad band around a NEW-FILE
   * range is `add` throughout
   * (`Hunk.stories.tsx#RangeInANewFileShowsTwelveInRangeRowsWithThreeDimmedOnEachSide`).
   * So the real claim is fifteen pairs — `text` plus the five `TOKEN_COLOR`
   * entries, each across `page` (also what a dimmed `context` row's
   * `bg-transparent` sits on), `diff-add` and `diff-del` — never `text` on
   * `page` alone, which a syntax token blended over an add/del fill can
   * silently miss (a real regression this file's own history caught: at
   * `opacity: 0.6`, `syntax-kw` on `diff-add` landed at 3.11:1). This app
   * ships one theme — this whole file's `@theme` block IS that theme,
   * labelled "Dark-only palette" at its own top — so "both light and dark"
   * holds vacuously today: there is no second palette for a future light
   * theme to regress without this file gaining a second `readColorTokens`
   * source.
   */
  describe("dimmed diff context (.diff-dimmed)", () => {
    const opacity = readDimmedOpacity()
    const dimmedForegrounds = [
      "text",
      "syntax-kw",
      "syntax-str",
      "syntax-num",
      "syntax-typ",
      "syntax-com",
    ]
    const dimmedBackgrounds = ["page", "diff-add", "diff-del"]

    it.each(dimmedForegrounds.flatMap((fg) => dimmedBackgrounds.map((bg) => [fg, bg] as const)))(
      "%s clears AA on %s once blended at the shipped dimmed opacity",
      (fg, bg) => {
        const blended = blendOverBackground(tokens[fg]!, tokens[bg]!, opacity)
        expect(contrastRatio(blended, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
      },
    )
  })
})
