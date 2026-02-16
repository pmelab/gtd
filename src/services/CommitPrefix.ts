export const HUMAN = "🤦" as const
export const PLAN = "🤖" as const
export const BUILD = "🔨" as const
export const LEARN = "🎓" as const
export const CLEANUP = "🧹" as const
export const FIX = "👷" as const

export type CommitPrefix =
  | typeof HUMAN
  | typeof PLAN
  | typeof BUILD
  | typeof LEARN
  | typeof CLEANUP
  | typeof FIX

const ALL_PREFIXES: ReadonlyArray<CommitPrefix> = [
  HUMAN,
  PLAN,
  BUILD,
  LEARN,
  CLEANUP,
  FIX,
]

export const parseCommitPrefix = (
  message: string,
): CommitPrefix | undefined => {
  for (const prefix of ALL_PREFIXES) {
    if (message.startsWith(prefix)) {
      return prefix
    }
  }
  return undefined
}
