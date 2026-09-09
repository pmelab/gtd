import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
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
 *
 * Memoized rather than run at module scope: importing this module from a
 * directory tree with no `@pmelab/gtd` `package.json` above it (a test
 * runner's own temp dir, for instance) must load cleanly — only actually
 * checking a version pays this walk's cost, and then only once.
 */
let ownVersion: string | undefined
const findOwnVersion = (): string => {
  if (ownVersion !== undefined) return ownVersion
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, "package.json")
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string }
      if (pkg.name === "@pmelab/gtd" && typeof pkg.version === "string") {
        ownVersion = pkg.version
        return ownVersion
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error("no @pmelab/gtd package.json found above src/ui/Beat.ts")
}

/**
 * Mirrors `src/Beat.ts`'s (root) `BeatKind` union verbatim, duplicated
 * rather than imported: that module pulls in `Edge.ts` → `PatternConfig.ts`
 * → the bundled workflow YAML, a chain the web client's own `tsconfig.json`
 * (scoped to `src/web/`, no visibility into `src/types.d.ts`'s `*.yaml`
 * ambient module) cannot type-check through. `App.tsx` imports this
 * module's types (`Step`/`StepRead`), so keeping this vocabulary local
 * keeps the client's type-check graph shallow.
 */
export type StepKind = "capture" | "message" | "script" | "prompt" | "stalled"

/** The worktree `gtd ui` serves — the input `readStep` is keyed on. */
export interface WorktreeRef {
  readonly path: string
}

/** The served worktree's own rest, projected down to what the phone UI renders plus `file`/`mode` (the plumbing a phone screen needs to actually open and hand back a steering file). */
export interface Step {
  readonly status: "ok"
  readonly path: string
  readonly repo: string
  readonly branch: string
  readonly label: string
  /** The rest's own machine identity, straight off the beat's `state` field — stable across a workflow edit that rewords `label`, unlike `label` itself. */
  readonly state: string
  readonly kind: StepKind
  readonly actor: Actor
  readonly idle: boolean
  readonly rest: string
  /** The beat-reported steering file's path, relative to `path` — `undefined` when this rest has no steering file (a `script`/`stalled` rest, typically). The phone's own `readSteeringFile`/`writeNote`/`done` calls all need this alongside `mode`. */
  readonly file?: string
  /** The beat-reported steering mode (`qa`, `review`, a custom mode, …) — `undefined` alongside `file` exactly when there is no steering file to open. Never switched on here; only threaded through so a phone screen can pick `Plan` vs `Review` client-side. */
  readonly mode?: string
}

/** The served worktree refused to read cleanly — `detail` is the verbatim text distinguishing one refusal from another. */
export interface BrokenStep {
  readonly status: "broken"
  readonly path: string
  readonly repo: string
  readonly branch: string
  readonly detail: string
}

/**
 * The served rest moved on since the server captured it (a different
 * `state`, a read that's gone `broken`, or one that's no longer
 * renderable) — `Server.ts`'s own `step` resolution, never produced by
 * `readStep` itself.
 */
export interface MovedOnStep {
  readonly status: "moved-on"
  readonly label: string
}

export type StepRead = Step | BrokenStep | MovedOnStep

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
 * devDependency actually RUNS that install rather than the server's
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

/** The dependencies a step read needs, all injectable so tests never spawn a real subprocess or touch a real filesystem. */
export interface BeatDeps {
  readonly run: RunInWorktree
  readonly readLocalGtdVersion: (path: string) => Promise<string | undefined>
  readonly headSha: (path: string) => Promise<string | undefined>
}

/**
 * A version is supported when its major matches this build's own — the beat
 * JSON envelope (`src/Beat.ts`'s `BeatFields`) is only guaranteed stable
 * within a major. Defaults to this build's own major, resolved lazily via
 * `findOwnVersion` — exported so tests aren't tied to this checkout's own
 * `package.json` version.
 */
export const isSupportedVersion = (
  version: string,
  currentMajor: number = Number(findOwnVersion().split(".")[0]),
): boolean => {
  const major = Number(version.split(".")[0])
  return Number.isFinite(major) && major === currentMajor
}

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

const broken = (
  worktree: WorktreeRef,
  meta: { readonly repo: string; readonly branch: string },
  detail: string,
): BrokenStep => ({
  status: "broken",
  path: worktree.path,
  repo: meta.repo,
  branch: meta.branch,
  detail,
})

type ParsedBeatFields = {
  readonly kind?: unknown
  readonly idle?: unknown
  readonly actor?: unknown
  readonly label?: unknown
  readonly state?: unknown
  readonly file?: unknown
  readonly mode?: unknown
}

const STEP_KINDS: readonly StepKind[] = ["capture", "message", "script", "prompt", "stalled"]

/**
 * Validates the two fields the row can't render without: `kind` must be one
 * of the closed `StepKind` vocabulary, `actor` a non-empty string. Valid
 * JSON that isn't a beat (e.g. a `$PATH` `gtd` the version check couldn't
 * see, parsing to some unrelated envelope) parses cleanly but fails this
 * check — the Broken outcome is "spawn failed, unsupported version,
 * **unparseable beat**", and an unchecked cast here would otherwise render a
 * blank-labeled row with an `undefined` kind/actor instead.
 */
const isValidBeat = (
  fields: ParsedBeatFields,
): fields is ParsedBeatFields & { readonly kind: StepKind; readonly actor: string } =>
  typeof fields.kind === "string" &&
  (STEP_KINDS as readonly string[]).includes(fields.kind) &&
  typeof fields.actor === "string" &&
  fields.actor !== ""

/** `okResult`'s own two optional fields (`file`/`mode`) — dropped entirely, never present-as-`undefined`, when its source value isn't there. */
const optionalStepFields = (
  filePath: string | undefined,
  mode: unknown,
): Pick<Step, "file" | "mode"> => ({
  ...(filePath !== undefined ? { file: filePath } : {}),
  ...(typeof mode === "string" ? { mode } : {}),
})

const okResult = (
  worktree: WorktreeRef,
  meta: { readonly repo: string; readonly branch: string; readonly rest: string },
  fields: ParsedBeatFields & { readonly kind: StepKind; readonly actor: string },
): Step => {
  const filePath = typeof fields.file === "string" ? fields.file : undefined
  return {
    status: "ok",
    path: worktree.path,
    repo: meta.repo,
    branch: meta.branch,
    label: typeof fields.label === "string" ? fields.label : String(fields.state ?? ""),
    state: String(fields.state ?? ""),
    kind: fields.kind,
    actor: fields.actor,
    idle: Boolean(fields.idle),
    rest: meta.rest,
    ...optionalStepFields(filePath, fields.mode),
  }
}

/**
 * The one place `gtd next --json` is actually run for the served worktree —
 * always exactly once per call. Everything else (`readGitMeta`,
 * `readLocalGtdVersion`) is either a cheap read-only git call or a plain
 * filesystem read; none of it writes, commits, or moves a ref.
 */
export const readStep = async (
  worktree: WorktreeRef,
  deps: BeatDeps,
): Promise<Step | BrokenStep> => {
  const meta = await readGitMeta(worktree.path, deps.run)

  // The version check reads the worktree's LOCALLY INSTALLED gtd's own
  // package.json directly — never a second `gtd --version` spawn, which
  // would pay the same ~500ms bundle parse `gtd next --json` already pays.
  const version = await deps.readLocalGtdVersion(worktree.path)
  if (version !== undefined && !isSupportedVersion(version)) {
    return broken(worktree, meta, `unsupported gtd version: ${version}`)
  }

  const outcome = await deps.run(worktree.path, "gtd next --json")
  if (outcome.spawnError !== undefined) {
    return broken(worktree, meta, outcome.spawnError)
  }
  if (outcome.status !== 0) {
    return broken(worktree, meta, outcome.stderr)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(outcome.stdout)
  } catch {
    return broken(worktree, meta, `invalid JSON from gtd next --json: ${outcome.stdout}`)
  }

  const fields = parsed as ParsedBeatFields
  if (!isValidBeat(fields)) {
    return broken(
      worktree,
      meta,
      `unparseable beat: kind=${JSON.stringify(fields.kind)} actor=${JSON.stringify(fields.actor)}`,
    )
  }

  return okResult(worktree, meta, fields)
}

/**
 * Reads `<path>/node_modules/@pmelab/gtd/package.json`'s `version` — the
 * version of `gtd` a plain `gtd next --json` spawn would actually run in
 * THAT worktree if it resolved locally, never the scanned project's OWN
 * `version`. `undefined` (never a throw) when there is no local install: the
 * overwhelming common case, where the spawn falls through to whatever `gtd`
 * the server's own `$PATH` resolves — by construction the SAME build
 * running this check — so there is nothing to range-check and the worktree
 * is never held Broken on that account.
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
 * any read failure.
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
