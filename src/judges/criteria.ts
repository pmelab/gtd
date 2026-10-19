const LABEL = /(?:^|\. )([A-Za-z][A-Za-z0-9_-]*): /g

/** Same splitter as gtd-build's `judge_request`: text before the first label is dropped. */
export const splitLabels = (criteria: string): [string, string][] => {
  const hits = [...criteria.matchAll(LABEL)]
  return hits.map((m, i) => {
    const start = m.index + m[0].length
    const end = hits[i + 1]?.index ?? criteria.length
    return [m[1] as string, criteria.slice(start, end).replace(/^ /, "")]
  })
}
