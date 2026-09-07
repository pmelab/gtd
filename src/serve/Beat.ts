import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeContext } from "@effect/platform-node"
import { Effect } from "effect"
import { Cwd } from "../Cwd.js"
import type { Actor } from "../StateFields.js"
import { worktreeGitDir } from "../WorktreeState.js"

/**
 * Finds this checkout's own `package.json` by walking UP from this module's
 * own file, rather than a fixed relative offset (`../../package.json`): this
 * module sits two directories under `src/` in source, but `tsdown`/rolldown
 * collapse everything into one `dist/gtd.bundle.mjs`, one directory under the
 * package root, so a hardcoded relative path is right in exactly one of the
 * two contexts. Mirrors `Server.ts`'s `findPackageRoot` (same reason, same
 * walk), checking `name` so an npm-installed copy nested under some other
 * project's `node_modules` can't pick up that project's own `package.json`.
 */
const findOwnVersion = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, "package.json")
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string }
      if (pkg.name === "@pmelab/gtd" && typeof pkg.version === "string") return pkg.version
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error("no @pmelab/gtd package.json found above src/serve/Beat.ts")
}

const GTD_VERSION: string = findOwnVersion()
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

/**
 * The real subprocess spawn: `bash -c <command>` with `cwd` set to the
 * worktree — never the invoking process's own directory. `<cwd>/node_modules/.bin`
 * is prepended to `$PATH` so a worktree with its own `@pmelab/gtd`
 * devDependency actually RUNS that install rather than the fleet server's
 * own — otherwise `readLocalGtdVersionAt`'s version check would inspect a
 * `package.json` that has no bearing on what `gtd next --json` here executes.
 * Falls through to the inherited `$PATH` (the server's own `gtd`) when no
 * local install exists, exactly as `readLocalGtdVersionAt`'s own doc comment
 * already assumes.
 */
export const liveRunInWorktree: RunInWorktree = (cwd, command) =>
  new Promise((resolve) => {
    const env = {
      ...process.env,
      PATH: `${join(cwd, "node_modules/.bin")}:${process.env["PATH"] ?? ""}`,
    }
    execFile(
      "bash",
      ["-c", command],
      { cwd, env, maxBuffer: 16 * 1024 * 1024 },
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
  readonly readLocalGtdVersion: (path: string) => Promise<string | undefined>
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

/**
 * Resolves a beat-reported path (`file`/`log`) against the worktree: absolute
 * as-is (a linked worktree's `log`, whose `gitdir:` pointer can point
 * anywhere), otherwise joined onto `worktreePath` — an ordinary clone's `log`
 * (`.git/gtd-loop.log`, from `WorktreeState.ts`'s literal `".git"` fallback)
 * is relative to the WORKTREE, not to the fleet server's own cwd. Joining it
 * unconditionally (the earlier shape, for `log` only) resolved that relative
 * path against the server's process instead: touching a plain repo's real
 * loop log never invalidated its cache entry, and since `gtd serve` itself
 * runs inside a gtd repo, that same relative path usually landed on the
 * SERVER's own log — one shared file invalidating every plain-repo row at
 * once.
 */
const resolveInWorktree = (worktreePath: string, reportedPath: string): string =>
  isAbsolute(reportedPath) ? reportedPath : join(worktreePath, reportedPath)

/**
 * Sequential, not `Promise.all` — `coldRead` runs entirely inside `withSlot`,
 * so T3's cap ("never more than that many child processes alive at once")
 * covers every subprocess a cold read spawns, not just `gtd next --json`.
 * Three concurrent `git` calls per slot would let a `concurrency: 8` cache
 * run up to 24 live processes at once; one at a time per slot keeps the
 * total exactly at the configured cap. These reads are a few milliseconds
 * each next to `gtd next --json`'s 520–660 ms bundle parse, so serializing
 * them costs nothing worth trading the cap's own guarantee away for.
 */
const readGitMeta = async (
  path: string,
  run: RunInWorktree,
): Promise<{ readonly repo: string; readonly branch: string; readonly rest: string }> => {
  const commonDir = await run(path, "git rev-parse --path-format=absolute --git-common-dir")
  const branch = await run(path, "git rev-parse --abbrev-ref HEAD")
  const rest = await run(path, "git log -1 --format=%cI HEAD")
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
      ? deps.statMtime(resolveInWorktree(worktree.path, filePath))
      : Promise.resolve(undefined),
    logPath !== undefined
      ? deps.statMtime(resolveInWorktree(worktree.path, logPath))
      : Promise.resolve(undefined),
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
 * (`readGitMeta`, `readLocalGtdVersion`, `headSha`/`statMtime` for the cache
 * key) is either a cheap read-only git call or a plain filesystem read; none
 * of it writes, commits, or moves a ref.
 */
const coldRead = async (worktree: WorktreeRef, deps: BeatDeps): Promise<ColdReadResult> => {
  const meta = await readGitMeta(worktree.path, deps.run)

  // The version check reads the worktree's LOCALLY INSTALLED gtd's own
  // package.json directly — never a second `gtd --version` spawn, which
  // would pay the same ~500ms bundle parse `gtd next --json` already pays,
  // doubling the cold-read cost this package's whole caching strategy exists
  // to amortize. No local install (the common case) means nothing to check.
  const version = await deps.readLocalGtdVersion(worktree.path)
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

  /** How many cold reads currently hold a slot — test-only instrumentation for pinning `withSlot`'s handoff invariant directly, rather than inferring it from `deps.run` call timing several `await`s downstream. */
  get activeSlots(): number {
    return this.active
  }

  /**
   * A slot is handed DIRECTLY from a finishing holder to the next waiter —
   * `active` is never decremented and re-incremented across that handoff.
   * The earlier shape did decrement-then-resume: the resumed waiter's own
   * `active++` ran only after its `await` settled (a microtask later), so a
   * THIRD call arriving in that window saw `active < concurrency`, took a
   * slot of its own, and the resumed waiter then pushed `active` one past
   * `concurrency` — an extra live `gtd next --json` per pending waiter,
   * reachable whenever two fleet requests overlap (a phone refresh during a
   * cold load). Handing the slot off inside the same synchronous `finally`
   * closes that window: `active` only ever grows when a slot is granted
   * fresh (below cap) and only ever shrinks when nobody is waiting for it.
   */
  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.concurrency) {
      this.active++
    } else {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    try {
      return await fn()
    } finally {
      const next = this.queue.shift()
      if (next !== undefined) next()
      else this.active--
    }
  }

  async read(worktree: WorktreeRef): Promise<BeatRead> {
    const cached = this.entries.get(worktree.id)
    if (cached !== undefined) {
      const [headSha, fileMtime, logMtime] = await Promise.all([
        this.deps.headSha(worktree.path),
        cached.key.filePath !== undefined
          ? this.deps.statMtime(resolveInWorktree(worktree.path, cached.key.filePath))
          : Promise.resolve(undefined),
        cached.key.logPath !== undefined
          ? this.deps.statMtime(resolveInWorktree(worktree.path, cached.key.logPath))
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

/**
 * Reads `<path>/node_modules/@pmelab/gtd/package.json`'s `version` — the
 * version of `gtd` a plain `gtd next --json` spawn would actually run in
 * THAT worktree if it resolved locally, never the scanned project's OWN
 * `version` (that field belongs to whatever the worktree happens to be, not
 * to gtd — most scanned projects aren't gtd checkouts at all). `undefined`
 * (never a throw) when there is no local install: the overwhelming common
 * case, where the spawn falls through to whatever `gtd` the fleet server's
 * own `$PATH` resolves — by construction the SAME build running this
 * check — so there is nothing to range-check and the worktree is never
 * held Broken on that account.
 */
export const readLocalGtdVersionAt = async (path: string): Promise<string | undefined> => {
  try {
    const raw = await readFile(join(path, "node_modules/@pmelab/gtd/package.json"), "utf8")
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
