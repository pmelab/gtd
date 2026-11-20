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
  it("keeps charcoal, yellow and white as foreground, primary and card", () => {
    expect(tokens.primary).toBe("#ffc328")
    expect(tokens["primary-foreground"]).toBe("#151a1d")
    expect([tokens.foreground, tokens.background]).toContain("#151a1d")
    expect([tokens.foreground, tokens.card]).toContain("#fafaf7")
  })

  it.each([
    "foreground",
    "muted-foreground",
    "link",
    "warning",
    "destructive",
    "success",
    "quote",
    "actor-human",
    "actor-agent",
    "actor-judge",
    "actor-check",
  ])("%s text clears 4.5:1 on background, card and muted", (name) => {
    for (const ground of ["background", "card", "muted"]) {
      expect(contrastRatio(tokens[name]!, tokens[ground]!), ground).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ["primary-foreground", "primary"],
    ["primary-foreground", "primary-pressed"],
    ["destructive-foreground", "destructive"],
    ["secondary-foreground", "secondary"],
    ["accent-foreground", "accent"],
  ])("%s clears 4.5:1 on %s", (fg, bg) => {
    expect(contrastRatio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
  })

  it("an input boundary and the focus ring clear 3:1 on background and card", () => {
    for (const ground of ["background", "card"]) {
      expect(contrastRatio(tokens.input!, tokens[ground]!), ground).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(tokens.ring!, tokens[ground]!), ground).toBeGreaterThanOrEqual(3)
    }
  })

  it("the four actor colours differ from each other", () => {
    const actors = ["human", "agent", "judge", "check"].map((a) => tokens[`actor-${a}`])
    expect(new Set(actors).size).toBe(4)
  })

  it("the error, attention and working colours differ from each other", () => {
    const status = [tokens.destructive, tokens.primary, tokens.foreground]
    expect(new Set(status).size).toBe(3)
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
      expect(contrastRatio(tokens.foreground!, tokens[fill]!), fill).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(tokens[fill]!, tokens["code-bg"]!), fill).toBeGreaterThan(1.1)
    }
  })

  it.each(
    ["foreground", ...SYNTAX].flatMap((fg) =>
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

  it("light is a white card on a pale ground and dark a charcoal ground", () => {
    expect(light.card).toBe("#fafaf7")
    expect(dark.background).toBe("#151a1d")
  })
})
