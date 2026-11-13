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

/** For each line of `a` in the middle, whether it survives into `b` (a longest common subsequence). */
const keptLines = (
  a: readonly string[],
  b: readonly string[],
): { keptA: boolean[]; keptB: boolean[] } => {
  const n = a.length
  const m = b.length
  const table = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * (m + 1) + j] =
        a[i] === b[j]
          ? (table[(i + 1) * (m + 1) + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * (m + 1) + j] ?? 0, table[i * (m + 1) + j + 1] ?? 0)
    }
  }
  const keptA = new Array<boolean>(n).fill(false)
  const keptB = new Array<boolean>(m).fill(false)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keptA[i] = true
      keptB[j] = true
      i += 1
      j += 1
    } else if ((table[(i + 1) * (m + 1) + j] ?? 0) >= (table[i * (m + 1) + j + 1] ?? 0)) i += 1
    else j += 1
  }
  return { keptA, keptB }
}

/** The post-image line ranges `after` changed relative to `before`. */
export const changedRanges = (before: string, after: string): readonly LineRange[] => {
  const a = splitLines(before)
  const b = splitLines(after)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix += 1
  const midA = a.slice(prefix, a.length - suffix)
  const midB = b.slice(prefix, b.length - suffix)
  if (midA.length === 0 && midB.length === 0) return []
  const lastLine = Math.max(b.length, 1)
  if ((midA.length + 1) * (midB.length + 1) > MAX_CELLS || midA.length === 0 || midB.length === 0) {
    const start = Math.min(prefix + 1, lastLine)
    return [{ start, end: Math.max(start, prefix + midB.length) }]
  }
  const { keptA, keptB } = keptLines(midA, midB)
  const ranges: LineRange[] = []
  let i = 0
  let j = 0
  while (i < midA.length || j < midB.length) {
    if (keptA[i] === true && keptB[j] === true) {
      i += 1
      j += 1
      continue
    }
    const startB = j
    let removed = false
    while (i < midA.length && keptA[i] !== true) {
      i += 1
      removed = true
    }
    while (j < midB.length && keptB[j] !== true) j += 1
    if (j > startB) ranges.push({ start: prefix + startB + 1, end: prefix + j })
    else if (removed) {
      const line = Math.min(prefix + startB + 1, lastLine)
      ranges.push({ start: line, end: line })
    }
  }
  return ranges
}
