import { writeRefusalFrom } from "./api.js"

/** The compare-and-swap half every `writeNote`/`setValue`/`done` request carries — mirrors `ui/Write.ts#WriteNoteRequest`'s two token fields, kept as a plain local type (never importing `ui/Write.ts`) so this stays a thin client-side shape. */
export interface CasTokens {
  readonly expectedHeadSha: string
  readonly expectedContentHash: string
}

/**
 * Task 01's in-place recovery: a write refused `stale-token`/`moved: "sha"`
 * almost always means HEAD moved because the process crossed a human gate,
 * not because someone actually committed underneath the human — see the
 * package's own root-cause writeup. Retrying once, silently, with a freshly
 * fetched `headSha` clears that case without ever showing the banner.
 *
 * Calls `attempt(tokens)`; on rejection, reads the refusal through
 * `api.ts#writeRefusalFrom` and rethrows unless it's exactly
 * `{ reason: "stale-token", moved: "sha" }` — a `content-hash` refusal (an
 * actual concurrent edit to the same file) rethrows immediately, since
 * retrying it would silently overwrite that edit. On a `sha` refusal,
 * awaits `refetch()` for fresh tokens and calls `attempt(fresh)` EXACTLY
 * once more — literally: there is no loop, no recursion, and no second
 * `catch` here, so this can never retry more than once no matter what the
 * retried call itself rejects with.
 */
export const withStaleShaRetry = async <T>(
  attempt: (tokens: CasTokens) => Promise<T>,
  tokens: CasTokens,
  refetch: () => Promise<CasTokens>,
): Promise<T> => {
  try {
    return await attempt(tokens)
  } catch (error) {
    const refusal = writeRefusalFrom(error)
    if (refusal?.reason !== "stale-token" || refusal.moved !== "sha") throw error
    const fresh = await refetch()
    return attempt(fresh)
  }
}
