import { useRef } from "react"
import { writeRefusalFrom } from "./api.js"
import type { CasTokens } from "./staleRetry.js"

/**
 * Shared client-side half of package 02's Task 1 — originally a private copy
 * inside `FreeForm.tsx`, lifted out here so `Plan.tsx`/`Review.tsx` get the
 * same behavior without each hand-rolling it again.
 *
 * The WHY: a write's `onSettled` triggers a background `readSteeringFile`
 * invalidate/refetch, but that refetch is async — if a second write fires
 * before it lands, the query cache still holds the PRE-write `contentHash`,
 * and sending that as the compare-and-swap token gets it refused as stale. A
 * `ui.format` command run on every write (rewriting the file on save) makes
 * this the ROUTINE case, not an edge case: two edits in a row is normal
 * usage. This hook remembers the last write's own post-format `contentHash`
 * and prefers it over the query cache's value until either a fresh fetch
 * lands (`clear`) or a `stale-token` refusal proves it wrong
 * (`onWriteRefusal`) — a genuine concurrent edit (`moved: "content-hash"`)
 * must still refuse for real, never be silently overwritten.
 */
export interface ContentHashOverride {
  /** `contentHashOverride ?? data.contentHash` — the compare-and-swap token every mutation actually sends. */
  readonly casTokensFor: (
    data: { readonly headSha: string; readonly contentHash: string } | undefined,
  ) => CasTokens | undefined
  /** Every successful write's own sink: swaps the override for the post-`ui.format` hash the server just returned. */
  readonly onWriteSuccess: (contentHash: string) => void
  /** Every write's own `.catch`: a `stale-token` refusal (`moved: "sha"` OR `"content-hash"`) drops the override, since it no longer describes reality. */
  readonly onWriteRefusal: (error: unknown) => void
  /** Called by a `refetchTokens` implementation before returning fresh tokens, so a retry already in flight isn't wedged behind a now-redundant override. */
  readonly clear: () => void
}

/**
 * A `useRef`, NOT `useState` — every caller hands `casTokensFor`/`onSave`-
 * shaped closures to a retry thunk (`useRefusal`'s "Try again", or
 * `withStaleShaRetry`'s own second `attempt` call) that gets stored and
 * invoked an arbitrary number of renders later. A `useState` value read
 * inside such a closure stays frozen at whatever it was AT THE RENDER the
 * closure was created — it never sees a later `onWriteSuccess`/`clear` this
 * same hook call performs, since a plain closure doesn't re-run when state
 * changes and nothing here re-creates the stored thunk on a state change
 * alone. A ref, read at call time rather than closed over at render time,
 * always sees the current value. Nothing here is ever rendered (no consumer
 * displays the override), so there is no re-render to lose either way — a
 * ref is both correct and simpler.
 */
export const useContentHashOverride = (): ContentHashOverride => {
  const ref = useRef<string | undefined>(undefined)

  const casTokensFor = (
    data: { readonly headSha: string; readonly contentHash: string } | undefined,
  ): CasTokens | undefined =>
    data === undefined
      ? undefined
      : {
          expectedHeadSha: data.headSha,
          expectedContentHash: ref.current ?? data.contentHash,
        }

  const onWriteSuccess = (contentHash: string): void => {
    ref.current = contentHash
  }

  const onWriteRefusal = (error: unknown): void => {
    if (writeRefusalFrom(error)?.reason === "stale-token") ref.current = undefined
  }

  const clear = (): void => {
    ref.current = undefined
  }

  return { casTokensFor, onWriteSuccess, onWriteRefusal, clear }
}
