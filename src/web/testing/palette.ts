/**
 * The rendered `rgb(...)` form of a palette token, read from the live
 * stylesheet. Stories assert against THIS, never a literal `rgb(91, 157,
 * 255)`: a hard-coded triple pins the story to one palette, so every
 * re-tokenisation reds a dozen unrelated stories that only ever meant "the
 * accent colour".
 */
export const token = (name: string): string => {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()
  const value = hex.replace("#", "")
  if (value.length !== 6) throw new Error(`palette: --color-${name} is not a 6-digit hex`)
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}
