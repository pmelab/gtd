import { useState } from "react"
import { writeRefusalFrom, type ReadRefusalInfo, type WriteRefusalInfo } from "./api.js"
import { Button } from "./Button.js"
import { Notice } from "./Notice.js"

/** Every shape `useRefusal.show` can hold — `WriteRefusalInfo`'s five named reasons, plus `"unknown"` for an error `writeRefusalFrom` can't read at all (a network failure, a dead server) — package 03's own sixth, generic sentence. */
export type RefusalState = WriteRefusalInfo | { readonly reason: "unknown" }

/** One sentence per reason, naming which token moved for `stale-token` when known — never `error.message` (`api.ts#writeRefusalFrom`'s own doc comment: that text is for a log, not a client to display). Task 01 drops "reload" from every one of these: the banner now recovers in place via `RefusalBanner`'s own `Try again` control, never by sending a human off to reload the page. */
// fallow-ignore-next-line complexity
const messageFor = (refusal: RefusalState): string => {
  switch (refusal.reason) {
    case "stale-token":
      return refusal.moved === "sha"
        ? "Someone else committed a change underneath you, and the automatic retry still didn't land — try again."
        : refusal.moved === "content-hash"
          ? "The file's content changed underneath you — try again once you've seen the latest."
          : "This file changed underneath you — try again."
    case "not-resting":
      return "This step no longer rests with you, so that write was refused."
    case "file-vanished":
      return "The file this screen was editing is no longer being served."
    case "anchor-unresolved":
      return "That item no longer matches the file on disk, so the write was refused."
    case "note-collision":
      return "Another note already occupies this spot."
    case "unknown":
      return "That write didn't go through — check your connection and try again."
  }
}

/**
 * One sentence per `readSteeringFile` refusal reason — `Plan.tsx`/`Review.tsx`
 * render this in their "no view yet" branch instead of the generic "Could
 * not load the plan/review." fallback. `head-unresolved` names a repository
 * state a retry can't fix (task 01's own wording); the other one
 * (`file-vanished`) is an ordinary, named failure, not the empty-message
 * crutch that shipped before this existed.
 */
export const messageForReadRefusal = (refusal: ReadRefusalInfo): string => {
  switch (refusal.reason) {
    case "head-unresolved":
      return "Can't read this repository's current commit — editing is disabled until that's fixed."
    case "file-vanished":
      return "The file this screen would show is no longer being served."
  }
}

/**
 * Holds the current refusal (or `undefined`, meaning none) plus save-status
 * text shown through the SAME live region (Task 3's "same aria-live region"
 * bullet) — a refusal always takes priority over a `Saving…`/`Saved` label
 * when both are present, since a refusal is the more actionable of the two.
 */
/** How long a settled "Saved" label lingers before clearing — long enough for a screen reader (or a human glancing back) to catch it, short enough not to look stuck. */
const SAVED_LINGER_MS = 1_500

export type SaveStatus = "idle" | "saving" | "saved"

export const useRefusal = () => {
  const [refusal, setRefusal] = useState<RefusalState | undefined>(undefined)
  const [retry, setRetry] = useState<(() => Promise<unknown>) | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")

  /**
   * Reads a thrown mutation error the same way every `.catch` in
   * `Question.tsx`/`Review.tsx`/`Plan.tsx` already does — never
   * `error.message`. `retryAction`, when a caller supplies one (task 01's
   * "in-page recovery"), is the WHOLE write path that just failed — calling
   * it again re-derives fresh compare-and-swap tokens and retries through
   * `staleRetry.ts#withStaleShaRetry` itself, never a replay of the exact
   * tokens that just refused. `setRetry(() => retryAction)` — not
   * `setRetry(retryAction)` — because `useState`'s setter treats a bare
   * function argument as an updater function, not a value to store.
   */
  const showRefusal = (error: unknown, retryAction?: () => Promise<unknown>): void => {
    setRefusal(writeRefusalFrom(error) ?? { reason: "unknown" })
    setRetry(() => retryAction)
  }

  const dismiss = (): void => {
    setRefusal(undefined)
    setRetry(undefined)
  }

  /**
   * `RefusalBanner`'s `Try again` control, `undefined` when the refusal that
   * produced the current `refusal` state carried no retry thunk at all.
   * Resolving clears the refusal like a genuine write success would;
   * rejecting re-shows the SAME refusal (through the same `showRefusal`,
   * with the SAME retry thunk still attached) so a second failed retry
   * leaves the banner up rather than silently vanishing.
   */
  const onRetry =
    retry === undefined
      ? undefined
      : (): void => {
          retry().then(
            () => dismiss(),
            (error: unknown) => showRefusal(error, retry),
          )
        }

  /**
   * Wraps a mutation call with the `Saving…`/`Saved` affordance (Task 3) —
   * settles to `"saved"` ONLY on a genuine resolve, never on rejection: a
   * refused write already gets its own banner text via `showRefusal` (fired
   * by the caller's own `.catch`, chained after this), and reporting
   * `"saved"` for it anyway is the exact misreport this affordance exists to
   * prevent. `dismiss` only clears `refusal`, not `saveStatus` — this file's
   * own spec feedback caught that a rejection's `.finally`-based `"saved"`
   * survived a Dismiss tap, since nothing else ever cleared it. On
   * rejection, resets to `"idle"` immediately (not lingering) UNLESS a
   * different, LATER `trackSave` call already settled to `"saved"` in the
   * meantime — never clobber a newer, real success with an older failure's
   * own reset.
   */
  const trackSave = <T,>(promise: Promise<T>): Promise<T> => {
    setSaveStatus("saving")
    return promise.then(
      (value) => {
        setSaveStatus("saved")
        setTimeout(
          () => setSaveStatus((current) => (current === "saved" ? "idle" : current)),
          SAVED_LINGER_MS,
        )
        return value
      },
      (error: unknown) => {
        setSaveStatus((current) => (current === "saving" ? "idle" : current))
        throw error
      },
    )
  }

  return { refusal, saveStatus, showRefusal, dismiss, trackSave, onRetry }
}

export interface RefusalBannerProps {
  readonly refusal: RefusalState | undefined
  readonly saveStatus: SaveStatus
  readonly onDismiss: () => void
  /** `useRefusal.onRetry` — absent when the current refusal carried no retry thunk, in which case the banner offers no `Try again` control at all (task 01's own `head-unresolved`, e.g., is never even routed through here — see `Plan.tsx`/`Review.tsx`'s "no view yet" branch instead). */
  readonly onRetry?: (() => void) | undefined
}

/**
 * The one refusal/save-status surface, mounted at the top of both `Plan` and
 * `Review` (package 03's Task 1/3) — `role="status" aria-live="polite"` so a
 * screen reader announces it the moment it appears, with no user action
 * needed to discover it. Renders nothing when there is neither a refusal nor
 * a save in flight/just-settled, rather than an empty live region.
 */
// fallow-ignore-next-line complexity
export const RefusalBanner = ({ refusal, saveStatus, onDismiss, onRetry }: RefusalBannerProps) => {
  const message =
    refusal !== undefined
      ? messageFor(refusal)
      : saveStatus === "saving"
        ? "Saving…"
        : saveStatus === "saved"
          ? "Saved"
          : undefined
  if (message === undefined) return null
  return (
    <Notice
      data-testid="refusal-banner"
      role="status"
      aria-live="polite"
      tone={refusal !== undefined ? "error" : "info"}
      className="flex items-center justify-between gap-2"
    >
      <span data-testid="refusal-message">{message}</span>
      {refusal !== undefined && (
        <div className="flex gap-2">
          {onRetry !== undefined && (
            <Button variant="secondary" data-testid="refusal-retry" onClick={onRetry}>
              Try again
            </Button>
          )}
          <Button variant="ghost" data-testid="refusal-dismiss" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </Notice>
  )
}
