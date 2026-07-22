import { existsSync, readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import {
  validateDefinition,
  type OnEdge,
  type RetryDef,
  type StateDef,
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
 * vars:                 # optional — passed through to templates verbatim as `config`
 *   anyKey: anyValue
 * states:
 *   <name>:
 *     actor: <string>    # forbidden on a commit state, required otherwise
 *     script: <string>   # exactly one of script/prompt/message/commit
 *     on:                # a mapping, DECLARATION ORDER PRESERVED
 *       "<pattern>": <targetState>
 *     initial: true       # exactly one state across the whole workflow
 *     retry:
 *       max: <number>
 *       otherwise: <targetState>
 * ```
 *
 * ## The `config` passthrough (Phase 2's pick, for Phase 3/docs to confirm)
 *
 * The plan leaves the `config` template variable's SOURCE open ("the rest of
 * the .gtdrc document, or a `vars:`-style sub-key — pick the simplest
 * thing"). This compiler's only input is the `workflow:` key's own raw value
 * (per the Phase 2 brief) — it never sees the rest of the `.gtdrc` document —
 * so the simplest self-contained choice is a sibling `vars:` key INSIDE the
 * `workflow:` value, passed through verbatim (any shape, no validation) as
 * the `config` template variable. If a later phase decides templates should
 * instead see the whole `.gtdrc` document, that is a call for whoever wires
 * `ConfigService` (Phase 3), not this module.
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
 * references) are collected and thrown together; if the shape is clean, the
 * assembled `WorkflowDefinition` is additionally run through the engine's
 * `validateDefinition` (exactly one initial state, exactly one content kind
 * per state, `on`/`retry` targets all resolve, commit states carry no
 * actor/`on`, etc). A bad config fails LOUDLY at load time — `compileWorkflowConfig`
 * throws — and never at step time.
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

const CONTENT_KEYS = ["script", "prompt", "message", "commit"] as const
type ContentKey = (typeof CONTENT_KEYS)[number]

const KNOWN_STATE_KEYS: ReadonlySet<string> = new Set([
  "actor",
  ...CONTENT_KEYS,
  "on",
  "initial",
  "retry",
])

const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set(["vars", "states"])

// ── Compilation result ───────────────────────────────────────────────────────

/** What `compileWorkflowConfig` produces: the compiled definition, plus the `vars:` passthrough for templates. */
export interface CompiledWorkflowConfig {
  readonly definition: WorkflowDefinition
  /** The raw `vars:` value (any shape, unvalidated) — the `config` template variable. `undefined` when absent. */
  readonly config: unknown
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

/** The `on` mapping: pattern -> target, preserving declaration order as `OnEdge` tuples. */
const compileOn = (raw: unknown, name: string, errors: string[]): readonly OnEdge[] | undefined => {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    errors.push(`state "${name}": "on" must be a mapping of pattern -> target state`)
    return undefined
  }
  const edges: OnEdge[] = []
  for (const [pattern, target] of Object.entries(raw)) {
    if (typeof target !== "string") {
      errors.push(`state "${name}": "on" target for pattern "${pattern}" must be a string`)
      continue
    }
    edges.push([pattern, target])
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
  const presentCount = CONTENT_KEYS.filter((k) => content[k] !== undefined).length
  if (presentCount !== 1) {
    // Only report the config-shape count when every declared content value
    // resolved cleanly — a load-error content key is already reported above,
    // and piling on a second, confusing "wrong count" message for the same
    // key would obscure the actual problem.
    const declaredCount = CONTENT_KEYS.filter((k) => raw[k] !== undefined).length
    if (declaredCount === presentCount) {
      errors.push(
        `state "${name}" must declare exactly one of script/prompt/message/commit (found ${declaredCount})`,
      )
    }
  }
  return content
}

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

  let actor: string | undefined
  if (raw.actor !== undefined) {
    if (typeof raw.actor !== "string") {
      errors.push(`state "${name}": "actor" must be a string`)
    } else {
      actor = raw.actor
    }
  }

  let initial: true | undefined
  if (raw.initial !== undefined) {
    if (raw.initial !== true && raw.initial !== false) {
      errors.push(`state "${name}": "initial" must be a boolean`)
    } else if (raw.initial === true) {
      initial = true
    }
  }

  const content = compileContent(raw, name, configDir, errors)
  const on = compileOn(raw.on, name, errors)
  const retry = compileRetry(raw.retry, name, errors)

  return {
    ...(actor !== undefined ? { actor } : {}),
    ...(content.script !== undefined ? { script: content.script } : {}),
    ...(content.prompt !== undefined ? { prompt: content.prompt } : {}),
    ...(content.message !== undefined ? { message: content.message } : {}),
    ...(content.commit !== undefined ? { commit: content.commit } : {}),
    ...(on !== undefined ? { on } : {}),
    ...(initial !== undefined ? { initial } : {}),
    ...(retry !== undefined ? { retry } : {}),
  }
}

// ── Top-level compile ────────────────────────────────────────────────────────

/**
 * Compile the raw, decoded `workflow:` YAML value into a `WorkflowDefinition`
 * plus the `vars:` passthrough. `configDir` is the config file's own
 * directory, used to resolve `./`/`../` file references. Throws a single
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

  const rawStates = raw.states
  const states: Record<string, StateDef> = {}
  if (!isPlainObject(rawStates) || Object.keys(rawStates).length === 0) {
    errors.push(`"states" must be a non-empty object`)
  } else {
    for (const [name, s] of Object.entries(rawStates)) {
      states[name] = compileState(name, s, configDir, errors)
    }
  }

  if (errors.length > 0) throw new Error(formatErrors(errors))

  const definition: WorkflowDefinition = { states }
  const definitionErrors = validateDefinition(definition)
  if (definitionErrors.length > 0) throw new Error(formatErrors(definitionErrors))

  return { definition, config: raw.vars }
}
