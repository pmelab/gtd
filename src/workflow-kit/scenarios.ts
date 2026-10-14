import type { Change } from "../flows/index.js"

const DOC_STRING = /^("""|```)/
const THEN = /^Then\s/
const CONTINUATION = /^(And|But|\*)\s/
const HEADING = /^(Feature|Rule|Background|Scenario|Scenario Outline|Scenario Template|Example):/

export interface Assertion {
  /** The trimmed heading line of the scenario (or background) it sits in. */
  readonly scenario: string
  readonly line: string
}

/** Trimmed lines outside doc strings, whose content is test input, not steps. */
const stepLines = (source: string): string[] => {
  const out: string[] = []
  let fence: string | undefined
  for (const trimmed of source.split("\n").map((l) => l.trim())) {
    const opening = fence === undefined ? DOC_STRING.exec(trimmed)?.[1] : undefined
    if (opening !== undefined) fence = opening
    else if (fence === undefined) out.push(trimmed)
    else if (trimmed.startsWith(fence)) fence = undefined
  }
  return out
}

const neutral = (line: string): boolean =>
  line === "" || line.startsWith("#") || line.startsWith("|")

/** Trimmed `Then` step lines, an `And`/`But`/`*` continuing one included; doc strings skipped. */
export const assertionLines = (source: string): readonly Assertion[] => {
  const out: Assertion[] = []
  let inThen = false
  let scenario = ""
  for (const line of stepLines(source)) {
    if (HEADING.test(line)) scenario = line
    if (THEN.test(line)) inThen = true
    else if (!CONTINUATION.test(line) && !neutral(line)) inThen = false
    if (inThen && !neutral(line)) out.push({ scenario, line })
  }
  return out
}

export interface RemovedAssertions {
  readonly path: string
  readonly lines: readonly Assertion[]
}

const key = (a: Assertion): string => `${a.scenario}\n${a.line}`

/**
 * Assertions a `.feature` file that existed before `changes` lost — the one
 * way rewording a scenario can weaken it. Matched within each scenario and
 * counted, so a line moving to another scenario, or one of two identical
 * `Then`s dropped, still shows. A renamed scenario reports all of its own.
 */
export const removedAssertions = (changes: readonly Change[]): readonly RemovedAssertions[] =>
  changes
    .filter((c) => c.path.endsWith(".feature") && c.before !== undefined)
    .map((c) => {
      const left = new Map<string, number>()
      for (const a of assertionLines(c.after ?? "")) left.set(key(a), (left.get(key(a)) ?? 0) + 1)
      const lines = assertionLines(c.before ?? "").filter((a) => {
        const n = left.get(key(a)) ?? 0
        left.set(key(a), n - 1)
        return n <= 0
      })
      return { path: c.path, lines }
    })
    .filter((r) => r.lines.length > 0)
