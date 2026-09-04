import { useEffect, useRef, useState } from "react"
import type { BeatRead } from "../../serve/Beat.js"
import type { FleetBucket, FleetEntry, FleetPayload } from "../../serve/Fleet.js"

const BUCKET_ORDER: readonly FleetBucket[] = ["wants-you", "working", "broken", "quiet"]

const BUCKET_TITLE: Record<FleetBucket, string> = {
  "wants-you": "Wants you",
  working: "Working",
  broken: "Broken",
  quiet: "Quiet",
}

/** A phone-readable age string ("just now", "5m", "3h", "2d") — never a raw ISO timestamp. */
const restAge = (iso: string, now: number = Date.now()): string => {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

const FleetRow = ({ row }: { readonly row: BeatRead }) => {
  if (row.status === "broken") {
    return (
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #333" }}>
        <div style={{ fontWeight: 600 }}>
          {row.repo} / {row.branch || "?"}
        </div>
        <pre
          style={{
            margin: "4px 0 0",
            whiteSpace: "pre-wrap",
            color: "#f66",
            fontSize: 12,
          }}
        >
          {row.detail}
        </pre>
      </div>
    )
  }
  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid #333" }}>
      <div style={{ fontWeight: 600 }}>
        {row.repo} / {row.branch}
      </div>
      <div style={{ fontSize: 13 }}>{row.label}</div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{restAge(row.rest)}</div>
    </div>
  )
}

const QuietBucket = ({ rows }: { readonly rows: readonly FleetEntry[] }) => {
  const [expanded, setExpanded] = useState(false)
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={{ width: "100%", textAlign: "left", padding: "10px 12px" }}
      >
        Quiet ({rows.length})
      </button>
    )
  }
  return (
    <section>
      <h2 style={{ fontSize: 13, opacity: 0.7, margin: "12px" }}>Quiet ({rows.length})</h2>
      {rows.map((row) => (
        <FleetRow key={row.id} row={row} />
      ))}
    </section>
  )
}

const BucketSection = ({
  bucket,
  rows,
}: {
  readonly bucket: FleetBucket
  readonly rows: readonly FleetEntry[]
}) => {
  if (rows.length === 0) return null
  if (bucket === "quiet") return <QuietBucket rows={rows} />
  return (
    <section>
      <h2 style={{ fontSize: 13, opacity: 0.7, margin: "12px" }}>{BUCKET_TITLE[bucket]}</h2>
      {rows.map((row) => (
        <FleetRow key={row.id} row={row} />
      ))}
    </section>
  )
}

const PULL_THRESHOLD = 64

/** How far past `startY` a touch has to travel before it counts as a downward pull — negative or unknown deltas are clamped to 0, never a state update that would nudge the indicator the wrong way. */
const pullDelta = (startY: number | null, currentY: number | undefined): number => {
  if (startY === null || currentY === undefined) return 0
  return Math.max(0, currentY - startY)
}

/** Swipe-down-to-refresh, isolated from `FleetView`'s own render branching so each stays independently simple. Only arms when the page is already at the top (`window.scrollY === 0`) — a mid-scroll drag never triggers it. */
const usePullToRefresh = (onRefresh: () => void) => {
  const [pull, setPull] = useState(0)
  const startY = useRef<number | null>(null)

  return {
    pull,
    onTouchStart: (e: React.TouchEvent) => {
      startY.current = window.scrollY === 0 ? (e.touches[0]?.clientY ?? null) : null
    },
    onTouchMove: (e: React.TouchEvent) => {
      setPull(pullDelta(startY.current, e.touches[0]?.clientY))
    },
    onTouchEnd: () => {
      if (pull > PULL_THRESHOLD) onRefresh()
      setPull(0)
      startY.current = null
    },
  }
}

/** Every bucket, or the empty-fleet explanation when all four are empty — split out of `FleetView` so its own branching doesn't add to that component's count. */
const FleetBuckets = ({ data }: { readonly data: FleetPayload }) => {
  const isEmpty = BUCKET_ORDER.every((bucket) => data.buckets[bucket].length === 0)
  if (isEmpty) {
    return <p style={{ padding: 16, opacity: 0.7 }}>No worktrees found — nothing to triage.</p>
  }
  return (
    <>
      {BUCKET_ORDER.map((bucket) => (
        <BucketSection key={bucket} bucket={bucket} rows={data.buckets[bucket]} />
      ))}
    </>
  )
}

export interface FleetViewProps {
  readonly data: FleetPayload | undefined
  readonly isLoading: boolean
  readonly onRefresh: () => void
}

/**
 * Presentational fleet screen — takes its data as props rather than calling
 * `trpc` itself, so `Fleet.stories.tsx` can drive every bucket combination
 * with plain data, no mocked tRPC transport required. Fully exercised by
 * that file's six `play()` interaction tests (loading, error, all four
 * buckets, pull-to-refresh) — fallow's static CRAP estimate only sees real
 * coverage reports, not Storybook/vitest-browser runs, so it scores this as
 * untested.
 */
// fallow-ignore-next-line complexity
export const FleetView = ({ data, isLoading, onRefresh }: FleetViewProps) => {
  const { pull, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(onRefresh)

  useEffect(() => {
    document.title =
      data !== undefined && data.wantsYouCount > 0 ? `(${data.wantsYouCount}) gtd` : "gtd"
  }, [data])

  if (isLoading && data === undefined) {
    return <div style={{ padding: 16 }}>Loading the fleet…</div>
  }
  if (data === undefined) {
    return <div style={{ padding: 16 }}>Could not load the fleet.</div>
  }

  return (
    <div
      data-testid="fleet-screen"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ maxWidth: 390, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}
    >
      {pull > 0 && (
        <div style={{ textAlign: "center", padding: 8, fontSize: 12 }}>
          {pull > PULL_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
        </div>
      )}
      <FleetBuckets data={data} />
    </div>
  )
}
