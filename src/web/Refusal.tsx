import { useSyncExternalStore } from "react"
import type { ReadRefusalInfo } from "./api.js"
import { Button } from "./Button.js"
import { cn } from "./cn.js"
import { indicatorCounts, useWriteStore, type RefusalState, type SaveStatus } from "./writeStore.js"

/**
 * One sentence per reason, naming which token moved for `stale-token` when
 * known — never `error.message` (`api.ts#writeRefusalFrom`'s own doc
 * comment: that text is for a log, not a client to display). The value has
 * already reverted by the time any of these show (the store's own immediate
 * rollback on failure), so every sentence points at redoing the action, not
 * at a `Try again` control this indicator no longer offers.
 */
// fallow-ignore-next-line complexity
const messageFor = (refusal: RefusalState): string => {
  switch (refusal.reason) {
    case "stale-token":
      return refusal.moved === "sha"
        ? "Someone else committed a change underneath you, and the automatic retry still didn't land. The change reverted — redo it to save again."
        : refusal.moved === "content-hash"
          ? "The file's content changed underneath you. The change reverted — redo it once you've seen the latest."
          : "This file changed underneath you. The change reverted — redo it to save again."
    case "not-resting":
      return "This step no longer rests with you, so that write was refused."
    case "file-vanished":
      return "The file this screen was editing is no longer being served."
    case "anchor-unresolved":
      return "That item no longer matches the file on disk. The change reverted — redo it on the latest version."
    case "note-collision":
      return "Another note already occupies this spot."
    case "unknown":
      return "That write didn't go through and reverted — check your connection and redo it."
  }
}

/**
 * One sentence per `readSteeringFile` refusal reason — `Plan.tsx`/`Review.tsx`
 * render this in their "no view yet" branch instead of the generic "Could
 * not load the plan/review." fallback.
 */
export const messageForReadRefusal = (refusal: ReadRefusalInfo): string => {
  switch (refusal.reason) {
    case "head-unresolved":
      return "Can't read this repository's current commit — editing is disabled until that's fixed."
    case "file-vanished":
      return "The file this screen would show is no longer being served."
  }
}

/** `usePrefersReducedMotion`'s own live media-query subscription — a spinner and a settled dot are otherwise the ONLY two shapes distinguishing `saving` from `saved`, so losing motion can't just freeze the spinner's current frame; it has to switch to a differently-styled static dot. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

const usePrefersReducedMotion = (): boolean =>
  useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(REDUCED_MOTION_QUERY)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  )

export interface SaveIndicatorProps {
  readonly refusal: RefusalState | undefined
  readonly saveStatus: SaveStatus
  readonly expanded: boolean
  /** The total count of failed cells still carrying an unclear dot. */
  readonly failedCount: number
  /** The count of OTHER failed cells besides the one `refusal` names — drives the "…and N other writes didn't land" suffix, absent at `0`. */
  readonly otherFailedCount: number
  readonly onDismiss: () => void
  readonly onReExpand: () => void
}

/** The write store's own `SaveIndicatorProps` — one selector hook, so the three containers each spread `<SaveIndicator {...useSaveIndicatorProps()} />` with no shape to duplicate. */
export const useSaveIndicatorProps = (): SaveIndicatorProps => {
  const saveStatus = useWriteStore((s) => s.saveStatus)
  const expanded = useWriteStore((s) => s.expanded)
  const failed = useWriteStore((s) => s.failed)
  const dismiss = useWriteStore((s) => s.dismiss)
  const reExpand = useWriteStore((s) => s.reExpand)

  let latest: RefusalState | undefined
  for (const entry of failed.values()) latest = entry

  return {
    refusal: latest,
    saveStatus,
    expanded,
    ...indicatorCounts(failed),
    onDismiss: dismiss,
    onReExpand: reExpand,
  }
}

/** The visible, collapsed dot/spinner shared by `saving`/`saved`/`failed` — sized and shaped identically so only colour (and, for `saving`, motion) carries the state. */
const Dot = ({
  state,
  reducedMotion,
}: {
  readonly state: SaveStatus
  readonly reducedMotion: boolean
}) => {
  if (state === "saving" && !reducedMotion) {
    return (
      <span
        aria-hidden="true"
        data-testid="save-indicator-dot"
        data-state="saving"
        className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent"
      />
    )
  }
  // `saving` under reduced motion is a FILLED dot like `saved`'s own, so it
  // needs a second cue besides colour to stay distinguishable — an outline
  // ring `saved` never carries.
  const reducedSavingRing =
    state === "saving" ? "outline outline-2 outline-offset-2 outline-muted" : ""
  return (
    <span
      aria-hidden="true"
      data-testid="save-indicator-dot"
      data-state={state}
      className={cn("size-4 rounded-full bg-accent", reducedSavingRing)}
    />
  )
}

/** The failed marker's own accessible name — says what tapping it does, since "looks tappable" (the requirement) still needs a screen reader to know it's more than decoration. */
const failedMarkerLabel = (failedCount: number): string =>
  failedCount > 1
    ? `${failedCount} writes failed — tap to see details`
    : "A write failed — tap to see details"

/** The expanded message's own count suffix — an accepted loss: only the LATEST refusal's wording is ever readable, so a burst's earlier, possibly more actionable sentence is lost; every refused cell still keeps its own dot, so no failure is invisible, only its wording. */
const countSuffix = (otherFailedCount: number): string =>
  otherFailedCount > 0
    ? ` …and ${otherFailedCount} other write${otherFailedCount === 1 ? "" : "s"} didn't land.`
    : ""

/**
 * The one refusal/save-status surface — every return branch below carries
 * its own `absolute right-3 bottom-3 z-10`, positioned against `App.tsx`'s
 * column, which only supplies the `relative` ancestor those classes anchor
 * to — so showing or hiding it, expanded or collapsed, shifts nothing else
 * on screen. `role="status" aria-live="polite"` announces it the moment it
 * changes. Renders nothing at all when there is neither a refusal, a failed
 * cell, nor a save in flight/just-settled. Keeps exactly two controls: tap
 * the collapsed marker to re-expand, and `Dismiss` — there is no `Try
 * again`, since the store already rolled the write back by the time this
 * ever shows.
 */
// fallow-ignore-next-line complexity
export const SaveIndicator = ({
  refusal,
  saveStatus,
  expanded,
  failedCount,
  otherFailedCount,
  onDismiss,
  onReExpand,
}: SaveIndicatorProps) => {
  const reducedMotion = usePrefersReducedMotion()
  const isFailed = failedCount > 0
  const hiddenLabel =
    !isFailed && saveStatus === "saving"
      ? "Saving…"
      : !isFailed && saveStatus === "saved"
        ? "Saved"
        : undefined

  if (!isFailed && saveStatus === "idle") return null

  if (isFailed && expanded && refusal !== undefined) {
    const message = `${messageFor(refusal)}${countSuffix(otherFailedCount)}`
    return (
      <div
        data-testid="save-indicator"
        role="status"
        aria-live="polite"
        className="absolute right-3 bottom-3 z-10 max-w-[calc(100%-1.5rem)] rounded border border-danger bg-surface p-3 text-body text-text"
      >
        <div data-testid="save-indicator-expanded">
          <span data-testid="save-indicator-message">{message}</span>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" data-testid="save-indicator-dismiss" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // A failed cell ALWAYS outranks a concurrent `saving`/`saved` when
  // collapsed — a refusal is reported nowhere else, where a success is also
  // reported by the value staying put.
  if (isFailed) {
    return (
      <div
        data-testid="save-indicator"
        role="status"
        aria-live="polite"
        className="absolute right-3 bottom-3 z-10"
      >
        <Button
          variant="ghost"
          data-testid="save-indicator-marker"
          aria-label={failedMarkerLabel(failedCount)}
          onClick={onReExpand}
          className="grid place-items-center rounded-full p-0"
        >
          <span
            aria-hidden="true"
            data-testid="save-indicator-dot"
            data-state="failed"
            className="size-4 rounded-full bg-danger"
          />
        </Button>
      </div>
    )
  }

  return (
    <div
      data-testid="save-indicator"
      role="status"
      aria-live="polite"
      className="absolute right-3 bottom-3 z-10"
    >
      <Dot state={saveStatus} reducedMotion={reducedMotion} />
      {hiddenLabel !== undefined && (
        <span data-testid="save-indicator-label" className="sr-only">
          {hiddenLabel}
        </span>
      )}
    </div>
  )
}
