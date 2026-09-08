import { useEffect, useRef, useState } from "react"
import type { FleetBucket, FleetEntry, FleetPayload } from "../../serve/Fleet.js"
import { trpc } from "../api.js"

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

/** One steering file a Fleet row points at — `worktreePath` is the row's own `path`, `filePath`/`mode` are the beat-reported fields (`Beat.ts#FleetRow.file`/`.mode`) that only exist when a rest actually has a steering file to open. */
export interface OpenSteeringTarget {
  readonly worktreePath: string
  readonly filePath: string
  readonly mode: string
}

/** Requirement 6's "failures show the captured output and the exit code inline" — the SAME verbatim `stdout`/`stderr` rendering `BrokenRow`'s own `detail` uses below, never summarized or re-worded. */
const LoopFailureDetail = ({
  failure,
}: {
  readonly failure: NonNullable<FleetEntry["lastLoopFailure"]>
}) => (
  <div data-testid="loop-failure" style={{ marginTop: 4 }}>
    <div style={{ fontSize: 11, opacity: 0.7 }}>
      loop exited {failure.spawnError !== undefined ? "— never started" : `${failure.status}`}
    </div>
    <pre style={{ margin: "2px 0 0", whiteSpace: "pre-wrap", color: "#f66", fontSize: 12 }}>
      {failure.spawnError ?? `${failure.stdout}${failure.stderr}`}
    </pre>
  </div>
)

const FleetRowBroken = ({ row }: { readonly row: Extract<FleetEntry, { status: "broken" }> }) => (
  <div style={{ padding: "10px 12px", borderBottom: "1px solid #333" }}>
    <div style={{ fontWeight: 600 }}>
      {row.repo} / {row.branch || "?"}
    </div>
    <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", color: "#f66", fontSize: 12 }}>
      {row.detail}
    </pre>
  </div>
)

/**
 * The "why might this be dirty" slot — mutually exclusive, deliberately: a
 * dirty prompt rest with a recently-touched log is ALSO the normal mid-turn
 * shape of a foreign driver actively working in it, so printing both here
 * would have one row claim "nothing driving it" right above "possibly
 * driven elsewhere". `foreignDriverPossible` is the more specific,
 * actionable of the two observations, so it wins; `interrupted` states only
 * what gtd can actually observe (dirty, no driver), never an inferred CAUSE
 * (a restart is one possible explanation, never the only one — a crash or a
 * manual kill read identically). Split out of `FleetRowBody` so ITS own
 * branch on which one to show doesn't also carry the rest of the row's
 * markup.
 */
const FleetRowDirtyReason = ({ row }: { readonly row: Extract<FleetEntry, { status: "ok" }> }) => {
  if (row.foreignDriverPossible) {
    return (
      <div style={{ fontSize: 11, opacity: 0.7, color: "#fa4" }}>
        possibly driven elsewhere — imprecise, based on a recently-touched log
      </div>
    )
  }
  if (row.interrupted === true) {
    return (
      <div data-testid="interrupted-badge" style={{ fontSize: 11, color: "#e0a030" }}>
        Dirty, with nothing currently driving it
      </div>
    )
  }
  return null
}

/** The info stack every ok row shows regardless of whether it's wrapped in an open button — split out so `FleetRow` itself stays a flat dispatch, not one function carrying every branch's markup. */
const FleetRowBody = ({ row }: { readonly row: Extract<FleetEntry, { status: "ok" }> }) => (
  <>
    <div style={{ fontWeight: 600 }}>
      {row.repo} / {row.branch}
    </div>
    <div style={{ fontSize: 13 }}>{row.label}</div>
    <div style={{ fontSize: 12, opacity: 0.7 }}>{restAge(row.rest)}</div>
    <FleetRowDirtyReason row={row} />
    {row.lastLoopFailure !== undefined && <LoopFailureDetail failure={row.lastLoopFailure} />}
  </>
)

const OPEN_BUTTON_STYLE = {
  flex: 1,
  textAlign: "left" as const,
  border: "none",
  background: "none",
  color: "inherit",
  font: "inherit",
  padding: 0,
}

/** An openable row's own button wrapper — `file`/`mode` are guaranteed present by `FleetRow`'s own `canOpen` check before this ever renders. */
const FleetRowOpenButton = ({
  row,
  onOpen,
}: {
  readonly row: Extract<FleetEntry, { status: "ok" }>
  readonly onOpen: (target: OpenSteeringTarget) => void
}) => (
  <button
    type="button"
    data-testid={`fleet-row-open-${row.id}`}
    onClick={() => onOpen({ worktreePath: row.path, filePath: row.file!, mode: row.mode! })}
    style={OPEN_BUTTON_STYLE}
  >
    <FleetRowBody row={row} />
  </button>
)

const FleetRowStopButton = ({
  worktreePath,
  rowId,
  onStop,
}: {
  readonly worktreePath: string
  readonly rowId: string
  readonly onStop: (worktreePath: string) => void
}) => (
  <button
    type="button"
    data-testid={`fleet-row-stop-${rowId}`}
    onClick={() => onStop(worktreePath)}
  >
    Stop
  </button>
)

/**
 * A Working row's own trailing slot: a real Stop button ONLY when `driving`
 * (the server's own `Registry` has a live child for it — the ONE thing
 * `stop` can actually signal), never for a foreign driver — T5's "a no-op,
 * not an error" describes what the SERVER does when nothing is live for a
 * worktree, not a license to offer a control that quietly does nothing and
 * leaves the human guessing why the row never changed. A foreign-driven
 * Working row states that plainly instead of a dead button.
 */
const FleetRowTrailing = ({
  row,
  onStop,
}: {
  readonly row: Extract<FleetEntry, { status: "ok" }>
  readonly onStop: ((worktreePath: string) => void) | undefined
}) => {
  // `onStop` absent entirely means the caller never wired Stop up at all
  // (e.g. a pure-data story not exercising it) — render nothing, same as
  // before this split existed, rather than a message about a driving state
  // no one asked about.
  if (row.bucket !== "working" || onStop === undefined) return null
  if (row.driving) {
    return <FleetRowStopButton worktreePath={row.path} rowId={row.id} onStop={onStop} />
  }
  return (
    <div
      data-testid={`fleet-row-unstoppable-${row.id}`}
      style={{ fontSize: 11, opacity: 0.6, maxWidth: 120, textAlign: "right" }}
    >
      gtd did not spawn this — it cannot be stopped from here
    </div>
  )
}

/** Either the tappable open button (`file`+`mode` present, `onOpen` given) or a plain, non-interactive info stack — split out of `FleetRow` so ITS branch on `canOpen` doesn't also carry the row's outer wrapper/Stop-button markup. */
const FleetRowMain = ({
  row,
  onOpen,
}: {
  readonly row: Extract<FleetEntry, { status: "ok" }>
  readonly onOpen: ((target: OpenSteeringTarget) => void) | undefined
}) =>
  onOpen !== undefined && row.file !== undefined && row.mode !== undefined ? (
    <FleetRowOpenButton row={row} onOpen={onOpen} />
  ) : (
    <div style={{ flex: 1 }}>
      <FleetRowBody row={row} />
    </div>
  )

const FleetRow = ({
  row,
  onOpen,
  onStop,
}: {
  readonly row: FleetEntry
} & RowCallbacks) => {
  if (row.status === "broken") return <FleetRowBroken row={row} />
  return (
    <div
      data-testid={`fleet-row-${row.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "10px 12px",
        borderBottom: "1px solid #333",
      }}
    >
      <FleetRowMain row={row} onOpen={onOpen} />
      <FleetRowTrailing row={row} onStop={onStop} />
    </div>
  )
}

/** Threaded down from `FleetView` to every row — both absent in `Fleet.stories.tsx`'s pure-data stories that don't exercise navigation or Stop, same as `PlanView`'s `onSaveNote?`. */
interface RowCallbacks {
  /** Tapping an openable row (one whose beat carries both `file` and `mode`). */
  readonly onOpen?: ((target: OpenSteeringTarget) => void) | undefined
  /** Tapping a Working row's Stop button. */
  readonly onStop?: ((worktreePath: string) => void) | undefined
}

const QuietBucket = ({
  rows,
  onOpen,
  onStop,
}: { readonly rows: readonly FleetEntry[] } & RowCallbacks) => {
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
        <FleetRow key={row.id} row={row} onOpen={onOpen} onStop={onStop} />
      ))}
    </section>
  )
}

const BucketSection = ({
  bucket,
  rows,
  onOpen,
  onStop,
}: {
  readonly bucket: FleetBucket
  readonly rows: readonly FleetEntry[]
} & RowCallbacks) => {
  if (rows.length === 0) return null
  if (bucket === "quiet") return <QuietBucket rows={rows} onOpen={onOpen} onStop={onStop} />
  return (
    <section>
      <h2 style={{ fontSize: 13, opacity: 0.7, margin: "12px" }}>{BUCKET_TITLE[bucket]}</h2>
      {rows.map((row) => (
        <FleetRow key={row.id} row={row} onOpen={onOpen} onStop={onStop} />
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
const FleetBuckets = ({ data, onOpen, onStop }: { readonly data: FleetPayload } & RowCallbacks) => {
  const isEmpty = BUCKET_ORDER.every((bucket) => data.buckets[bucket].length === 0)
  if (isEmpty) {
    return <p style={{ padding: 16, opacity: 0.7 }}>No worktrees found — nothing to triage.</p>
  }
  return (
    <>
      {BUCKET_ORDER.map((bucket) => (
        <BucketSection
          key={bucket}
          bucket={bucket}
          rows={data.buckets[bucket]}
          onOpen={onOpen}
          onStop={onStop}
        />
      ))}
    </>
  )
}

export interface FleetViewProps extends RowCallbacks {
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
export const FleetView = ({ data, isLoading, onRefresh, onOpen, onStop }: FleetViewProps) => {
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
      <FleetBuckets data={data} onOpen={onOpen} onStop={onStop} />
    </div>
  )
}

/**
 * Re-reads `gtd next --json` every `FLEET_POLL_INTERVAL_MS` on its own,
 * independent of any human pull-to-refresh gesture — requirement 6's "the
 * beat is re-read after the child exits, on any exit code": the server
 * itself pushes nothing (no beat, socket, or invalidation on a child's
 * exit), so polling is what actually surfaces a completed hand-back within a
 * bounded time instead of leaving a stale Working row until the next manual
 * pull.
 */
const FLEET_POLL_INTERVAL_MS = 5_000

/**
 * The real fleet screen: wires `FleetView` to the actual `fleet` tRPC query,
 * plus `stop` (T5) and the row-tap navigation callback threaded down from
 * `App.tsx`. This is the phone's entry screen (`App.tsx` renders it
 * directly) — the requirement's "the fleet screen is the first thing the
 * phone loads".
 */
export const Fleet = ({ onOpen }: { readonly onOpen?: (target: OpenSteeringTarget) => void }) => {
  const query = trpc.fleet.useQuery(undefined, { refetchInterval: FLEET_POLL_INTERVAL_MS })
  const stop = trpc.stop.useMutation({ onSettled: () => void query.refetch() })
  return (
    <FleetView
      data={query.data}
      isLoading={query.isLoading}
      onRefresh={() => void query.refetch()}
      {...(onOpen !== undefined ? { onOpen } : {})}
      onStop={(worktreePath) => stop.mutate({ worktreePath })}
    />
  )
}
