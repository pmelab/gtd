// Bump only when what replay reads back out of git changes incompatibly — the
// package version must not stand in for it, since most majors leave history
// untouched. Format 2 adds pin commits, which format 1 would replay as turns;
// format 3 adds the anchor, whose set-aside commits format 2 would replay.
export const HISTORY_FORMAT = 3
const OLDEST_READABLE_FORMAT = 1

const short = (hash: string): string => hash.slice(0, 7)

export const formatFault = (
  commits: readonly { readonly hash: string; readonly format: number }[],
): string | undefined => {
  const foreign = commits.find(
    (c) => c.format < OLDEST_READABLE_FORMAT || c.format > HISTORY_FORMAT,
  )
  if (foreign === undefined) return undefined
  return `gtd: commit ${short(foreign.hash)} is written in history format ${foreign.format}, but this gtd reads formats ${OLDEST_READABLE_FORMAT} to ${HISTORY_FORMAT} — run a gtd release that reads format ${foreign.format} to continue this process`
}
