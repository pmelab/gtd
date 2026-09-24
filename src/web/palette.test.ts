import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Every `--color-*` in `styles.css` carries a trailing `radix: <scale>.<step>`
 * comment naming where its value came from. This reads both sides — the
 * stylesheet and the installed `@radix-ui/colors` CSS — and fails when they
 * disagree, so "these are Radix steps" is a checked fact rather than a claim
 * a later hand-picked hex can quietly break.
 */
const declarations = (): readonly {
  name: string
  value: string
  scale: string
  step: string
}[] => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
  const found: { name: string; value: string; scale: string; step: string }[] = []
  const line = /--color-([\w-]+):\s*(#[0-9a-fA-F]{6});\s*\/\*\s*radix:\s*([\w-]+)\.(\d+)\s*\*\//g
  for (let m = line.exec(css); m !== null; m = line.exec(css)) {
    found.push({ name: m[1]!, value: m[2]!.toLowerCase(), scale: m[3]!, step: m[4]! })
  }
  return found
}

/**
 * Reads ONLY the plain-hex block at the top of a Radix scale file: the same
 * file repeats every step as `color(display-p3 …)` inside an `@supports`
 * block, and matching that would compare a hex against a p3 triple.
 */
const radixStep = (scale: string, step: string): string => {
  const file = readFileSync(
    new URL(`../../node_modules/@radix-ui/colors/${scale}.css`, import.meta.url),
    "utf8",
  )
  const hexBlock = file.slice(0, file.indexOf("@supports"))
  const hue = scale.replace(/-dark$/, "")
  const match = hexBlock.match(new RegExp(`--${hue}-${step}:\\s*(#[0-9a-fA-F]{6});`))
  if (match?.[1] === undefined) throw new Error(`palette.test.ts: no ${scale}.${step}`)
  return match[1].toLowerCase()
}

describe("styles.css palette provenance", () => {
  const tokens = declarations()

  it("annotates every colour token with the Radix step it came from", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
    const theme = css.slice(css.indexOf("@theme {"), css.indexOf("@source"))
    const colorCount = theme.match(/--color-[\w-]+:/g)?.length ?? 0
    expect(tokens).toHaveLength(colorCount)
  })

  it.each(declarations())("$name is $scale.$step", ({ value, scale, step }) => {
    expect(value).toBe(radixStep(scale, step))
  })
})
