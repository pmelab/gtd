import type { BeatRead, WorktreeRef } from "./Beat.js"
import { discoverWorktrees } from "./Discover.js"

export type FleetBucket = "wants-you" | "working" | "broken" | "quiet"

/** One row on the fleet screen — a `BeatRead` plus the bucket it landed in. */
export type FleetEntry = BeatRead & { readonly bucket: FleetBucket }

/**
 * `idle` is load-bearing and `actor` alone is not: an idle worktree reports
 * `actor: human` too (the last human turn is still on record even though
 * nothing is waiting on anyone). So **Wants you** is `!idle && actor ===
 * "human"`, plus every `stalled` kind regardless of actor/idle. **Broken** is
 * anything `BeatCache` couldn't read cleanly. **Quiet** is `idle`. **Working**
 * is whatever is left — today that's a not-idle agent-actor row; once a loop
 * registry exists (a later package) it becomes that registry's answer
 * instead, but the bucket taxonomy here doesn't change shape for that.
 */
export const bucketOf = (row: BeatRead): FleetBucket => {
  if (row.status === "broken") return "broken"
  if (row.kind === "stalled") return "wants-you"
  if (!row.idle && row.actor === "human") return "wants-you"
  if (row.idle) return "quiet"
  return "working"
}

const bucketOrder: readonly FleetBucket[] = ["wants-you", "working", "broken", "quiet"]

/**
 * `Wants you` sorts oldest-rest-first (the longest-waiting human turn floats
 * to the top); every other bucket sorts newest-first. A `broken` row has no
 * `rest` field at all — it sorts after every row that has one, stable
 * otherwise.
 */
const restOf = (row: BeatRead): string | undefined => (row.status === "ok" ? row.rest : undefined)

const compareRest = (a: BeatRead, b: BeatRead, oldestFirst: boolean): number => {
  const ra = restOf(a)
  const rb = restOf(b)
  if (ra === undefined && rb === undefined) return 0
  if (ra === undefined) return 1
  if (rb === undefined) return -1
  return oldestFirst ? ra.localeCompare(rb) : rb.localeCompare(ra)
}

/** Groups and sorts `BeatRead`s into the four buckets, in fixed display order. */
export const groupIntoBuckets = (
  rows: readonly BeatRead[],
): Record<FleetBucket, readonly FleetEntry[]> => {
  const grouped: Record<FleetBucket, FleetEntry[]> = {
    "wants-you": [],
    working: [],
    broken: [],
    quiet: [],
  }
  for (const row of rows) {
    const bucket = bucketOf(row)
    grouped[bucket].push({ ...row, bucket })
  }
  for (const bucket of bucketOrder) {
    grouped[bucket].sort((a, b) => compareRest(a, b, bucket === "wants-you"))
  }
  return grouped
}

/** The document title's own Wants-you count. */
export const wantsYouCount = (buckets: Record<FleetBucket, readonly FleetEntry[]>): number =>
  buckets["wants-you"].length

export interface FleetPayload {
  readonly buckets: Record<FleetBucket, readonly FleetEntry[]>
  readonly wantsYouCount: number
}

export interface FleetDeps {
  readonly roots: readonly string[]
  readonly readBeat: (worktree: WorktreeRef) => Promise<BeatRead>
}

/**
 * The whole fleet read: re-scans the configured roots (never memoized —
 * `Discover.ts`'s own contract), reads every worktree's beat through
 * `readBeat` (a `BeatCache.read` in production, so warm entries cost no
 * subprocess), and assembles the four buckets. One worktree's read failing
 * lands it in Broken; it never fails the whole request.
 */
export const readFleet = async (deps: FleetDeps): Promise<FleetPayload> => {
  const worktrees = await discoverWorktrees(deps.roots)
  const rows = await Promise.all(
    worktrees.map(async (w): Promise<BeatRead> => {
      try {
        return await deps.readBeat(w)
      } catch (error) {
        // A `readBeat` throw (rather than a returned Broken row) must not
        // sink the whole request — one worktree's unexpected failure stays
        // scoped to its own row.
        return {
          status: "broken",
          id: w.id,
          path: w.path,
          repo: "",
          branch: "",
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  )
  const buckets = groupIntoBuckets(rows)
  return { buckets, wantsYouCount: wantsYouCount(buckets) }
}
