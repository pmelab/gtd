import { useState } from "react"
import { writeRefusalFrom, type WriteRefusalInfo } from "./api.js"

/** Every shape `useRefusal.show` can hold — `WriteRefusalInfo`'s six named reasons, plus `"unknown"` for an error `writeRefusalFrom` can't read at all (a network failure, a dead server) — package 03's own seventh, generic sentence. */
export type RefusalState = WriteRefusalInfo | { readonly reason: "unknown" }

/** One sentence per reason, naming which token moved for `stale-token` when known — never `error.message` (`api.ts#writeRefusalFrom`'s own doc comment: that text is for a log, not a client to display). */
// fallow-ignore-next-line complexity
const messageFor = (refusal: RefusalState): string => {
  switch (refusal.reason) {
    case "stale-token":
      return refusal.moved === "sha"
        ? "Someone else committed a change underneath you — reload to see the latest before trying again."
        : refusal.moved === "content-hash"
          ? "The file's content changed underneath you — reload to see the latest before trying again."
          : "This file changed underneath you — reload to see the latest before trying again."
    case "not-resting":
      return "This step no longer rests with you, so that write was refused."
    case "file-vanished":
      return "The file this screen was editing is no longer being served."
    case "anchor-unresolved":
      return "That item no longer matches the file on disk, so the write was refused."
    case "note-collision":
      return "Another note already occupies this spot."
    case "unsupported-mode":
      return "This steering file's mode isn't supported by the phone client."
    case "unknown":
      return "That write didn't go through — check your connection and try again."
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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")

  /** Reads a thrown mutation error the same way every `.catch` in `Question.tsx`/`Review.tsx`/`Plan.tsx` already does — never `error.message`. */
  const showRefusal = (error: unknown): void => {
    setRefusal(writeRefusalFrom(error) ?? { reason: "unknown" })
  }

  const dismiss = (): void => setRefusal(undefined)

  /**
   * Wraps a mutation call with the `Saving…`/`Saved` affordance (Task 3) —
   * settles to `"saved"` regardless of outcome (a rejection already gets its
   * own banner text via `showRefusal`, fired by the caller's own `.catch`),
   * then clears back to `"idle"` after `SAVED_LINGER_MS` so blur — invisible
   * on touch otherwise — visibly reports whether the write landed.
   */
  const trackSave = <T,>(promise: Promise<T>): Promise<T> => {
    setSaveStatus("saving")
    return promise.finally(() => {
      setSaveStatus("saved")
      setTimeout(
        () => setSaveStatus((current) => (current === "saved" ? "idle" : current)),
        SAVED_LINGER_MS,
      )
    })
  }

  return { refusal, saveStatus, showRefusal, dismiss, trackSave }
}

export interface RefusalBannerProps {
  readonly refusal: RefusalState | undefined
  readonly saveStatus: SaveStatus
  readonly onDismiss: () => void
}

/**
 * The one refusal/save-status surface, mounted at the top of both `Plan` and
 * `Review` (package 03's Task 1/3) — `role="status" aria-live="polite"` so a
 * screen reader announces it the moment it appears, with no user action
 * needed to discover it. Renders nothing when there is neither a refusal nor
 * a save in flight/just-settled, rather than an empty live region.
 */
// fallow-ignore-next-line complexity
export const RefusalBanner = ({ refusal, saveStatus, onDismiss }: RefusalBannerProps) => {
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
    <div
      data-testid="refusal-banner"
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 12px",
        background: refusal !== undefined ? "#3a2a00" : "#111",
        borderBottom: "1px solid #333",
      }}
    >
      <span data-testid="refusal-message">{message}</span>
      {refusal !== undefined && (
        <button type="button" data-testid="refusal-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  )
}
