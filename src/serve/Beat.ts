import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { readFile, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { Effect } from "effect"
import { Cwd } from "../Cwd.js"
import type { Actor } from "../StateFields.js"
import { worktreeGitDir } from "../WorktreeState.js"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../../package.json") as { version: string }).version
const CURRENT_MAJOR = Number(GTD_VERSION.split(".")[0])

/**
 * Mirrors `src/Beat.ts`'s (root) `BeatKind` union verbatim, duplicated
 * rather than imported: that module pulls in `Edge.ts` → `PatternConfig.ts`
 * → the bundled workflow YAML, a chain the web client's own `tsconfig.json`
 * (scoped to `src/web/`, no visibility into `src/types.d.ts`'s `*.yaml`
 * ambient module) cannot type-check through. `Fleet.tsx` imports this
 * module's types, so keeping this vocabulary local keeps the client's
 * type-check graph shallow.
 */
export type FleetKind = "capture" | "message" | "script" | "prompt" | "stalled"

/** One worktree `Discover.ts` found — the input every read below is keyed on. */
export interface WorktreeRef {
  readonly id: string
  readonly path: string
}

/** A normal, projected fleet row — never the beat's own `content`/`system` fields, only the five the fleet screen renders plus identity. */
export interface FleetRow {
  readonly status: "ok"
  readonly id: string
  readonly path: string
  readonly repo: string
  readonly branch: string
  readonly label: string
  readonly kind: FleetKind
  readonly actor: Actor
  readonly idle: boolean
  readonly rest: string
}

/** A worktree that refused to read cleanly — `detail` is the verbatim text distinguishing one refusal from another (T5). */
export interface BrokenRow {
  readonly status: "broken"
  readonly id: string
  readonly path: string
  readonly repo: string
  readonly branch: string
  readonly detail: string
}

export type BeatRead = FleetRow | BrokenRow

/** One subprocess's outcome — `spawnError` set (never `status`/`stdout`/`stderr`) when the process could never start at all (no `bash`, bad cwd), so callers can tell "never ran" from "ran and exited non-zero". */
export interface SpawnOutcome {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly spawnError?: string
}

export type RunInWorktree = (cwd: string, command: string) => Promise<SpawnOutcome>

/** The real subprocess spawn: `bash -c <command>` with `cwd` set to the worktree — never the invoking process's own directory. */
export const liveRunInWorktree: RunInWorktree = (cwd, command) =>
  new Promise((resolve) => {
    execFile(
      "bash",
      ["-c", command],
      { cwd, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ status: 0, stdout, stderr })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        if (typeof code === "number") {
          resolve({ status: code, stdout, stderr })
          return
        }
        resolve({ status: null, stdout: "", stderr: "", spawnError: error.message })
      },
    )
  })

/**
 * The dependencies a beat read needs, all injectable so tests never spawn a
 * real subprocess or touch a real filesystem. `headSha` and `statMtime` are
 * filesystem-only (mirroring `WorktreeState.ts`'s own git-dir resolution) —
 * `BeatCache.read` below calls them on EVERY request, including a warm one,
 * so they must never shell out.
 */
export interface BeatDeps {
  readonly run: RunInWorktree
  readonly readPackageVersion: (path: string) => Promise<string | undefined>
  readonly headSha: (path: string) => Promise<string | undefined>
  readonly statMtime: (path: string) => Promise<number | undefined>
}

/**
 * A version is supported when its major matches this build's own — the beat
 * JSON envelope (`src/Beat.ts`'s `BeatFields`) is only guaranteed stable
 * within a major. Exported so tests aren't tied to this checkout's own
 * `package.json` version.
 */
export const isSupportedVersion = (
  version: string,
  currentMajor: number = CURRENT_MAJOR,
): boolean => {
  const major = Number(version.split(".")[0])
  return Number.isFinite(major) && major === currentMajor
}

const readGitMeta = async (
  path: string,
  run: RunInWorktree,
): Promise<{ readonly repo: string; readonly branch: string; readonly rest: string }> => {
  const [commonDir, branch, rest] = await Promise.all([
    run(path, "git rev-parse --path-format=absolute --git-common-dir"),
    run(path, "git rev-parse --abbrev-ref HEAD"),
    run(path, "git log -1 --format=%cI HEAD"),
  ])
  return {
    repo: commonDir.status === 0 ? basename(dirname(commonDir.stdout.trim())) : basename(path),
    branch: branch.status === 0 ? branch.stdout.trim() : "",
    rest: rest.status === 0 ? rest.stdout.trim() : new Date(0).toISOString(),
  }
}

/** The three-part cache key T3 pins: HEAD's sha, the resting steering file's mtime, the loop log's mtime — `undefined` on any axis that isn't known (no file/log reported, or a stat failure). */
interface BeatCacheKey {
  readonly headSha: string | undefined
  readonly filePath: string | undefined
  readonly fileMtime: number | undefined
  readonly logPath: string | undefined
  readonly logMtime: number | undefined
}

const sameKey = (a: BeatCacheKey, b: BeatCacheKey): boolean =>
  a.headSha === b.headSha &&
  a.filePath === b.filePath &&
  a.fileMtime === b.fileMtime &&
  a.logPath === b.logPath &&
  a.logMtime === b.logMtime

const broken = (
  worktree: WorktreeRef,
  meta: { readonly repo: string; readonly branch: string },
  detail: string,
): BrokenRow => ({
  status: "broken",
  id: worktree.id,
  path: worktree.path,
  repo: meta.repo,
  branch: meta.branch,
  detail,
})

type ColdReadResult = { readonly result: BeatRead; readonly key: BeatCacheKey }

/** A Broken outcome's cache key only ever pins `headSha` — `file`/`log` are never known, since nothing was successfully parsed. */
const brokenResult = async (
  worktree: WorktreeRef,
  meta: { readonly repo: string; readonly branch: string },
  deps: BeatDeps,
  detail: string,
): Promise<ColdReadResult> => ({
  result: broken(worktree, meta, detail),
  key: {
    headSha: await deps.headSha(worktree.path),
    filePath: undefined,
    fileMtime: undefined,
    logPath: undefined,
    logMtime: undefined,
  },
})

type ParsedBeatFields = {
  readonly kind?: unknown
  readonly idle?: unknown
  readonly actor?: unknown
  readonly label?: unknown
  readonly state?: unknown
  readonly file?: unknown
  readonly log?: unknown
}

/** The successful-parse path: projects `fields` into a `FleetRow` and computes the cache key T3 pins from the SAME `file`/`log` the beat itself reported. */
const okResult = async (
  worktree: WorktreeRef,
  meta: { readonly repo: string; readonly branch: string; readonly rest: string },
  fields: ParsedBeatFields,
  deps: BeatDeps,
): Promise<ColdReadResult> => {
  const filePath = typeof fields.file === "string" ? fields.file : undefined
  const logPath = typeof fields.log === "string" ? fields.log : undefined
  const [headSha, fileMtime, logMtime] = await Promise.all([
    deps.headSha(worktree.path),
    filePath !== undefined
      ? deps.statMtime(join(worktree.path, filePath))
      : Promise.resolve(undefined),
    logPath !== undefined ? deps.statMtime(logPath) : Promise.resolve(undefined),
  ])

  const result: FleetRow = {
    status: "ok",
    id: worktree.id,
    path: worktree.path,
    repo: meta.repo,
    branch: meta.branch,
    label: typeof fields.label === "string" ? fields.label : String(fields.state ?? ""),
    kind: fields.kind as FleetKind,
    actor: fields.actor as Actor,
    idle: Boolean(fields.idle),
    rest: meta.rest,
  }
  return { result, key: { headSha, filePath, fileMtime, logPath, logMtime } }
}

/**
 * The one place `gtd next --json` is actually run for a worktree — always
 * exactly once per cold read, never re-run within it. Everything else
 * (`readGitMeta`, `readPackageVersion`, `headSha`/`statMtime` for the cache
 * key) is either a cheap read-only git call or a plain filesystem read; none
 * of it writes, commits, or moves a ref.
 */
const coldRead = async (worktree: WorktreeRef, deps: BeatDeps): Promise<ColdReadResult> => {
  const meta = await readGitMeta(worktree.path, deps.run)

  // The version check reads the worktree's OWN package.json directly — never
  // a second `gtd --version` spawn, which would pay the same ~500ms bundle
  // parse `gtd next --json` already pays, doubling the cold-read cost this
  // package's whole caching strategy exists to amortize.
  const version = await deps.readPackageVersion(worktree.path)
  if (version !== undefined && !isSupportedVersion(version)) {
    return brokenResult(worktree, meta, deps, `unsupported gtd version: ${version}`)
  }

  const outcome = await deps.run(worktree.path, "gtd next --json")
  if (outcome.spawnError !== undefined) {
    return brokenResult(worktree, meta, deps, outcome.spawnError)
  }
  if (outcome.status !== 0) {
    return brokenResult(worktree, meta, deps, outcome.stderr)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(outcome.stdout)
  } catch {
    return brokenResult(
      worktree,
      meta,
      deps,
      `invalid JSON from gtd next --json: ${outcome.stdout}`,
    )
  }

  return okResult(worktree, meta, parsed as ParsedBeatFields, deps)
}

/**
 * Bounded-concurrency memo over `coldRead`, keyed by worktree id. A cache hit
 * spawns nothing at all: the warm-path staleness check below only calls
 * `deps.headSha`/`deps.statMtime`, both filesystem-only. Cold reads queue
 * behind `concurrency` — a 30-worktree cold `Fleet` load never has more than
 * that many `gtd next --json` processes alive at once.
 */
export class BeatCache {
  private readonly entries = new Map<
    string,
    { readonly key: BeatCacheKey; readonly result: BeatRead }
  >()
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(
    private readonly deps: BeatDeps,
    private readonly concurrency: number = 8,
  ) {}

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      const next = this.queue.shift()
      if (next !== undefined) next()
    }
  }

  async read(worktree: WorktreeRef): Promise<BeatRead> {
    const cached = this.entries.get(worktree.id)
    if (cached !== undefined) {
      const [headSha, fileMtime, logMtime] = await Promise.all([
        this.deps.headSha(worktree.path),
        cached.key.filePath !== undefined
          ? this.deps.statMtime(join(worktree.path, cached.key.filePath))
          : Promise.resolve(undefined),
        cached.key.logPath !== undefined
          ? this.deps.statMtime(cached.key.logPath)
          : Promise.resolve(undefined),
      ])
      if (
        sameKey(cached.key, {
          headSha,
          filePath: cached.key.filePath,
          fileMtime,
          logPath: cached.key.logPath,
          logMtime,
        })
      ) {
        return cached.result
      }
    }
    return this.withSlot(async () => {
      const { result, key } = await coldRead(worktree, this.deps)
      this.entries.set(worktree.id, { key, result })
      return result
    })
  }
}

/** Reads `<path>/package.json`'s `version` field — `undefined` (never a throw) when the file is missing, unreadable, or has no string `version`, since not every scanned worktree is a gtd checkout at all. */
export const readPackageVersionAt = async (path: string): Promise<string | undefined> => {
  try {
    const raw = await readFile(join(path, "package.json"), "utf8")
    const pkg = JSON.parse(raw) as { readonly version?: unknown }
    return typeof pkg.version === "string" ? pkg.version : undefined
  } catch {
    return undefined
  }
}

/**
 * HEAD's sha, filesystem-only — reuses `WorktreeState.ts`'s `worktreeGitDir`
 * (via a one-off `Cwd` layer bound to `path`) for the `.git` resolution,
 * then follows `HEAD` itself: either a bare 40-hex sha (detached), or a
 * `ref: refs/heads/x` line resolved against the loose ref file, falling back
 * to `packed-refs` when the branch has been packed. Returns `undefined` on
 * any read failure — the cache then treats that axis as always "changed",
 * forcing a fresh cold read rather than serving a stale one.
 */
export const liveHeadSha = async (path: string): Promise<string | undefined> => {
  try {
    const gitDir = await Effect.runPromise(
      worktreeGitDir.pipe(Effect.provide(Cwd.layer(path)), Effect.provide(NodeContext.layer)),
    )
    const head = (await readFile(join(gitDir, "HEAD"), "utf8")).trim()
    if (/^[0-9a-f]{40}$/.test(head)) return head
    const refMatch = /^ref:\s*(.+)$/.exec(head)
    if (refMatch === null) return undefined
    const ref = refMatch[1]!.trim()
    try {
      return (await readFile(join(gitDir, ref), "utf8")).trim()
    } catch {
      const packed = await readFile(join(gitDir, "packed-refs"), "utf8").catch(() => "")
      for (const line of packed.split("\n")) {
        const [sha, name] = line.trim().split(" ")
        if (name === ref && sha !== undefined) return sha
      }
      return undefined
    }
  } catch {
    return undefined
  }
}

/** A file's mtime in milliseconds — `undefined` (never a throw) when it doesn't exist, matching the "no file/log reported" case in `BeatCacheKey`. */
export const liveStatMtime = async (path: string): Promise<number | undefined> => {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return undefined
  }
}
