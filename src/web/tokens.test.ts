import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8")

const declarations = (block: string): Record<string, string> => {
  const tokens: Record<string, string> = {}
  for (const line of block.split("\n")) {
    const declaration = line.match(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6});/)
    if (declaration?.[1] !== undefined && declaration[2] !== undefined) {
      tokens[declaration[1]] = declaration[2].toLowerCase()
    }
  }
  return tokens
}

/** Both theme blocks, read from the shipped stylesheet: light is `@theme`, dark overrides it under the system media query. */
const light = declarations(css.match(/@theme\s*{([^}]*)}/)?.[1] ?? "")
const darkOverrides = declarations(
  css.match(/prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/)?.[1] ?? "",
)
const dark = { ...light, ...darkOverrides }

const PALETTE = ["#151a1d", "#ffc328", "#fafaf7", "#c9cbcd"]
const CODE_ONLY = [
  "code-bg",
  "code",
  "diff-add",
  "diff-del",
  "syntax-kw",
  "syntax-str",
  "syntax-num",
  "syntax-typ",
  "syntax-com",
]
const SYNTAX = ["syntax-kw", "syntax-str", "syntax-num", "syntax-typ", "syntax-com"]

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

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s theme", (_name, tokens) => {
  it("paints every UI token with one of the four palette colours", () => {
    for (const [name, value] of Object.entries(tokens)) {
      if (CODE_ONLY.includes(name)) continue
      expect(PALETTE, `--color-${name}`).toContain(value)
    }
  })

  it("body text clears 4.5:1 on page and surface", () => {
    expect(contrastRatio(tokens.text!, tokens.page!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tokens.text!, tokens.surface!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(["muted", "link", "warning", "danger", "success"])(
    "%s text clears 4.5:1 on page and surface",
    (name) => {
      expect(contrastRatio(tokens[name]!, tokens.page!)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(tokens[name]!, tokens.surface!)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it("a control boundary and the focus ring clear 3:1 on the page", () => {
    expect(contrastRatio(tokens.border!, tokens.page!)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(tokens.ring!, tokens.page!)).toBeGreaterThanOrEqual(3)
  })

  it("a primary button's label clears 4.5:1 on its fill", () => {
    expect(contrastRatio(tokens["on-accent"]!, tokens.accent!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tokens["on-accent"]!, tokens.disabled!)).toBeGreaterThanOrEqual(4.5)
  })

  it("code text clears 4.5:1 on the code background", () => {
    expect(contrastRatio(tokens.code!, tokens["code-bg"]!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SYNTAX)("%s clears 4.5:1 on the code background and both diff fills", (name) => {
    for (const background of ["code-bg", "diff-add", "diff-del"]) {
      expect(
        contrastRatio(tokens[name]!, tokens[background]!),
        `${name} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("body text clears 4.5:1 on both diff fills, and each fill differs from the code background", () => {
    for (const fill of ["diff-add", "diff-del"]) {
      expect(contrastRatio(tokens.text!, tokens[fill]!), fill).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(tokens[fill]!, tokens["code-bg"]!), fill).toBeGreaterThan(1.1)
    }
  })

  it.each(
    ["text", ...SYNTAX].flatMap((fg) =>
      ["code-bg", "diff-add", "diff-del"].map((bg) => [fg, bg] as const),
    ),
  )("%s clears AA on %s once dimmed at the shipped opacity", (fg, bg) => {
    const blended = blendOverBackground(tokens[fg]!, tokens[bg]!, readDimmedOpacity())
    expect(contrastRatio(blended, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe("the themes differ", () => {
  it("the dark block parses and overrides every UI token", () => {
    const ui = Object.keys(light).filter((name) => !CODE_ONLY.includes(name))
    expect(Object.keys(darkOverrides).length).toBeGreaterThan(0)
    expect(Object.keys(darkOverrides)).toEqual(expect.arrayContaining(ui))
  })

  it("light is a white page and dark a charcoal one", () => {
    expect(light.page).toBe("#fafaf7")
    expect(dark.page).toBe("#151a1d")
  })
})
