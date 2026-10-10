// Bump only when what replay reads back out of git changes incompatibly — the
// package version must not stand in for it, since most majors leave history
// untouched. A bump that keeps reading the previous format widens the check below.
export const HISTORY_FORMAT = 1

const short = (hash: string): string => hash.slice(0, 7)

export const formatFault = (
  commits: readonly { readonly hash: string; readonly format: number }[],
): string | undefined => {
  const foreign = commits.find((c) => c.format !== HISTORY_FORMAT)
  if (foreign === undefined) return undefined
  return `gtd: commit ${short(foreign.hash)} is written in history format ${foreign.format}, but this gtd reads format ${HISTORY_FORMAT} — run a gtd release that reads format ${foreign.format} to continue this process`
}
