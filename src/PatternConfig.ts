import { existsSync, readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import {
  validateDefinition,
  type OnEdge,
  type RetryDef,
  type StateDef,
  type StateMode,
  type WorkflowDefinition,
} from "./PatternMachine.js"

/**
 * The v3 `.gtdrc` `workflow:` config compiler (see
 * `docs/design/pattern-machine-plan.md`, "Phase 2: Config + templates"). This
 * module turns the raw, unknown-shaped YAML value of the `workflow:` key into
 * a `PatternMachine` `WorkflowDefinition` — the ONLY definition source in v3
 * (no `extends`, no merge-over-a-built-in: the bundled default workflow is
 * itself a YAML asset compiled through this same function, a Phase 3
 * concern). Purely a compiler: no git, no Effect, no CLI wiring — those are
 * later phases.
 *
 * ## Schema
 *
 * ```yaml
 * vars:                 # optional — the workflow's own declared `it.vars` defaults
 *   anyKey: anyScalarValue
 * states:
 *   <name>:
 *     actor: <string>    # forbidden on a commit state, required otherwise
 *     script: <string>   # exactly one of script/prompt/message/commit
 *     on:                # a mapping, DECLARATION ORDER PRESERVED
 *       "<pattern>": <targetState>                    # short form
 *       "<pattern>": { to: <targetState>, describe: <sentence> }  # with a human-readable route description
 *     initial: true       # exactly one state across the whole workflow
 *     retry:
 *       max: <number>
 *       otherwise: <targetState>
 *     model: <string>     # optional, opaque harness hint — never on a commit state
 *     memory: <string>    # optional, opaque memory-scope label — never on a commit state
 *     file: <string>      # optional, an Eta template naming the state's steering file — never on a commit state
 *     mode: qa | review   # optional, requires "file" — never on a commit state
 * ```
 *
 * ## `vars:` — one of `it.vars`'s three layers
 *
 * A sibling `vars:` key INSIDE the `workflow:` value declares the workflow's
 * OWN defaults for the merged `it.vars` template map (see
 * `PatternTemplates.TemplateContext.vars`) — the lowest-precedence of its
 * three layers (a top-level `.gtdrc` `vars:` key, then `GTD_VAR_`-prefixed
 * environment variables, both assembled by `src/Edge.ts`'s `resolveVars`,
 * override it here). Every value must be a YAML scalar (string/number/
 * boolean) — `compileVarsMap` coerces it to a string; an object/array value
 * is a config-shape load error, collected alongside every other finding
 * rather than guessed at. This compiler's only input is the `workflow:`
 * key's own raw value (per the Phase 2 brief) — it never sees the rest of the
 * `.gtdrc` document, so the top-level `vars:` layer is entirely
 * `ConfigService`'s concern (`src/Config.ts`), not this module's.
 *
 * ## File references
 *
 * A content value (`script`/`prompt`/`message`/`commit`) is a FILE REFERENCE
 * iff it starts with `./` or `../` — resolved relative to `configDir` (the
 * config file's own directory, supplied by the caller) and auto-inlined at
 * load time. A missing or unreadable file is a LOAD ERROR: it is collected
 * into this function's thrown error, never silently treated as inline
 * template text. Any other string (including one that merely contains a `/`,
 * or an absolute path) is inline template source, used verbatim.
 *
 * ## Validation
 *
 * Config-shape errors (unknown keys, wrong types, unreadable file
 * references) are collected; whenever `states` itself parses into
 * per-state objects (however messy — a truly unassemblable `workflow:` value,
 * e.g. not an object, or a missing/empty `states`, is the only case that
 * throws early with just the shape errors), the assembled
 * `WorkflowDefinition` is ADDITIONALLY run through the engine's
 * `validateDefinition` (exactly one initial state, exactly one content kind
 * per state, `on`/`retry` targets all resolve, commit states carry no
 * actor/`on`, etc), and both lists of findings are merged (de-duplicating
 * identical messages) into ONE thrown error — never just the first problem
 * found, so an unrelated state's bad `on` target is never hidden behind an
 * earlier state's content-kind violation. A bad config fails LOUDLY at load
 * time — `compileWorkflowConfig` throws — and never at step time.
 */

// ── Small helpers ────────────────────────────────────────────────────────────

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const describeType = (v: unknown): string => {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

/** A content value is a file reference iff it starts with `./` or `../`. */
const isFileReference = (value: string): boolean =>
  value.startsWith("./") || value.startsWith("../")

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean"

/**
 * Compile a flat `name -> scalar` map — the `vars:` shape shared by a
 * workflow's own declared defaults (this module) and the top-level `.gtdrc`
 * `vars:` key (`src/Config.ts`, which imports this same function so the two
 * layers validate identically). `undefined` (the key absent) compiles to
 * `{}`. A non-object value, or any individual value that isn't a YAML scalar
 * (string/number/boolean), pushes a load error onto `errors` — the whole
 * value or just that key is dropped, never guessed at — and the well-formed
 * keys still compile. Every scalar is coerced to its string form.
 */
export const compileVarsMap = (raw: unknown, errors: string[]): Record<string, string> => {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) {
    errors.push(`"vars" must be a mapping of name -> scalar value, got ${describeType(raw)}`)
    return {}
  }
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isScalar(value)) {
      errors.push(`"vars.${key}" must be a string, number, or boolean, got ${describeType(value)}`)
      continue
    }
    vars[key] = String(value)
  }
  return vars
}

const CONTENT_KEYS = ["script", "prompt", "message", "commit"] as const
type ContentKey = (typeof CONTENT_KEYS)[number]

const KNOWN_STATE_KEYS: ReadonlySet<string> = new Set([
  "actor",
  ...CONTENT_KEYS,
  "on",
  "initial",
  "retry",
  "model",
  "memory",
  "file",
  "mode",
  "reviewWindow",
  "reviewBase",
])

const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set(["vars", "states"])

// ── Compilation result ───────────────────────────────────────────────────────

/** What `compileWorkflowConfig` produces: the compiled definition, plus the workflow's own declared `it.vars` defaults. */
export interface CompiledWorkflowConfig {
  readonly definition: WorkflowDefinition
  /** The compiled `vars:` map (scalar-coerced) — the lowest-precedence layer of the merged `it.vars` (see `src/Edge.ts`'s `resolveVars`). `{}` when absent. */
  readonly vars: Record<string, string>
}

const formatErrors = (errors: readonly string[]): string =>
  `workflow config:\n${errors.map((e) => `  - ${e}`).join("\n")}`

// ── Content resolution (file-ref auto-inlining) ─────────────────────────────

/**
 * Resolve one content string: inline text passes through verbatim; a file
 * reference (`./` or `../` prefix) is read relative to `configDir` and its
 * contents returned. A missing/unreadable file pushes a load error onto
 * `errors` and returns `undefined` (the caller omits the key rather than
 * guessing content).
 */
const resolveContent = (
  value: string,
  configDir: string,
  where: string,
  errors: string[],
): string | undefined => {
  if (!isFileReference(value)) return value
  const filePath = resolvePath(configDir, value)
  if (!existsSync(filePath)) {
    errors.push(`${where}: file reference "${value}" does not exist (resolved to "${filePath}")`)
    return undefined
  }
  try {
    return readFileSync(filePath, "utf8")
  } catch (e) {
    errors.push(
      `${where}: file reference "${value}" could not be read: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
    return undefined
  }
}

// ── Per-state field compilers ────────────────────────────────────────────────

const KNOWN_EDGE_KEYS: ReadonlySet<string> = new Set(["to", "describe"])

/**
 * Compile one `on` row's value into an `OnEdge` (or `undefined`, pushing a
 * finding, when the value is malformed). The value is EITHER a target-state
 * name (a string) OR a `{ to: <target>, describe: <sentence> }` object — the
 * object form attaches an optional human-readable `describe` a `message:`
 * template can surface at a rest (see `PatternMachine.OnEdge`).
 */
const compileOnEdge = (
  pattern: string,
  value: unknown,
  name: string,
  errors: string[],
): OnEdge | undefined => {
  if (typeof value === "string") return [pattern, value]
  if (!isPlainObject(value)) {
    errors.push(
      `state "${name}": "on" entry for pattern "${pattern}" must be a target state name (string) or a { to, describe } object`,
    )
    return undefined
  }
  const unknownKeys = Object.keys(value).filter((k) => !KNOWN_EDGE_KEYS.has(k))
  if (unknownKeys.length > 0) {
    errors.push(
      `state "${name}": "on" entry for pattern "${pattern}" has unknown key(s) ${unknownKeys.join(", ")}`,
    )
  }
  const { to, describe } = value
  if (typeof to !== "string") {
    errors.push(`state "${name}": "on.${pattern}.to" must be a target state name (string)`)
    return undefined
  }
  if (describe !== undefined && typeof describe !== "string") {
    errors.push(`state "${name}": "on.${pattern}.describe" must be a string`)
    return undefined
  }
  return describe !== undefined ? [pattern, to, describe] : [pattern, to]
}

/**
 * The `on` mapping: pattern -> edge, preserving declaration order as `OnEdge`
 * tuples. Each row's value is compiled by `compileOnEdge` (a target string or
 * a `{ to, describe }` object).
 */
const compileOn = (raw: unknown, name: string, errors: string[]): readonly OnEdge[] | undefined => {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    errors.push(`state "${name}": "on" must be a mapping of pattern -> target state`)
    return undefined
  }
  const edges: OnEdge[] = []
  for (const [pattern, value] of Object.entries(raw)) {
    const edge = compileOnEdge(pattern, value, name, errors)
    if (edge !== undefined) edges.push(edge)
  }
  return edges
}

/** `{ max, otherwise }`, both required and type-checked. */
const compileRetry = (raw: unknown, name: string, errors: string[]): RetryDef | undefined => {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    errors.push(`state "${name}": "retry" must be an object with "max" and "otherwise"`)
    return undefined
  }
  const unknownKeys = Object.keys(raw).filter((k) => k !== "max" && k !== "otherwise")
  if (unknownKeys.length > 0) {
    errors.push(`state "${name}": "retry" has unknown key(s) ${unknownKeys.join(", ")}`)
  }
  const { max, otherwise } = raw
  const maxOk = typeof max === "number"
  const otherwiseOk = typeof otherwise === "string"
  if (!maxOk) errors.push(`state "${name}": "retry.max" must be a number`)
  if (!otherwiseOk) errors.push(`state "${name}": "retry.otherwise" must be a string`)
  return maxOk && otherwiseOk ? { max, otherwise } : undefined
}

/** Exactly one of script/prompt/message/commit, each a string, file-refs auto-inlined. */
const compileContent = (
  raw: Record<string, unknown>,
  name: string,
  configDir: string,
  errors: string[],
): Partial<Record<ContentKey, string>> => {
  const content: Partial<Record<ContentKey, string>> = {}
  for (const key of CONTENT_KEYS) {
    const rawValue = raw[key]
    if (rawValue === undefined) continue
    if (typeof rawValue !== "string") {
      errors.push(`state "${name}": "${key}" must be a string`)
      continue
    }
    const resolved = resolveContent(rawValue, configDir, `state "${name}" (${key})`, errors)
    if (resolved !== undefined) content[key] = resolved
  }
  // The "exactly one content kind" rule is NOT re-checked here — it's owned
  // solely by the engine's `validateDefinition` (`validateContentKind`),
  // which runs over the fully assembled definition alongside every other
  // shape error (see `compileWorkflowConfig`'s aggregation). Duplicating the
  // count check here used to hide every other finding behind it.
  return content
}

/** The `actor` field: a plain string, or undefined (either absent or invalid — the type mismatch is its own error). */
const compileActor = (
  raw: Record<string, unknown>,
  name: string,
  errors: string[],
): string | undefined => {
  if (raw.actor === undefined) return undefined
  if (typeof raw.actor !== "string") {
    errors.push(`state "${name}": "actor" must be a string`)
    return undefined
  }
  return raw.actor
}

/** The `model` field: an opaque string, or undefined (either absent or invalid — the type mismatch is its own error). Never interpreted or validated beyond "is it a string" — see `PatternMachine.StateDef.model`. */
const compileModel = (
  raw: Record<string, unknown>,
  name: string,
  errors: string[],
): string | undefined => {
  if (raw.model === undefined) return undefined
  if (typeof raw.model !== "string") {
    errors.push(`state "${name}": "model" must be a string`)
    return undefined
  }
  return raw.model
}

/** The `memory` field: an opaque memory-scope label (Eta template), or undefined (either absent or invalid — the type mismatch is its own error). Never interpreted or validated beyond "is it a string" — see `PatternMachine.StateDef.memory`. */
const compileMemory = (
  raw: Record<string, unknown>,
  name: string,
  errors: string[],
): string | undefined => {
  if (raw.memory === undefined) return undefined
  if (typeof raw.memory !== "string") {
    errors.push(`state "${name}": "memory" must be a string`)
    return undefined
  }
  return raw.memory
}

/** The `file` field: an Eta template string naming the state's steering file, or undefined (either absent or invalid — the type mismatch is its own error). Vocabulary/shape rules (non-empty, forbidden on a commit state) are `validateDefinition`'s concern, not this compiler's — see `PatternMachine.StateDef.file`. */
const compileFile = (
  raw: Record<string, unknown>,
  name: string,
  errors: string[],
): string | undefined => {
  if (raw.file === undefined) return undefined
  if (typeof raw.file !== "string") {
    errors.push(`state "${name}": "file" must be a string`)
    return undefined
  }
  return raw.file
}

/** The `mode` field: a plain string, or undefined (either absent or invalid — the type mismatch is its own error). Whether it names one of the closed `qa`/`review` vocabulary is `validateDefinition`'s concern, not this compiler's — see `PatternMachine.StateDef.mode`. */
const compileMode = (
  raw: Record<string, unknown>,
  name: string,
  errors: string[],
): StateMode | undefined => {
  if (raw.mode === undefined) return undefined
  if (typeof raw.mode !== "string") {
    errors.push(`state "${name}": "mode" must be a string`)
    return undefined
  }
  return raw.mode as StateMode
}

/** The `initial` field: `true` only when the raw value is the literal boolean `true`. */
const compileInitial = (
  raw: Record<string, unknown>,
  name: string,
  errors: string[],
): true | undefined => compileBooleanFlag(raw, "initial", name, errors)

/**
 * A boolean state flag (`initial`/`reviewWindow`/`reviewBase`): `true` only
 * when the raw value is the literal `true`; a non-boolean is a config error;
 * `false` (or absent) compiles away to `undefined` so it never lands in the
 * `StateDef` — `false` and "unset" mean the same thing for every such flag.
 */
const compileBooleanFlag = (
  raw: Record<string, unknown>,
  key: string,
  name: string,
  errors: string[],
): true | undefined => {
  const value = raw[key]
  if (value === undefined) return undefined
  if (value !== true && value !== false) {
    errors.push(`state "${name}": "${key}" must be a boolean`)
    return undefined
  }
  return value === true ? true : undefined
}

/** One state's compiled parts, assembled into a `StateDef` (only present fields carried over — `exactOptionalPropertyTypes`). */
interface StateParts {
  readonly actor: string | undefined
  readonly content: Partial<Record<ContentKey, string>>
  readonly on: readonly OnEdge[] | undefined
  readonly initial: true | undefined
  readonly retry: RetryDef | undefined
  readonly model: string | undefined
  readonly memory: string | undefined
  readonly file: string | undefined
  readonly mode: StateMode | undefined
  readonly reviewWindow: true | undefined
  readonly reviewBase: true | undefined
}

const assembleContentFields = (
  content: Partial<Record<ContentKey, string>>,
): Partial<StateDef> => ({
  ...(content.script !== undefined ? { script: content.script } : {}),
  ...(content.prompt !== undefined ? { prompt: content.prompt } : {}),
  ...(content.message !== undefined ? { message: content.message } : {}),
  ...(content.commit !== undefined ? { commit: content.commit } : {}),
})

/**
 * Spreads only the DEFINED entries of `fields` — the shared "omit rather
 * than write `undefined`" pattern every scalar `StateDef` field needs
 * (`exactOptionalPropertyTypes`). Generalized into one helper (rather than a
 * repeated `...(x !== undefined ? { x } : {})` per field) so adding a new
 * optional state property never grows `assembleStateDef` itself — see this
 * module's own header comment on why that function was already split once
 * for fallow's complexity gate.
 */
type DefinedFields<T> = { [K in keyof T]?: NonNullable<T[K]> }

const definedEntries = <T extends Record<string, unknown>>(fields: T): DefinedFields<T> => {
  const out: DefinedFields<T> = {}
  for (const key of Object.keys(fields) as (keyof T)[]) {
    const value = fields[key]
    if (value !== undefined) out[key] = value as DefinedFields<T>[typeof key]
  }
  return out
}

const assembleStateDef = (parts: StateParts): StateDef => ({
  ...definedEntries({
    actor: parts.actor,
    on: parts.on,
    initial: parts.initial,
    retry: parts.retry,
    model: parts.model,
    memory: parts.memory,
    file: parts.file,
    mode: parts.mode,
    reviewWindow: parts.reviewWindow,
    reviewBase: parts.reviewBase,
  }),
  ...assembleContentFields(parts.content),
})

/** One state's full shape: actor, content, `on`, `initial`, `retry`. */
const compileState = (
  name: string,
  raw: unknown,
  configDir: string,
  errors: string[],
): StateDef => {
  if (!isPlainObject(raw)) {
    errors.push(`state "${name}": must be an object, got ${describeType(raw)}`)
    return {}
  }

  const unknownKeys = Object.keys(raw).filter((k) => !KNOWN_STATE_KEYS.has(k))
  if (unknownKeys.length > 0) {
    errors.push(`state "${name}": unknown key(s) ${unknownKeys.join(", ")}`)
  }

  return assembleStateDef({
    actor: compileActor(raw, name, errors),
    content: compileContent(raw, name, configDir, errors),
    on: compileOn(raw.on, name, errors),
    initial: compileInitial(raw, name, errors),
    retry: compileRetry(raw.retry, name, errors),
    model: compileModel(raw, name, errors),
    memory: compileMemory(raw, name, errors),
    file: compileFile(raw, name, errors),
    mode: compileMode(raw, name, errors),
    reviewWindow: compileBooleanFlag(raw, "reviewWindow", name, errors),
    reviewBase: compileBooleanFlag(raw, "reviewBase", name, errors),
  })
}

// ── Top-level compile ────────────────────────────────────────────────────────

/**
 * Compile the raw, decoded `workflow:` YAML value into a `WorkflowDefinition`
 * plus the workflow's own compiled `vars:` map. `configDir` is the config
 * file's own directory, used to resolve `./`/`../` file references. Throws a single
 * `Error` (message: `"workflow config:\n  - ..."`, one line per finding) on
 * ANY config-shape problem or `validateDefinition` finding — never partially
 * succeeds.
 */
export const compileWorkflowConfig = (raw: unknown, configDir: string): CompiledWorkflowConfig => {
  if (!isPlainObject(raw)) {
    throw new Error(`workflow config: must be an object, got ${describeType(raw)}`)
  }

  const errors: string[] = []

  const unknownTopKeys = Object.keys(raw).filter((k) => !KNOWN_TOP_KEYS.has(k))
  if (unknownTopKeys.length > 0) {
    errors.push(`unknown top-level key(s) ${unknownTopKeys.join(", ")}`)
  }

  const vars = compileVarsMap(raw.vars, errors)

  const rawStates = raw.states
  if (!isPlainObject(rawStates) || Object.keys(rawStates).length === 0) {
    // Truly unassemblable: there is no per-state work to even attempt, so
    // there is nothing `validateDefinition` could add — throw with just the
    // shape errors collected so far.
    errors.push(`"states" must be a non-empty object`)
    throw new Error(formatErrors(errors))
  }

  const states: Record<string, StateDef> = {}
  for (const [name, s] of Object.entries(rawStates)) {
    states[name] = compileState(name, s, configDir, errors)
  }

  // A definition can still be assembled (however messy) whenever `states`
  // itself parsed — so run `validateDefinition` unconditionally and merge its
  // findings with the shape errors collected above into ONE thrown error,
  // rather than stopping at the first shape problem and hiding everything
  // `validateDefinition` would otherwise have caught (e.g. a bad `on` target
  // in an unrelated state). De-duplicate identical messages (both passes can
  // independently notice the same problem).
  const definition: WorkflowDefinition = { states }
  const definitionErrors = validateDefinition(definition)
  const allErrors = Array.from(new Set([...errors, ...definitionErrors]))
  if (allErrors.length > 0) throw new Error(formatErrors(allErrors))

  return { definition, vars }
}
