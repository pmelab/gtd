import type { Change } from "../flows/index.js"

const DOC_STRING = /^("""|```)/
const THEN = /^Then\s/
const CONTINUATION = /^(And|But|\*)\s/

/** Trimmed `Then` step lines, an `And`/`But`/`*` continuing one included; doc strings skipped. */
export const assertionLines = (source: string): readonly string[] => {
  const out: string[] = []
  let fence: string | undefined
  let inThen = false
  for (const line of source.split("\n")) {
    const trimmed = line.trim()
    if (fence !== undefined) {
      if (trimmed.startsWith(fence)) fence = undefined
      continue
    }
    const delimiter = DOC_STRING.exec(trimmed)
    if (delimiter !== null) fence = delimiter[1]
    else if (THEN.test(trimmed)) {
      inThen = true
      out.push(trimmed)
    } else if (CONTINUATION.test(trimmed)) {
      if (inThen) out.push(trimmed)
    } else if (trimmed !== "" && !trimmed.startsWith("#") && !trimmed.startsWith("|")) {
      inThen = false
    }
  }
  return out
}

export interface RemovedAssertions {
  readonly path: string
  readonly lines: readonly string[]
}

/**
 * Assertions a `.feature` file that existed before `changes` lost — the one
 * way rewording a scenario can weaken it. Counted per line, so dropping one
 * of two identical `Then`s still shows.
 */
export const removedAssertions = (changes: readonly Change[]): readonly RemovedAssertions[] =>
  changes
    .filter((c) => c.path.endsWith(".feature") && c.before !== undefined)
    .map((c) => {
      const left = new Map<string, number>()
      for (const line of assertionLines(c.after ?? "")) left.set(line, (left.get(line) ?? 0) + 1)
      const lines = assertionLines(c.before ?? "").filter((line) => {
        const n = left.get(line) ?? 0
        left.set(line, n - 1)
        return n <= 0
      })
      return { path: c.path, lines }
    })
    .filter((r) => r.lines.length > 0)
