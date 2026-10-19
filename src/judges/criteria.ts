const LABEL = /(?:^|\. |\n\s*)([A-Za-z][A-Za-z0-9_-]*): /g

/** Mirrored in claude/hooks/judge.ts, which may not import it: text before the first label is dropped. */
export const splitLabels = (criteria: string): [string, string][] => {
  const hits = [...criteria.matchAll(LABEL)]
  return hits.map((m, i) => {
    const start = m.index + m[0].length
    const end = hits[i + 1]?.index ?? criteria.length
    return [m[1] as string, criteria.slice(start, end).trim()]
  })
}
