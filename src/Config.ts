import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { cosmiconfig } from "cosmiconfig"
import { parse as parseYaml } from "yaml"
import { Context, Effect, Layer, Schema } from "effect"
import { Command, CommandExecutor, FileSystem } from "@effect/platform"
import { compileWorkflowConfig } from "./PatternConfig.js"
import { parseStateSubject, type WorkflowDefinition } from "./PatternMachine.js"
import { defaultWorkflowDefinition, defaultWorkflowVars } from "./workflows/default.js"
import { Cwd } from "./Cwd.js"
import { ArrayFormatter, ParseError } from "effect/ParseResult"
import { ConfigSchema, type DecodedConfig } from "./ConfigSchema.js"

export interface ConfigOperations {
  /** The active workflow definition — the bundled default, or the `.gtdrc` `workflow:` key compiled through `compileWorkflowConfig`. */
  readonly workflow: WorkflowDefinition
  /** The active workflow's `vars:` passthrough (any shape, unvalidated) — the `config` template variable. `undefined` for the bundled default. */
  readonly vars: unknown
}

/**
 * Recursively deep-merge plain objects; scalars/arrays from `inner` overwrite.
 * Hand-rolled because cosmiconfig v9 `search()` stops at the FIRST config it
 * finds and has no native cross-level auto-merge. Its only merge hook is the
 * explicit `$import` key, which would force users to hand-author import chains
 * and lose the implicit cwd→home layering. The manual `walkUp` + `deepMerge`
 * with innermost-wins semantics is therefore intentional.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const deepMerge = (
  base: Record<string, unknown>,
  inner: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base }
  for (const [key, innerVal] of Object.entries(inner)) {
    const baseVal = out[key]
    if (isPlainObject(baseVal) && isPlainObject(innerVal)) {
      out[key] = deepMerge(baseVal, innerVal)
    } else {
      out[key] = innerVal
    }
  }
  return out
}

/**
 * Enumerate the directory chain from `from` walking UP. Stops after including
 * the user's home dir (inclusive, when it is an ancestor) or after reaching the
 * filesystem root — whichever comes first. Returned innermost→outermost.
 */
const walkUp = (from: string, home: string): ReadonlyArray<string> => {
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

const yamlLoader = (filepath: string, content: string): unknown => {
  let result: unknown
  try {
    result = parseYaml(content) as unknown
  } catch (e) {
    throw new Error(`${filepath}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (result === null) {
    throw new Error(`${filepath}: config must be a plain object, got null`)
  }
  return result
}

const jsonLoader = (filepath: string, content: string): unknown => {
  let result: unknown
  try {
    result = JSON.parse(content) as unknown
  } catch (e) {
    throw new Error(`${filepath}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (result === null) {
    throw new Error(`${filepath}: config must be a plain object, got null`)
  }
  return result
}

const SEARCH_PLACES = [
  ".gtdrc",
  ".gtdrc.json",
  ".gtdrc.yaml",
  ".gtdrc.yml",
  "gtd.config.json",
  "gtd.config.yaml",
]

/**
 * Load and deep-merge every config level from cwd up the directory chain.
 * Innermost (cwd) wins. Returns the merged plain object (undecoded).
 */
const loadMerged = (root: string): Effect.Effect<Record<string, unknown>, Error> =>
  Effect.tryPromise({
    try: async () => {
      const home = homedir()
      const chain = walkUp(root, home)

      // `searchStrategy: 'none'` makes `.search(dir)` inspect only that single
      // directory (no internal walking), so we collect every level deterministically.
      const explorer = cosmiconfig("gtd", {
        searchPlaces: SEARCH_PLACES,
        searchStrategy: "none",
        loaders: {
          noExt: yamlLoader, // .gtdrc (extensionless) — YAML is a JSON superset
          ".json": jsonLoader,
          ".yaml": yamlLoader,
          ".yml": yamlLoader,
        },
      })

      // Collect outermost→innermost so merging in order makes innermost win.
      const levels: Array<Record<string, unknown>> = []
      for (let i = chain.length - 1; i >= 0; i--) {
        const dir = chain[i]
        const result = await explorer.search(dir)
        if (result && !result.isEmpty) {
          if (!isPlainObject(result.config)) {
            throw new Error(
              `${result.filepath}: config must be a plain object, got ${Array.isArray(result.config) ? "array" : String(result.config)}`,
            )
          }
          levels.push(result.config)
        }
      }

      return levels.reduce<Record<string, unknown>>((acc, level) => deepMerge(acc, level), {})
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

const SCHEMA_URL = "https://raw.githubusercontent.com/pmelab/gtd/main/schema.json"

const SCHEMA_STUB = `${JSON.stringify({ $schema: SCHEMA_URL }, null, 2)}\n`

/**
 * Reuses the same `walkUp` + `searchStrategy: "none"` cosmiconfig explorer as
 * `loadMerged` to detect whether ANY level of the cwd→root walk carries a gtd
 * config. Returns `true` on the first non-empty `search(dir)` result.
 */
const anyConfigPresent = (root: string): Effect.Effect<boolean, Error> =>
  Effect.tryPromise({
    try: async () => {
      const home = homedir()
      const chain = walkUp(root, home)

      const explorer = cosmiconfig("gtd", {
        searchPlaces: SEARCH_PLACES,
        searchStrategy: "none",
        loaders: {
          noExt: yamlLoader,
          ".json": jsonLoader,
          ".yaml": yamlLoader,
          ".yml": yamlLoader,
        },
      })

      for (const dir of chain) {
        const result = await explorer.search(dir)
        if (result && !result.isEmpty) return true
      }
      return false
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * Compile the decoded config's `workflow:` key (or the bundled default, when
 * absent) into `ConfigOperations`. `root` is used as the workflow compiler's
 * `configDir` — the directory a custom workflow's `./`-relative content
 * references resolve against. Throws (via `compileWorkflowConfig`) on any
 * invalid custom workflow; the bundled default never throws here (it is
 * pre-compiled and validated once at module load, see
 * `./workflows/default.ts`).
 */
const toOperations = (decoded: DecodedConfig, root: string): ConfigOperations => {
  if (decoded.workflow === undefined) {
    return { workflow: defaultWorkflowDefinition, vars: defaultWorkflowVars }
  }
  const { definition, config: vars } = compileWorkflowConfig(decoded.workflow, root)
  return { workflow: definition, vars }
}

const formatSchemaError = (e: ParseError): string => {
  const issues = ArrayFormatter.formatErrorSync(e)
  const summary = issues
    .map((i) => (i.path.length > 0 ? i.path.join(".") + ": " : "") + i.message)
    .join("; ")
  return `Invalid gtd config: ${summary}`
}

/**
 * Auto-init as an explicit capability, separate from config LOADING: the stub
 * write mutates the repository (a file write plus a commit or amend), so it
 * must only ever run for a state command that has already passed the
 * repo-root guard — never at layer-construction time, where it would fire for
 * `--version`/`--help`, `format`, bare/unknown commands, and root-guard
 * refusals alike (and from a subdirectory would drop the stub into the wrong
 * directory). `makeProgram` calls `ensure` right after the repo-root guard;
 * the in-memory test world provides `ConfigInit.Noop`.
 */
export class ConfigInit extends Context.Tag("ConfigInit")<
  ConfigInit,
  { readonly ensure: Effect.Effect<void, Error> }
>() {
  static Noop = Layer.succeed(ConfigInit, { ensure: Effect.void })

  static Live = Layer.effect(
    ConfigInit,
    Effect.gen(function* () {
      const { root } = yield* Cwd
      const executor = yield* CommandExecutor.CommandExecutor
      const fs = yield* FileSystem.FileSystem

      const ensureBody = Effect.gen(function* () {
        const present = yield* anyConfigPresent(root)
        if (present) return

        const git = (...args: Array<string>) =>
          executor.exitCode(Command.make("git", ...args).pipe(Command.workingDirectory(root)))
        const writeStub = fs
          .writeFileString(join(root, ".gtdrc.json"), SCHEMA_STUB)
          .pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

        // A repo with no commits yet has no HEAD to stack on or amend into —
        // commit the stub as the first commit.
        const headSubject = yield* Command.make("git", "log", "-1", "--pretty=%s")
          .pipe(Command.workingDirectory(root), Command.string)
          .pipe(Effect.map((s) => s.trim()))
          .pipe(Effect.catchAll(() => Effect.succeed(undefined)))

        yield* writeStub
        yield* git("add", ".gtdrc.json")
        // A repo that's already mid-workflow (any `gtd(actor): state` HEAD)
        // must not gain a NEW boundary commit on top: the machine owns the
        // commit history here, and stacking a fresh `chore:` commit would
        // produce an unrecognized boundary HEAD that resolves back to the
        // workflow's initial state. Instead, amend the stub INTO the
        // existing HEAD commit — HEAD's subject (and therefore what
        // `resolveState` classifies) is unchanged, only its tree gains
        // `.gtdrc.json`.
        if (headSubject !== undefined && parseStateSubject(headSubject) !== undefined) {
          yield* git("commit", "--amend", "--no-edit")
        } else {
          yield* git("commit", "-m", "chore: add .gtdrc.json")
        }
      })

      const ensure: Effect.Effect<void, Error> = ensureBody.pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, executor),
        Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))),
      )

      return { ensure }
    }),
  )
}

export class ConfigService extends Context.Tag("ConfigService")<ConfigService, ConfigOperations>() {
  static Live = Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      const { root } = yield* Cwd

      const merged = yield* loadMerged(root)
      const { $schema: _schema, ...cleaned } = merged
      const decoded = yield* Schema.decodeUnknown(ConfigSchema)(cleaned, {
        onExcessProperty: "error",
      })
        .pipe(Effect.mapError(formatSchemaError))
        .pipe(Effect.mapError((msg) => new Error(msg)))
      return yield* Effect.try({
        try: () => toOperations(decoded, root),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
    }),
  )
}
