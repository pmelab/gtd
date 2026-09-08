import type { BeatRead, WorktreeRef } from "./Beat.js"
import { discoverWorktrees } from "./Discover.js"
import type { Registry } from "./Registry.js"

export type FleetBucket = "wants-you" | "working" | "broken" | "quiet"

/** One row on the fleet screen — a `BeatRead` plus the bucket it landed in, plus T4's own imprecise foreign-driver signal (always `false` for a `broken` row, since there's no `logMtime` to read it off). */
export type FleetEntry = BeatRead & {
  readonly bucket: FleetBucket
  readonly foreignDriverPossible: boolean
}

/**
 * `idle` is load-bearing and `actor` alone is not: an idle worktree reports
 * `actor: human` too (the last human turn is still on record even though
 * nothing is waiting on anyone). So **Wants you** is `!idle && actor ===
 * "human"`, plus every `stalled` kind regardless of actor/idle. **Broken** is
 * anything `BeatCache` couldn't read cleanly. **Quiet** is `idle`. **Working**
 * is whatever is left — today that's a not-idle agent-actor row, OR any row
 * the `Registry` (T3) reports as having a live child, which always wins:
 * `driving` is checked before anything else, since a worktree the server
 * itself is actively driving belongs in Working even if its beat is
 * transiently unreadable mid-turn.
 */
export const bucketOf = (row: BeatRead, driving: boolean = false): FleetBucket => {
  if (driving) return "working"
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

/**
 * Compares the parsed INSTANT, never the ISO string itself: `rest` is `git
 * log`'s `%cI`, which carries the committer's own UTC offset rather than a
 * normalized `Z` — a fleet mixes offsets routinely (any worktree last
 * committed by CI or a colleague elsewhere), and two differently-offset
 * timestamps can compare backwards lexically even though `Date.parse`
 * orders them correctly.
 */
const compareRest = (a: BeatRead, b: BeatRead, oldestFirst: boolean): number => {
  const ra = restOf(a)
  const rb = restOf(b)
  if (ra === undefined && rb === undefined) return 0
  if (ra === undefined) return 1
  if (rb === undefined) return -1
  const diff = Date.parse(ra) - Date.parse(rb)
  return oldestFirst ? diff : -diff
}

/** The `Registry` (T3) plus a clock, both optional so every existing single-argument call keeps working with no server-side driving/foreign-driver signal at all. */
export interface BucketingContext {
  readonly registry?: Registry
  readonly now?: number
}

/** Groups and sorts `BeatRead`s into the four buckets, in fixed display order — consulting `ctx.registry` (T3/T4) for the Working override and the foreign-driver signal when one is given. */
export const groupIntoBuckets = (
  rows: readonly BeatRead[],
  ctx: BucketingContext = {},
): Record<FleetBucket, readonly FleetEntry[]> => {
  const now = ctx.now ?? Date.now()
  const grouped: Record<FleetBucket, FleetEntry[]> = {
    "wants-you": [],
    working: [],
    broken: [],
    quiet: [],
  }
  for (const row of rows) {
    const driving = ctx.registry?.isDriving(row.id) ?? false
    const bucket = bucketOf(row, driving)
    const foreignDriverPossible =
      ctx.registry !== undefined && row.status === "ok"
        ? ctx.registry.possiblyForeignDriven(row.id, row.logMtime, now)
        : false
    grouped[bucket].push({ ...row, bucket, foreignDriverPossible })
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
  /** The server's own `Registry` (T3) — `undefined` only in tests that don't care about Working/foreign-driver at all. */
  readonly registry?: Registry
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
  const buckets = groupIntoBuckets(
    rows,
    deps.registry !== undefined ? { registry: deps.registry } : {},
  )
  return { buckets, wantsYouCount: wantsYouCount(buckets) }
}
