import { Effect } from "effect"
import { cosmiconfig } from "cosmiconfig"

const explorer = cosmiconfig("gtd")

export type CosmiconfigResult = {
  readonly config: Record<string, unknown>
  readonly filepath: string
} | null

export const searchConfig = (
  searchFrom: string,
): Effect.Effect<CosmiconfigResult, Error> =>
  Effect.tryPromise({
    try: () =>
      explorer.search(searchFrom).then((result) =>
        result
          ? { config: result.config as Record<string, unknown>, filepath: result.filepath }
          : null,
      ),
    catch: (e) => new Error(`Failed to search for config: ${e}`),
  })

export const loadConfig = (
  filepath: string,
): Effect.Effect<CosmiconfigResult, Error> =>
  Effect.tryPromise({
    try: () =>
      explorer.load(filepath).then((result) =>
        result
          ? { config: result.config as Record<string, unknown>, filepath: result.filepath }
          : null,
      ),
    catch: (e) => new Error(`Failed to load config from ${filepath}: ${e}`),
  })
