import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parse as parseYaml } from "yaml"
import { Context, Effect, Layer } from "effect"

/** One config level's file path plus its raw, parsed-but-undecoded content. */
export interface ConfigLevel {
  readonly filepath: string
  readonly config: unknown
}

/** The workflow module found on the cwd→home walk, with its source. */
export interface WorkflowModule {
  readonly filepath: string
  readonly source: string
}

interface ConfigDiscoveryOps {
  /** Every level found walking `root` up through `home`, OUTERMOST→INNERMOST. */
  readonly levels: (root: string, home: string) => Effect.Effect<readonly ConfigLevel[], Error>
  /** The innermost `gtd.config.ts` walking `root` up through `home`, if any. */
  readonly workflowModule: (
    root: string,
    home: string,
  ) => Effect.Effect<WorkflowModule | undefined, Error>
  /** Whether a gtd config lives directly at `dir` — no ancestor walk. */
  readonly presentAt: (dir: string) => Effect.Effect<boolean, Error>
}

/**
 * The one file a workflow is defined in. Searched on the same cwd→home walk as
 * the `.gtdrc` family, but separately: a directory may hold both, and a
 * `.gtdrc` there still contributes `vars`/`modes`/`ui`.
 */
export const WORKFLOW_MODULE = "gtd.config.ts"

/**
 * Exported (via the `src/workflow/` barrel) so `src/testing/Layers.ts`'s
 * in-memory `ConfigDiscovery` counterpart shares this EXACT list — a second,
 * independently-maintained copy would let it drift (a new search place added
 * here, or reordered) with every `@inmem` scenario still silently resolving
 * against the stale one: a green suite over a broken product.
 */
export const SEARCH_PLACES = [
  ".gtdrc",
  ".gtdrc.json",
  ".gtdrc.yaml",
  ".gtdrc.yml",
  "gtd.config.json",
  "gtd.config.yaml",
]

/**
 * One config file's content, parsed by its extension. Shared with
 * `src/testing/Layers.ts`'s in-memory tier so both resolve a level the same
 * way. A parse failure is a HARD error (the file exists and says something
 * malformed), `null` included — that is not an empty config.
 */
export const parseConfigLevel = (filepath: string, content: string): unknown => {
  let parsed: unknown
  try {
    // YAML is a JSON superset, so `.json` only needs its own parser for the
    // stricter errors it gives on JSON-shaped input.
    parsed = filepath.endsWith(".json") ? JSON.parse(content) : parseYaml(content)
  } catch (e) {
    throw new Error(`${filepath}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (parsed === null) throw new Error(`${filepath}: config must be a plain object, got null`)
  return parsed
}

/**
 * One candidate path's parsed config, or `undefined` when it is not a usable
 * config file at all. Unreadable for ANY reason (ENOENT, EISDIR, ENOTDIR,
 * EACCES, a dangling symlink) and empty-but-readable both mean "walk on to
 * the next search place", never "fail the whole load" — a directory merely
 * NAMED `.gtdrc` must not kill every gtd command.
 */
const readConfigLevel = (filepath: string): unknown => {
  let content: string
  try {
    content = readFileSync(filepath, "utf8")
  } catch {
    return undefined
  }
  return content.trim() === "" ? undefined : parseConfigLevel(filepath, content)
}

/** The first `SEARCH_PLACES` entry in `dir` that is a readable, non-empty config file — no ancestor walk. */
const configLevelAt = (dir: string): ConfigLevel | undefined => {
  for (const name of SEARCH_PLACES) {
    const filepath = join(dir, name)
    const config = readConfigLevel(filepath)
    if (config !== undefined) return { filepath, config }
  }
  return undefined
}

/**
 * Enumerate the directory chain from `from` walking UP. Stops after including
 * the user's home dir (inclusive, when it is an ancestor) or after reaching the
 * filesystem root — whichever comes first. Returned innermost→outermost.
 * Exported (via the barrel) for the same reason `SEARCH_PLACES` is — one
 * shared implementation, not a second copy in `src/testing/Layers.ts` that
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

const levels = (root: string, home: string): Effect.Effect<readonly ConfigLevel[], Error> =>
  Effect.try({
    try: () => {
      const chain = walkUp(root, home)
      const found: ConfigLevel[] = []
      // Outermost→innermost so merging in order makes innermost win.
      for (let i = chain.length - 1; i >= 0; i--) {
        const level = configLevelAt(chain[i]!)
        if (level) found.push(level)
      }
      return found
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

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

const presentAt = (dir: string): Effect.Effect<boolean, Error> =>
  Effect.try({
    try: () => configLevelAt(dir) !== undefined,
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * The discovery seam — a `Context.Tag`, not part of `WorkflowFiles` (that
 * port is a plain sync record for `compileWorkflow`'s own content-file-ref
 * reads; discovery is effectful and environment-dependent: `.Live` reads
 * REAL disk, so an `@inmem` scenario's fake
 * `Workspace` — a pure in-memory `Map`, no real files anywhere on disk —
 * cannot back it. `src/testing/Layers.ts` provides the in-memory
 * counterpart instead, mirroring how `Workspace`/`Host`/`GitService` already
 * each have a production and a fake layer behind one Tag.
 */
export class ConfigDiscovery extends Context.Tag("ConfigDiscovery")<
  ConfigDiscovery,
  ConfigDiscoveryOps
>() {
  static Live = Layer.succeed(ConfigDiscovery, { levels, presentAt, workflowModule })
}
