import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { Context, Effect, Layer } from "effect"

/** The workflow module found on the cwd→home walk, with its source. */
export interface WorkflowModule {
  readonly filepath: string
  readonly source: string
  /**
   * The modules the config imports, by absolute path, for a discovery with no
   * disk behind it. Absent, they are read from disk like any module import.
   */
  readonly read?: (path: string) => string | undefined
}

/** A leftover rc file, and whether the user running gtd owns it — and so can delete it. */
interface LegacyRcFile {
  readonly path: string
  readonly owned: boolean
}

interface ConfigDiscoveryOps {
  /** Every removed `.gtdrc`-family file on the `root`→`home` walk and in `home` itself, innermost first. */
  readonly legacyRcFiles: (
    root: string,
    home: string,
  ) => Effect.Effect<readonly LegacyRcFile[], Error>
  /** The innermost `gtd.config.ts` walking `root` up through `home`, if any. */
  readonly workflowModule: (
    root: string,
    home: string,
  ) => Effect.Effect<WorkflowModule | undefined, Error>
}

export const WORKFLOW_MODULE = "gtd.config.ts"

/**
 * The file names gtd read repository settings from before `gtd.config.ts` took
 * them over. Still looked for, only to refuse them: a leftover one would
 * otherwise be silently ignored. Shared with the in-memory counterpart in
 * `src/twins/Layers.ts`, so both tiers refuse the same names.
 */
export const LEGACY_RC_FILES = [
  ".gtdrc",
  ".gtdrc.json",
  ".gtdrc.yaml",
  ".gtdrc.yml",
  "gtd.config.json",
  "gtd.config.yaml",
]

/** The directories searched for a leftover rc file: the walk, plus `home` when the walk misses it. */
export const legacyRcDirs = (root: string, home: string): readonly string[] => {
  const chain = walkUp(root, home)
  return chain.includes(home) ? chain : [...chain, home]
}

const legacyRcFileAt = (path: string): LegacyRcFile | undefined => {
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return undefined
    // Above home, a shared directory (`/tmp`) can hold another user's file.
    return { path, owned: process.getuid === undefined || stat.uid === process.getuid() }
  } catch {
    return undefined
  }
}

/**
 * Enumerate the directory chain from `from` walking UP. Stops after including
 * the user's home dir (inclusive, when it is an ancestor) or after reaching the
 * filesystem root — whichever comes first. Returned innermost→outermost.
 * Exported (via the barrel) for the same reason `SEARCH_PLACES` is — one
 * shared implementation, not a second copy in `src/twins/Layers.ts` that
 * could silently diverge.
 */
export const walkUp = (from: string, home: string): ReadonlyArray<string> => {
  const chain: Array<string> = []
  let dir = from
  while (true) {
    chain.push(dir)
    if (dir === home) break
    const parent = dirname(dir)
    if (parent === dir) break // filesystem root
    dir = parent
  }
  return chain
}

const legacyRcFiles = (root: string, home: string): Effect.Effect<readonly LegacyRcFile[], Error> =>
  Effect.sync(() =>
    legacyRcDirs(root, home).flatMap((dir) =>
      LEGACY_RC_FILES.flatMap((name) => legacyRcFileAt(join(dir, name)) ?? []),
    ),
  )

const workflowModule = (
  root: string,
  home: string,
): Effect.Effect<WorkflowModule | undefined, Error> =>
  Effect.try({
    try: () => {
      for (const dir of walkUp(root, home)) {
        const filepath = join(dir, WORKFLOW_MODULE)
        if (existsSync(filepath)) return { filepath, source: readFileSync(filepath, "utf8") }
      }
      return undefined
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * The discovery seam — a `Context.Tag`, not part of `WorkflowFiles` (that
 * port is a plain sync record for `compileWorkflow`'s own content-file-ref
 * reads; discovery is effectful and environment-dependent: `.Live` reads
 * REAL disk, so an `@inmem` scenario's fake
 * `Workspace` — a pure in-memory `Map`, no real files anywhere on disk —
 * cannot back it. `src/twins/Layers.ts` provides the in-memory
 * counterpart instead, mirroring how `Workspace`/`Host`/`GitService` already
 * each have a production and a fake layer behind one Tag.
 */
export class ConfigDiscovery extends Context.Tag("ConfigDiscovery")<
  ConfigDiscovery,
  ConfigDiscoveryOps
>() {
  static Live = Layer.succeed(ConfigDiscovery, { legacyRcFiles, workflowModule })
}
