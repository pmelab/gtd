export const IMPLICIT_SLICE = "main"

/** Same shape as mark()'s name rule; kept local so @pmelab/gtd/flows publishes no regex. */
export const SLICE_NAME = /^[a-z][a-z0-9-]*$/

/** One slice() call as replay saw it. Hashes are the commit replay stood on; "" is a pending turn. */
export interface SliceSpan {
  readonly name: string
  readonly enteredAt: string
  /** undefined: the flow never left it — the process rests inside, or restart() fired inside. */
  readonly leftAt: string | undefined
}

export interface SliceRange {
  readonly name: string
  /** Exclusive: the range is base..tip in git's sense. */
  readonly base: string
  readonly tip: string
  /** The tip can still move: only the last range, since a rest is never past the episode's end. */
  readonly open: boolean
}

/**
 * Folds boundaries into ranges: each kept span's base is the previous kept
 * span's `leftAt`, so a gap before a span belongs to it, and the last span
 * runs to the episode tip. A closed span that landed nothing is dropped.
 */
export const sliceRanges = (
  spans: readonly SliceSpan[],
  episode: { readonly base: string; readonly tip: string },
): readonly SliceRange[] => {
  if (spans.some((s) => s.enteredAt === "" || s.leftAt === "")) {
    throw new Error('sliceRanges: a pending turn\'s "" hash is not a commit')
  }
  const kept = spans.filter((s) => s.leftAt === undefined || s.enteredAt !== s.leftAt)
  if (kept.length === 0) {
    return [{ name: IMPLICIT_SLICE, base: episode.base, tip: episode.tip, open: true }]
  }
  return kept.map((s, i) => ({
    name: s.name,
    base: i === 0 ? episode.base : (kept[i - 1]!.leftAt ?? episode.base),
    tip: i === kept.length - 1 ? episode.tip : (s.leftAt ?? episode.tip),
    open: i === kept.length - 1,
  }))
}
