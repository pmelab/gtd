/** One changed post-image range, 1-based and inclusive. A pure deletion is the one line after it. */
export interface LineRange {
  readonly start: number
  readonly end: number
}

/** Above this many cells the table costs too much; the whole changed middle counts as one range. */
const MAX_CELLS = 4_000_000

const splitLines = (text: string): string[] => {
  const lines = text.split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

const commonPrefix = (a: readonly string[], b: readonly string[]): number => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1
  return n
}

const commonSuffix = (a: readonly string[], b: readonly string[], prefix: number): number => {
  let n = 0
  const room = Math.min(a.length, b.length) - prefix
  while (n < room && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1
  return n
}

/** `table[i][j]`: the longest common subsequence of `a[i..]` and `b[j..]`. */
const lcsTable = (
  a: readonly string[],
  b: readonly string[],
): ((i: number, j: number) => number) => {
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  const at = (i: number, j: number): number => table[i * width + j] ?? 0
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  return at
}

/** The pairs of line indexes `a` and `b` share, in order. */
const matches = (a: readonly string[], b: readonly string[]): (readonly [number, number])[] => {
  const at = lcsTable(a, b)
  const pairs: (readonly [number, number])[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i += 1
      j += 1
    } else if (at(i + 1, j) >= at(i, j + 1)) i += 1
    else j += 1
  }
  return pairs
}

/** Between each two shared lines: the new lines of `b`, or a one-line mark where lines of `a` vanished. */
const rangesOf = (
  a: readonly string[],
  b: readonly string[],
  offset: number,
  last: number,
): LineRange[] => {
  const anchors = [[-1, -1] as const, ...matches(a, b), [a.length, b.length] as const]
  const ranges: LineRange[] = []
  for (let k = 0; k + 1 < anchors.length; k += 1) {
    const [i0, j0] = anchors[k]!
    const [i1, j1] = anchors[k + 1]!
    if (j1 - j0 > 1) ranges.push({ start: offset + j0 + 2, end: offset + j1 })
    else if (i1 - i0 > 1) {
      const line = Math.min(offset + j0 + 2, last)
      ranges.push({ start: line, end: line })
    }
  }
  return ranges
}

/** The post-image line ranges `after` changed relative to `before`. */
export const changedRanges = (before: string, after: string): readonly LineRange[] => {
  const a = splitLines(before)
  const b = splitLines(after)
  const prefix = commonPrefix(a, b)
  const suffix = commonSuffix(a, b, prefix)
  const midA = a.slice(prefix, a.length - suffix)
  const midB = b.slice(prefix, b.length - suffix)
  if (midA.length === 0 && midB.length === 0) return []
  const last = Math.max(b.length, 1)
  if (midA.length === 0 || midB.length === 0 || (midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
    const start = Math.min(prefix + 1, last)
    return [{ start, end: Math.max(start, prefix + midB.length) }]
  }
  return rangesOf(midA, midB, prefix, last)
}
