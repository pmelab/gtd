import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cosmiconfigSync, defaultLoadersSync, type LoaderSync } from "cosmiconfig"
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
 * Exported (via the `src/workflow/` barrel) so `src/testing/Layers.ts`'s
 * in-memory `ConfigDiscovery` counterpart shares this EXACT list — a second,
 * independently-maintained copy would let this list drift (a new
 * search-place added here, or reordered) with every `@inmem` scenario still
 * silently resolving against the stale one: a green suite over a broken
 * product.
 */
/**
 * The one file a workflow is defined in. Searched on the same cwd→home walk as
 * the `.gtdrc` family, but separately: a directory may hold both, and a
 * `.gtdrc` there still contributes `vars`/`modes`/`ui`.
 */
export const WORKFLOW_MODULE = "gtd.config.ts"

export const SEARCH_PLACES = [
  ".gtdrc",
  ".gtdrc.json",
  ".gtdrc.yaml",
  ".gtdrc.yml",
  "gtd.config.json",
  "gtd.config.yaml",
]

/** `base`, rejecting a `null` parse result (the YAML/JSON scalar `null`) as a config-shape error, same as any other malformed level. */
const rejectingNull =
  (base: LoaderSync): LoaderSync =>
  (filepath, content) => {
    const result: unknown = base(filepath, content)
    if (result === null) {
      throw new Error(`${filepath}: config must be a plain object, got null`)
    }
    return result
  }

/**
 * One `cosmiconfig` explorer, `searchStrategy: "none"` so `.search(dir)`
 * inspects only that single directory — callers drive the root→home walk
 * themselves (`levels`, below); cosmiconfig has no native multi-level merge
 * (see `compile.ts`'s own deep-merge). `noExt`/`.yaml`/`.yml` all parse as
 * YAML (a JSON superset), `.json` as JSON — cosmiconfig's OWN loaders and
 * OWN extension-precedence/empty-file-skip/symlink-tolerance semantics, not
 * a reimplementation of them.
 */
const makeExplorer = () =>
  cosmiconfigSync("gtd", {
    searchPlaces: SEARCH_PLACES,
    searchStrategy: "none",
    loaders: {
      noExt: rejectingNull(defaultLoadersSync.noExt),
      ".json": rejectingNull(defaultLoadersSync[".json"]),
      ".yaml": rejectingNull(defaultLoadersSync.noExt),
      ".yml": rejectingNull(defaultLoadersSync.noExt),
    },
  })

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
      const explorer = makeExplorer()
      const found: ConfigLevel[] = []
      // Outermost→innermost so merging in order makes innermost win.
      for (let i = chain.length - 1; i >= 0; i--) {
        const result = explorer.search(chain[i]!)
        if (!result || result.isEmpty) continue
        found.push({ filepath: result.filepath, config: result.config })
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

/**
 * The shipped `src/flows/` directory — `@pmelab/gtd/flows` resolves there when
 * a `gtd.config.ts` is evaluated. Found by walking
 * up from this module to the package root, so it holds for the bundle in
 * `dist/` and for the sources alike.
 */
export const flowsDir = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, "src", "flows")
    if (existsSync(join(candidate, "runtime.ts"))) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error("gtd: cannot locate the shipped src/flows directory")
    dir = parent
  }
}

const presentAt = (dir: string): Effect.Effect<boolean, Error> =>
  Effect.try({
    try: () => {
      const result = makeExplorer().search(dir)
      return Boolean(result && !result.isEmpty)
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * The discovery seam — a `Context.Tag`, not part of `WorkflowFiles` (that
 * port is a plain sync record for `compileWorkflow`'s own content-file-ref
 * reads; discovery is effectful and environment-dependent: `.Live` reads
 * REAL disk through cosmiconfig directly, so an `@inmem` scenario's fake
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
