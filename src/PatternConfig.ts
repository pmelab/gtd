import { existsSync, readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import {
  validateDefinition,
  type ModeDef,
  type OnEdge,
  type RetryDef,
  type StateDef,
  type StateMode,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import { flattenMachines, type MachineNode } from "./Machines.js"

/**
 * The v3 `.gtdrc` `workflow:` config compiler. This
 * module turns the raw, unknown-shaped YAML value of the `workflow:` key into
 * a `PatternMachine` `WorkflowDefinition` — the ONLY definition source in v3
 * (no `extends`, no merge-over-a-built-in: the bundled default workflow is
 * itself a YAML asset compiled through this same function, a
 * concern). Purely a compiler: no git, no Effect, no CLI wiring — those are
 * later phases.
 *
 * ## Schema
 *
 * ```yaml
 * vars:                 # optional — the workflow's own declared `it.vars` defaults
 *   anyKey: anyScalarValue
 * modes:                # optional — steering-file modes a state's `mode:` may name
 *   <name>:
 *     format: <shell command>    # at least one of format/validate
 *     validate: <shell command>
 * entry:
 *   default: <machine name>     # which machine is the ROOT instance
 *   review: <target>?           # resolved through the flattener's resolver, seeded at the root
 *   fix: <target>?
 * machines:
 *   <name>:
 *     params: [<param>, ...]?   # advisory only — documents which $params a caller may bind
 *     entry: <local or ref key> # this machine's OWN default local, resolved recursively
 *     states:
 *       <local>:                # an ordinary state
 *         actor: <string>    # forbidden on a commit state, required otherwise
 *         script: <string>   # exactly one of script/prompt/message/commit
 *         on:                # a mapping, DECLARATION ORDER PRESERVED — each <pattern> KEY is itself an Eta template, rendered against `it.vars` at the edge (src/Edge.ts's renderOnEdges) before the pure engine ever sees it
 *           "<pattern>": <targetState>                    # short form
 *           "<pattern>": { to: <targetState>, describe: <sentence> }  # with a human-readable route description (describe is NEVER Eta-rendered, unlike the pattern key)
 *         retry:
 *           max: <number>
 *           otherwise: <targetState>
 *         model: <string>     # optional, opaque harness hint — never on a commit state
 *         memory: <string>    # optional, opaque memory-scope label — never on a commit state
 *         label: <string>     # optional, opaque display name — never on a commit state
 *         file: <string>      # optional, an Eta template naming the state's steering file — never on a commit state
 *         mode: <modeName>    # optional, requires "file" — a built-in (qa/review) or a `modes:` entry; never on a commit state
 *       <local>: { machine: <name>, with: { ... } }       # a REFERENCE — instantiates <name> as a child, see src/Machines.ts
 * ```
 *
 * The raw `entry:`/`machines:` value is flattened by `src/Machines.ts`'s
 * `flattenMachines` into qualified states plus resolved entry points BEFORE any
 * per-state compilation below ever runs — this module never sees an unresolved
 * `$param` or a bare reference path.
 *
 * ## `vars:` — one of `it.vars`'s three layers
 *
 * A sibling `vars:` key INSIDE the `workflow:` value declares the workflow's
 * OWN defaults for the merged `it.vars` template map (see
 * `PatternTemplates.TemplateContext.vars`) — the lowest-precedence of its
 * three layers (a top-level `.gtdrc` `vars:` key, then `GTD_<UPPERCASE-name>`
 * environment variables, both assembled by `src/Edge.ts`'s `resolveVars`,
 * override it here). Every value must be a YAML scalar (string/number/
 * boolean) — `compileVarsMap` coerces it to a string; an object/array value
 * is a config-shape load error, collected alongside every other finding
 * rather than guessed at. This compiler's only input is the `workflow:`
 * key's own raw value (per the Phase 2 brief) — it never sees the rest of the
 * `.gtdrc` document, so the top-level `vars:` layer is entirely
 * `ConfigService`'s concern (`src/Config.ts`), not this module's.
 *
 * ## `modes:` — the steering-file modes a state's `mode:` may name
 *
 * A sibling `modes:` key INSIDE the `workflow:` value declares this workflow's
 * own steering-file modes (see `PatternMachine.ModeDef`), each a `format:`
 * and/or `validate:` SHELL COMMAND. Like `vars:`, it has a second layer this
 * compiler does not read for itself: the top-level `.gtdrc` `modes:` key, which
 * `ConfigService` compiles through this module's `compileModesMap` and hands
 * back in as `rcModes`, merged per half by `mergeModes`. gtd's own `qa`/
 * `review` remain available under the whole thing as VALIDATORS
 * (`PatternMachine.BuiltInMode`) — resolution of the merged map against them is
 * the edge's job (`src/SteeringMode.ts`), not this compiler's.
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

const MODE_COMMAND_KEYS = ["format", "validate"] as const

/**
 * Compile the `modes:` map — mode name -> `{ format?, validate? }` shell
 * commands (see `PatternMachine.ModeDef`). An absent key compiles to
 * `undefined` — the definition then carries no `modes` at all, leaving only the
 * built-ins. A non-object value, an entry that isn't an object, an
 * unknown key inside an entry, or a non-string command each push a load error
 * — the offending value is dropped, never guessed at, and the well-formed
 * entries still compile. The SEMANTIC rules (at least one command per mode,
 * neither blank) belong to `validateDefinition`, which sees the assembled
 * definition.
 *
 * A command is NEVER treated as a `./`-relative file reference the way content
 * strings are (see `resolveContent`): `./scripts/check.sh` is a perfectly good
 * shell command, so inlining it as template text would break the obvious
 * reading. Commands are Eta templates, rendered at the edge with `it.file`
 * bound to the rendered steering-file path (`src/SteeringMode.ts`).
 */
export const compileModesMap = (
  raw: unknown,
  errors: string[],
): Record<string, ModeDef> | undefined => {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    errors.push(
      `"modes" must be a mapping of mode name -> { format, validate }, got ${describeType(raw)}`,
    )
    return undefined
  }
  const modes: Record<string, ModeDef> = {}
  for (const [name, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      errors.push(
        `mode "${name}": must be an object with "format" and/or "validate", got ${describeType(entry)}`,
      )
      continue
    }
    const unknownKeys = Object.keys(entry).filter(
      (k) => !(MODE_COMMAND_KEYS as readonly string[]).includes(k),
    )
    if (unknownKeys.length > 0) {
      errors.push(`mode "${name}": unknown key(s) ${unknownKeys.join(", ")}`)
    }
    const commands: { format?: string; validate?: string } = {}
    for (const key of MODE_COMMAND_KEYS) {
      const command = entry[key]
      if (command === undefined) continue
      if (typeof command !== "string") {
        errors.push(`mode "${name}": "${key}" must be a shell command (string)`)
        continue
      }
      commands[key] = command
    }
    modes[name] = commands
  }
  return modes
}

/**
 * Layer one `modes:` map over another, PER HALF: an override entry's
 * `format:`/`validate:` wins, and a half it leaves out keeps the base's. This
 * is how the top-level `.gtdrc` `modes:` key plugs a formatter into a mode the
 * workflow (or gtd itself) already validates — `{ qa: { format: "..." } }` adds
 * formatting to `qa` without touching its validation. Both arguments may be
 * `undefined` (an absent key); the result is `undefined` only when both are.
 */
export const mergeModes = (
  base: Readonly<Record<string, ModeDef>> | undefined,
  override: Readonly<Record<string, ModeDef>> | undefined,
): Record<string, ModeDef> | undefined => {
  if (base === undefined && override === undefined) return undefined
  const merged: Record<string, ModeDef> = { ...base }
  for (const [name, entry] of Object.entries(override ?? {})) {
    merged[name] = { ...merged[name], ...entry }
  }
  return merged
}

const CONTENT_KEYS = ["script", "prompt", "message", "commit"] as const
type ContentKey = (typeof CONTENT_KEYS)[number]

const KNOWN_STATE_KEYS: ReadonlySet<string> = new Set([
  "actor",
  ...CONTENT_KEYS,
  "on",
  "retry",
  "model",
  "memory",
  "label",
  "file",
  "mode",
  "reviewWindow",
  "reviewBase",
  "requireProgress",
  "answerGate",
])

const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set(["entry", "machines", "vars", "modes"])
const KNOWN_MACHINE_KEYS: ReadonlySet<string> = new Set(["params", "entry", "states"])
const KNOWN_REF_KEYS: ReadonlySet<string> = new Set(["machine", "with"])

/** A state-level key removed by the `entry:`/`machines:` rewrite, naming its replacement so a stale config's error points somewhere useful instead of a bare "unknown key". */
const LEGACY_STATE_KEY_HINTS: Readonly<Record<string, string>> = {
  initial: `"initial" no longer exists — declare this state's qualified path in the top-level "entry.default" instead`,
  reviewEntry: `"reviewEntry" no longer exists — declare this state's qualified path in the top-level "entry.review" instead`,
  fixEntry: `"fixEntry" no longer exists — declare this state's qualified path in the top-level "entry.fix" instead`,
}

/** A reference-level key from the old `use:` invocation shape, naming its replacement. */
const LEGACY_REF_KEY_HINTS: Readonly<Record<string, string>> = {
  as: `"as" no longer exists — a reference's local name (the key itself) IS the concrete name; there is nothing left to rename`,
  name: `"name" no longer exists — a reference's local name (the key itself) names the instance`,
  set: `"set" no longer exists — bind extra per-instance values via "with:" instead`,
}

/** Render an unknown-key list, appending a legacy-key hint in parentheses for any key `hints` recognizes. */
const formatUnknownKeys = (
  keys: readonly string[],
  hints: Readonly<Record<string, string>>,
): string => keys.map((k) => (hints[k] !== undefined ? `${k} (${hints[k]})` : k)).join(", ")

/**
 * A top-level key from the pre-Package-02 raw shape (flat `states:`, or the
 * sub-machine expander's `submachines:`/`use:`). Detected and thrown FIRST, before
 * any other validation, so a stale config produces only this migration table —
 * never forty downstream "machines is required"-style findings piled on top.
 */
const LEGACY_TOP_KEY_MESSAGES: Readonly<Record<string, string>> = {
  states: `top-level "states:" is no longer supported — declare a machine under "machines:" and name it in "entry.default:"`,
  submachines: `top-level "submachines:" is no longer supported — declare machines directly under "machines:"`,
  use: `top-level "use:" is no longer supported — reference a machine inline via a { machine, with } entry inside a machine's own "states:"`,
}

const detectLegacyShape = (raw: Record<string, unknown>): void => {
  const found = Object.keys(LEGACY_TOP_KEY_MESSAGES).filter((k) => k in raw)
  if (found.length === 0) return
  throw new Error(formatErrors(found.map((k) => LEGACY_TOP_KEY_MESSAGES[k]!)))
}

/**
 * Structural validation over the raw `machines:` map that `src/Machines.ts`'s
 * `flattenMachines` does not itself perform: unknown keys on a machine
 * (`KNOWN_MACHINE_KEYS`) and unknown keys on a reference local
 * (`KNOWN_REF_KEYS`), the latter surfacing the old `use:` invocation's
 * `as`/`name`/`set` keys through `LEGACY_REF_KEY_HINTS` rather than a bare
 * "unknown key". Findings are pushed onto `errors`; a malformed shape (not an
 * object, a non-object machine/state) is left for `flattenMachines`/
 * `compileState` to report — this pass only adds what they don't already cover.
 */
/** Validate one machine's own reference locals against `KNOWN_REF_KEYS`, pushing findings onto `errors`. */
const validateMachineRefs = (
  machineName: string,
  machineRaw: Record<string, unknown>,
  errors: string[],
): void => {
  const statesRaw = machineRaw["states"]
  if (!isPlainObject(statesRaw)) return
  for (const [local, def] of Object.entries(statesRaw)) {
    if (!isRefRaw(def)) continue
    const unknownRefKeys = Object.keys(def).filter((k) => !KNOWN_REF_KEYS.has(k))
    if (unknownRefKeys.length > 0) {
      errors.push(
        `machine "${machineName}": reference "${local}": unknown key(s) ${formatUnknownKeys(unknownRefKeys, LEGACY_REF_KEY_HINTS)}`,
      )
    }
  }
}

const validateMachinesShape = (raw: unknown, errors: string[]): void => {
  if (raw === undefined) return
  if (!isPlainObject(raw)) {
    errors.push(
      `"machines" must be a mapping of machine name -> { params?, entry, states }, got ${describeType(raw)}`,
    )
    return
  }
  for (const [machineName, machineRaw] of Object.entries(raw)) {
    if (!isPlainObject(machineRaw)) continue
    const unknownMachineKeys = Object.keys(machineRaw).filter((k) => !KNOWN_MACHINE_KEYS.has(k))
    if (unknownMachineKeys.length > 0) {
      errors.push(`machine "${machineName}": unknown key(s) ${unknownMachineKeys.join(", ")}`)
    }
    validateMachineRefs(machineName, machineRaw, errors)
  }
}

// ── Compilation result ───────────────────────────────────────────────────────

/** What `compileWorkflowConfig` produces: the compiled definition, plus the workflow's own declared `it.vars` defaults. */
export interface CompiledWorkflowConfig {
  readonly definition: WorkflowDefinition
  /** The compiled `vars:` map (scalar-coerced) — the lowest-precedence layer of the merged `it.vars` (see `src/Edge.ts`'s `resolveVars`). `{}` when absent. */
  readonly vars: Record<string, string>
  /** The machine-instance tree `flattenMachines` (`src/Machines.ts`) built while compiling — a compilation OUTPUT for tooling (`gtd visualize`), never part of the pure `WorkflowDefinition` the engine reads. */
  readonly tree: MachineNode
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

/** A local is a REFERENCE iff its raw value carries a `machine` key — the same predicate `src/Machines.ts` uses. */
const isRefRaw = (v: unknown): v is Record<string, unknown> =>
  isPlainObject(v) && typeof v["machine"] === "string"

/**
 * Inline every `./`/`../` content file reference in ONE raw `workflow:` value
 * against `configDir` — the directory of the `.gtdrc` that DECLARED it — and
 * return a copy with those references replaced by the referenced file's text.
 *
 * Used by `src/Config.ts`'s `loadMerged` to resolve each config level's
 * references against its OWN file's directory BEFORE the levels are
 * deep-merged. The merge collapses every level into one anonymous object, so it
 * erases which file a given `machines.x.states.y.prompt` came from; resolving up
 * front, per level, is the only way `./gtd-prompts/x.md` in a parent `.gtdrc`
 * resolves against the parent (not the cwd a child repo runs from).
 * `compileWorkflowConfig` is then invoked with `inlineFileRefs: false` on the
 * merged result. Walks `machines[*].states[*]`, skipping reference entries (an
 * object carrying a `machine` key) — a reference has no content of its own to
 * inline.
 *
 * Malformed shapes (a non-object workflow, non-object `machines`, a non-object
 * machine/state, a non-string content value) pass through untouched —
 * `compileWorkflowConfig`/`validateDefinition` own those findings; this pass
 * only rewrites the strings it recognizes as file references, collecting a load
 * error (via `resolveContent`) for any that is missing or unreadable.
 */
/** Inline one ordinary (non-reference) state's own content file references; a reference passes through untouched. */
const inlineStateFileRefs = (
  def: Record<string, unknown>,
  machineName: string,
  local: string,
  configDir: string,
  errors: string[],
): Record<string, unknown> => {
  if (typeof def["machine"] === "string") return def
  const next: Record<string, unknown> = { ...def }
  for (const key of CONTENT_KEYS) {
    const value = def[key]
    if (typeof value !== "string" || !isFileReference(value)) continue
    const resolved = resolveContent(
      value,
      configDir,
      `machine "${machineName}" state "${local}" (${key})`,
      errors,
    )
    if (resolved !== undefined) next[key] = resolved
  }
  return next
}

/** Inline every state's content file references for one machine; a malformed machine/states shape passes through untouched. */
const inlineMachineFileRefs = (
  machineRaw: unknown,
  machineName: string,
  configDir: string,
  errors: string[],
): unknown => {
  if (!isPlainObject(machineRaw)) return machineRaw
  const rawStates = machineRaw["states"]
  if (!isPlainObject(rawStates)) return machineRaw
  const states: Record<string, unknown> = {}
  for (const [local, def] of Object.entries(rawStates)) {
    states[local] = isPlainObject(def)
      ? inlineStateFileRefs(def, machineName, local, configDir, errors)
      : def
  }
  return { ...machineRaw, states }
}

export const inlineWorkflowFileRefs = (
  rawWorkflow: unknown,
  configDir: string,
  errors: string[],
): unknown => {
  if (!isPlainObject(rawWorkflow)) return rawWorkflow
  const rawMachines = rawWorkflow["machines"]
  if (!isPlainObject(rawMachines)) return rawWorkflow
  const machines: Record<string, unknown> = {}
  for (const [machineName, machineRaw] of Object.entries(rawMachines)) {
    machines[machineName] = inlineMachineFileRefs(machineRaw, machineName, configDir, errors)
  }
  return { ...rawWorkflow, machines }
}

// ── Per-state field compilers ────────────────────────────────────────────────

const KNOWN_EDGE_KEYS: ReadonlySet<string> = new Set(["to", "describe", "action"])

/** A missing/malformed field's failure sentinel, distinct from a legitimate `undefined` value. */
const INVALID = Symbol("invalid edge field")

/**
 * Validate one optional string field (`describe` or `action`) off an edge
 * object, pushing a finding and returning `INVALID` when it's present but not
 * a string.
 */
const compileOptionalEdgeField = (
  value: unknown,
  pattern: string,
  name: string,
  field: "describe" | "action",
  errors: string[],
): string | undefined | typeof INVALID => {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    errors.push(`state "${name}": "on.${pattern}.${field}" must be a string`)
    return INVALID
  }
  return value
}

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
  const { to, describe, action } = value
  if (typeof to !== "string") {
    errors.push(`state "${name}": "on.${pattern}.to" must be a target state name (string)`)
    return undefined
  }
  const describeField = compileOptionalEdgeField(describe, pattern, name, "describe", errors)
  if (describeField === INVALID) return undefined
  const actionField = compileOptionalEdgeField(action, pattern, name, "action", errors)
  if (actionField === INVALID) return undefined
  // `describe` may be `undefined` here even though `action` is set (an edge
  // wanting an `action` but no `describe` passes an explicit `undefined`
  // placeholder in slot 3 — see `OnEdge`'s positional-coupling doc).
  if (actionField !== undefined) return [pattern, to, describeField, actionField]
  return describeField !== undefined ? [pattern, to, describeField] : [pattern, to]
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

/**
 * Exactly one of script/prompt/message/commit, each a string, file-refs
 * auto-inlined. `inlineFileRefs` is `false` only when the caller
 * (`src/Config.ts`'s `loadMerged`) has ALREADY inlined every reference per
 * declaring file — the content is then taken verbatim, so a `script:` whose
 * inlined text happens to begin with `./` is never mistaken for a second file
 * reference and re-resolved.
 */
const compileContent = (
  raw: Record<string, unknown>,
  name: string,
  configDir: string,
  errors: string[],
  inlineFileRefs: boolean,
): Partial<Record<ContentKey, string>> => {
  const content: Partial<Record<ContentKey, string>> = {}
  for (const key of CONTENT_KEYS) {
    const rawValue = raw[key]
    if (rawValue === undefined) continue
    if (typeof rawValue !== "string") {
      errors.push(`state "${name}": "${key}" must be a string`)
      continue
    }
    if (!inlineFileRefs) {
      content[key] = rawValue
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

/** The `label` field: an opaque display name, or undefined (either absent or invalid — the type mismatch is its own error). Never interpreted or validated beyond "is it a string" — see `PatternMachine.StateDef.label`. */
const compileLabel = (
  raw: Record<string, unknown>,
  name: string,
  errors: string[],
): string | undefined => {
  if (raw.label === undefined) return undefined
  if (typeof raw.label !== "string") {
    errors.push(`state "${name}": "label" must be a string`)
    return undefined
  }
  return raw.label
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

/**
 * A boolean state flag (`initial`/`reviewWindow`/`reviewBase`/`reviewEntry`/`fixEntry`/`requireProgress`/`answerGate`): `true` only
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

/** One state's compiled parts, assembled into a `StateDef` (only present fields carried over — `exactOptionalPropertyTypes`). `initial`/`reviewEntry`/`fixEntry` are NOT here — they never land on a `StateDef`; `compileState` compiles them separately into the raw entry-flag result `compileWorkflowConfig` collects across all states into `WorkflowDefinition.entries` (see `CompiledState`). */
interface StateParts {
  readonly actor: string | undefined
  readonly content: Partial<Record<ContentKey, string>>
  readonly on: readonly OnEdge[] | undefined
  readonly retry: RetryDef | undefined
  readonly model: string | undefined
  readonly memory: string | undefined
  readonly label: string | undefined
  readonly file: string | undefined
  readonly mode: StateMode | undefined
  readonly reviewWindow: true | undefined
  readonly reviewBase: true | undefined
  readonly requireProgress: true | undefined
  readonly answerGate: true | undefined
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
    retry: parts.retry,
    model: parts.model,
    memory: parts.memory,
    label: parts.label,
    file: parts.file,
    mode: parts.mode,
    reviewWindow: parts.reviewWindow,
    reviewBase: parts.reviewBase,
    requireProgress: parts.requireProgress,
    answerGate: parts.answerGate,
  }),
  ...assembleContentFields(parts.content),
})

/**
 * One state's full shape: actor, content, `on`, `retry`. Operates on a
 * QUALIFIED state entry from `FlattenedWorkflow.states` (`src/Machines.ts`) —
 * `$param`s already substituted, every `on`/`retry.otherwise` target already
 * an absolute qualified name — so this is exactly the flat compilation the
 * pre-`entry:`/`machines:` compiler already did. The entry-point flags
 * (`initial`/`reviewEntry`/`fixEntry`) are gone from this shape entirely: the
 * flattener resolves `entry.default`/`.review`/`.fix` directly into
 * `WorkflowDefinition.entries`, so there is nothing left for this function to
 * collect.
 */
const compileState = (
  name: string,
  raw: unknown,
  configDir: string,
  errors: string[],
  inlineFileRefs: boolean,
): StateDef => {
  if (!isPlainObject(raw)) {
    errors.push(`state "${name}": must be an object, got ${describeType(raw)}`)
    return {}
  }

  const unknownKeys = Object.keys(raw).filter((k) => !KNOWN_STATE_KEYS.has(k))
  if (unknownKeys.length > 0) {
    errors.push(
      `state "${name}": unknown key(s) ${formatUnknownKeys(unknownKeys, LEGACY_STATE_KEY_HINTS)}`,
    )
  }

  return assembleStateDef({
    actor: compileActor(raw, name, errors),
    content: compileContent(raw, name, configDir, errors, inlineFileRefs),
    on: compileOn(raw.on, name, errors),
    retry: compileRetry(raw.retry, name, errors),
    model: compileModel(raw, name, errors),
    memory: compileMemory(raw, name, errors),
    label: compileLabel(raw, name, errors),
    file: compileFile(raw, name, errors),
    mode: compileMode(raw, name, errors),
    reviewWindow: compileBooleanFlag(raw, "reviewWindow", name, errors),
    reviewBase: compileBooleanFlag(raw, "reviewBase", name, errors),
    requireProgress: compileBooleanFlag(raw, "requireProgress", name, errors),
    answerGate: compileBooleanFlag(raw, "answerGate", name, errors),
  })
}

// ── Top-level compile ────────────────────────────────────────────────────────

/**
 * Compile the raw, decoded `workflow:` YAML value into a `WorkflowDefinition`
 * plus the workflow's own compiled `vars:` map and its machine tree. `configDir`
 * is the config file's own directory, used to resolve `./`/`../` file
 * references. `rcModes` is the already-compiled top-level `.gtdrc` `modes:` key
 * (`src/Config.ts`), layered over the workflow's own `modes:` per half BEFORE
 * validation — so a state may name a mode either layer declares.
 * `inlineFileRefs` (default `true`) inlines content file references against
 * `configDir`; the real config path (`src/Config.ts`'s `loadMerged`) passes
 * `false` because it has already inlined every reference per declaring file
 * across the merge chain, so `configDir` is then irrelevant. Throws a single
 * `Error` (message: `"workflow config:\n  - ..."`, one line per finding) on ANY
 * config-shape problem or `validateDefinition` finding — never partially
 * succeeds.
 *
 * Three error-sequencing rules, in order:
 *
 * 1. `detectLegacyShape` short-circuits first — a stale pre-`entry:`/`machines:`
 *    config throws with ONLY the migration findings, never mixed with
 *    downstream noise.
 * 2. Unassemblable throws early: `flattenMachines`'s `entries` coming back
 *    `undefined` (no `entry.default`, no `machines`, an unresolvable root)
 *    means there is no definition for `validateDefinition` to add findings to
 *    — throw immediately with whatever findings exist so far.
 * 3. Otherwise the flattener's findings and `validateDefinition`'s findings
 *    merge into one de-duplicated, thrown error.
 */
export const compileWorkflowConfig = (
  raw: unknown,
  configDir: string,
  rcModes?: Readonly<Record<string, ModeDef>>,
  inlineFileRefs: boolean = true,
): CompiledWorkflowConfig => {
  if (!isPlainObject(raw)) {
    throw new Error(`workflow config: must be an object, got ${describeType(raw)}`)
  }

  detectLegacyShape(raw)

  const errors: string[] = []

  const unknownTopKeys = Object.keys(raw).filter((k) => !KNOWN_TOP_KEYS.has(k))
  if (unknownTopKeys.length > 0) {
    errors.push(`unknown top-level key(s) ${unknownTopKeys.join(", ")}`)
  }

  const vars = compileVarsMap(raw.vars, errors)
  const modes = mergeModes(compileModesMap(raw.modes, errors), rcModes)
  validateMachinesShape(raw.machines, errors)

  const flattened = flattenMachines(raw, errors)
  if (flattened.entries === undefined) {
    // Unassemblable: there is no per-state work to even attempt, so there is
    // nothing `validateDefinition` could add — throw with just the findings
    // collected so far.
    throw new Error(formatErrors(errors))
  }

  const states: Record<string, StateDef> = {}
  for (const [name, s] of Object.entries(flattened.states)) {
    states[name] = compileState(name, s, configDir, errors, inlineFileRefs)
  }

  // A definition can still be assembled (however messy) whenever the flattener
  // resolved `entries` — so run `validateDefinition` unconditionally and merge
  // its findings with the shape errors collected above into ONE thrown error,
  // rather than stopping at the first shape problem and hiding everything
  // `validateDefinition` would otherwise have caught (e.g. a bad content kind
  // in an unrelated state). De-duplicate identical messages (both passes can
  // independently notice the same problem).
  const definition: WorkflowDefinition =
    modes !== undefined
      ? { states, entries: flattened.entries, modes }
      : { states, entries: flattened.entries }
  const definitionErrors = validateDefinition(definition)
  const allErrors = Array.from(new Set([...errors, ...definitionErrors]))
  if (allErrors.length > 0) throw new Error(formatErrors(allErrors))

  // `flattened.tree` is `undefined` only when the root machine itself could not
  // be instantiated (`src/Machines.ts`'s `flattenMachines`) — which is exactly
  // the case already ruled out by the `entries === undefined` throw above,
  // since `entries` can only resolve once the root instantiated.
  return { definition, vars, tree: flattened.tree! }
}
