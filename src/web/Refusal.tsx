import { Check, CircleAlert, LoaderCircle, X } from "lucide-react"
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

/** A failed marker says what tapping it does: "looks tappable" still needs a name for a screen reader. */
const failedMarkerLabel = (failedCount: number): string =>
  failedCount > 1
    ? `${failedCount} writes failed — tap to see details`
    : "A write failed — tap to see details"

/** Only the LATEST refusal's wording is readable; every refused cell still keeps its own mark, so no failure is invisible, only its wording. */
const countSuffix = (otherFailedCount: number): string =>
  otherFailedCount > 0
    ? ` …and ${otherFailedCount} other write${otherFailedCount === 1 ? "" : "s"} didn't land.`
    : ""

/** Bottom-centre, clear of the Done bar; absolute, so showing it shifts nothing. */
const TOAST =
  "absolute bottom-20 left-1/2 z-20 -translate-x-1/2 rounded-lg border bg-popover text-popover-foreground shadow-[0_4px_16px_rgb(21_26_29/0.12)]"

/**
 * The one refusal/save-status surface. `role="status" aria-live="polite"`
 * announces it the moment it changes. Renders nothing when there is neither
 * a refusal, a failed cell, nor a save in flight/just settled. There is no
 * `Try again`: the store already rolled the write back by the time it shows.
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

  if (!isFailed && saveStatus === "idle") return null

  if (isFailed && expanded && refusal !== undefined) {
    const message = `${messageFor(refusal)}${countSuffix(otherFailedCount)}`
    return (
      <div
        data-testid="save-indicator"
        role="status"
        aria-live="polite"
        className={cn(TOAST, "w-[min(28rem,calc(100%-2rem))] border-destructive/40 p-3 text-sm")}
      >
        <div data-testid="save-indicator-expanded" className="flex items-start gap-3">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span data-testid="save-indicator-message" className="min-w-0 flex-1 leading-relaxed">
            {message}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss"
            data-testid="save-indicator-dismiss"
            className="-my-1.5 -mr-1.5 lg:size-8"
            onClick={onDismiss}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
    )
  }

  // A failed cell ALWAYS outranks a concurrent `saving`/`saved` when
  // collapsed: a refusal is reported nowhere else, where a success is also
  // reported by the value staying put.
  if (isFailed) {
    return (
      <div data-testid="save-indicator" role="status" aria-live="polite" className={TOAST}>
        <Button
          variant="ghost"
          size="sm"
          data-testid="save-indicator-marker"
          aria-label={failedMarkerLabel(failedCount)}
          onClick={onReExpand}
          className="rounded-lg text-destructive"
        >
          <CircleAlert aria-hidden="true" data-testid="save-indicator-dot" data-state="failed" />
          <span className="tabular-nums">
            {failedCount > 1 ? `${failedCount} writes failed` : "Not saved"}
          </span>
        </Button>
      </div>
    )
  }

  const saving = saveStatus === "saving"
  const Icon = saving ? LoaderCircle : Check
  return (
    <div
      data-testid="save-indicator"
      role="status"
      aria-live="polite"
      className={cn(TOAST, "flex h-8 items-center gap-1.5 px-3 text-xs font-medium")}
    >
      <Icon
        aria-hidden="true"
        data-testid="save-indicator-dot"
        data-state={saveStatus}
        className={cn(
          "size-3.5",
          saving ? "text-muted-foreground" : "text-success",
          saving && !reducedMotion && "animate-spin",
        )}
      />
      <span data-testid="save-indicator-label">{saving ? "Saving…" : "Saved"}</span>
    </div>
  )
}
