import { existsSync, readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import {
  STATE_DIR,
  validateDefinition,
  type ModeDef,
  type OnEdge,
  type RetryDef,
  type StateDef,
  type StateName,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import {
  CONTENT_FIELDS,
  MACHINE_FIELD_ENTRIES,
  STATE_FIELDS,
  STATE_FIELD_ENTRIES,
  type FieldKind,
} from "./StateFields.js"
import { flattenMachines, type InstancePath, type MachineNode } from "./Machines.js"
import { builtInModeNames, seededValidateCommand } from "./SteeringFormats.js"

// ── Small helpers ────────────────────────────────────────────────────────────

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const describeType = (v: unknown): string => {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

const isFileReference = (value: string): boolean =>
  value.startsWith("./") || value.startsWith("../")

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean"

/**
 * Compile a flat `name -> scalar` map — the `vars:` shape shared by a
 * workflow's own declared defaults and the top-level `.gtdrc` `vars:` key
 * (`src/Config.ts` imports this same function so both layers validate
 * identically). A malformed value pushes a load error onto `errors` and is
 * dropped; the well-formed keys still compile.
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
 * commands. Malformed entries push a load error and are dropped; the
 * semantic rules (at least one command per mode) belong to
 * `validateDefinition`. A command is never treated as a `./`-relative file
 * reference the way content strings are: `./scripts/check.sh` is a perfectly
 * good shell command.
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
 * Layer one `modes:` map over another, per half: an override's `format:`/
 * `validate:` wins, and a half it leaves out keeps the base's. This is how
 * the top-level `.gtdrc` `modes:` key plugs a formatter into a mode gtd
 * already validates without touching its validation.
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

const KNOWN_STATE_KEYS: ReadonlySet<string> = new Set(Object.keys(STATE_FIELDS))

const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set([
  "entry",
  "machines",
  "vars",
  "modes",
  "summary",
])
const KNOWN_MACHINE_KEYS: ReadonlySet<string> = new Set([
  "params",
  "entry",
  "states",
  ...MACHINE_FIELD_ENTRIES.map(([key]) => key),
])
const KNOWN_REF_KEYS: ReadonlySet<string> = new Set(["machine", "with"])

/** A state-level key removed by an earlier rewrite, naming its replacement so a stale config's error points somewhere useful. The `model` case is instead caught pre-flatten by `LEGACY_AUTHORED_STATE_KEY_HINTS`, since by the time a state reaches `compileState` its `model` may be a legitimately machine-stamped key. */
const LEGACY_STATE_KEY_HINTS: Readonly<Record<string, string>> = {
  initial: `"initial" no longer exists — declare this state's qualified path in the top-level "entry.default" instead`,
  reviewEntry: `"reviewEntry" no longer exists — declare "entry: true" on this state instead`,
  fixEntry: `"fixEntry" no longer exists — declare "entry: true" on this state instead`,
  memory: `"memory" no longer exists — a machine's memory scope is derived from its position in the tree and starts fresh on every entry`,
  commit: `"commit" no longer exists — the automatic squash finale was removed; a review sign-off lands an ordinary commit entering the workflow's initial state, and \`gtd summary\` prints a prompt for the process's own closing message instead`,
}

const LEGACY_REF_KEY_HINTS: Readonly<Record<string, string>> = {
  as: `"as" no longer exists — a reference's local name (the key itself) IS the concrete name; there is nothing left to rename`,
  name: `"name" no longer exists — a reference's local name (the key itself) names the instance`,
  set: `"set" no longer exists — bind extra per-instance values via "with:" instead`,
}

const formatUnknownKeys = (
  keys: readonly string[],
  hints: Readonly<Record<string, string>>,
): string => keys.map((k) => (hints[k] !== undefined ? `${k} (${hints[k]})` : k)).join(", ")

/**
 * A top-level key from the legacy flat `states:` shape, or the sub-machine
 * expander's `submachines:`/`use:`. Detected and thrown FIRST, before any
 * other validation, so a stale config produces only this migration table —
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
 * A top-level `entry.review`/`entry.fix` key from the pre-`entry: true`
 * shape. Detected and thrown right after `detectLegacyShape`, before
 * anything else runs, so a stale config gets only this message.
 */
const LEGACY_ENTRY_KEY_MESSAGES: Readonly<Record<string, string>> = {
  review: `entry.review is no longer supported — declare \`entry: true\` on that state and enter it with \`gtd --entry <state>\``,
  fix: `entry.fix is no longer supported — declare \`entry: true\` on that state and enter it with \`gtd --entry <state>\``,
}

const detectLegacyEntryKeys = (raw: Record<string, unknown>): void => {
  const entryRaw = raw["entry"]
  if (!isPlainObject(entryRaw)) return
  const found = Object.keys(LEGACY_ENTRY_KEY_MESSAGES).filter((k) => k in entryRaw)
  if (found.length === 0) return
  throw new Error(formatErrors(found.map((k) => LEGACY_ENTRY_KEY_MESSAGES[k]!)))
}

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

/**
 * A key an author may no longer put on a state, mapped to the hint naming its
 * replacement. Checked against the AUTHORED map, not the flattened one, since
 * by the flattened shape `src/Machines.ts` has already stamped these fields
 * onto their owning machine's `prompt` states.
 */
const LEGACY_AUTHORED_STATE_KEY_HINTS: Readonly<Record<string, (machineName: string) => string>> =
  Object.fromEntries(
    STATE_FIELD_ENTRIES.filter(([, spec]) => spec.authored === "machine").map(([key]) => [
      key,
      (machineName: string) =>
        `"${key}" is no longer a state key — declare it once on the machine that owns this state ("machines.${machineName}.${key}")`,
    ]),
  )

const validateMachineStateKeys = (
  machineName: string,
  machineRaw: Record<string, unknown>,
  errors: string[],
): void => {
  const statesRaw = machineRaw["states"]
  if (!isPlainObject(statesRaw)) return
  for (const [local, def] of Object.entries(statesRaw)) {
    if (!isPlainObject(def) || isRefRaw(def)) continue
    for (const [key, hint] of Object.entries(LEGACY_AUTHORED_STATE_KEY_HINTS)) {
      if (!(key in def)) continue
      errors.push(
        `machine "${machineName}": state "${local}": unknown key(s) ${key} (${hint(machineName)})`,
      )
    }
  }
}

/** Every machine-authored field: a non-empty string, else a load error naming the machine — the only place any of them may be authored (`validateMachineStateKeys` rejects the state-level form). */
const validateMachineFieldValues = (
  machineName: string,
  machineRaw: Record<string, unknown>,
  errors: string[],
): void => {
  for (const [key, spec] of MACHINE_FIELD_ENTRIES) {
    const value = machineRaw[key]
    if (value === undefined) continue
    if (spec.nonEmpty === true && (typeof value !== "string" || value === "")) {
      errors.push(`machines.${machineName}: "${key}" must be a non-empty string`)
    }
  }
}

/** Does `machineRaw` declare at least one of its own (non-reference) states with content kind `prompt`? A reference local's states belong to the child machine, never this one. */
const machineHasPromptState = (machineRaw: Record<string, unknown>): boolean => {
  const statesRaw = machineRaw["states"]
  if (!isPlainObject(statesRaw)) return false
  return Object.values(statesRaw).some(
    (def) => isPlainObject(def) && !isRefRaw(def) && typeof def["prompt"] === "string",
  )
}

/** A machine declaring a machine-authored field with no `prompt`-content state anywhere is a load error, not a silent no-op — the field would never land on any emitted state. */
const validateMachineFieldsTakeEffect = (
  machineName: string,
  machineRaw: Record<string, unknown>,
  errors: string[],
): void => {
  for (const [key] of MACHINE_FIELD_ENTRIES) {
    if (machineRaw[key] === undefined) continue
    if (!machineHasPromptState(machineRaw)) {
      errors.push(
        `machine "${machineName}": declares "${key}" but has no "prompt" state — this would never take effect`,
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
    validateMachineStateKeys(machineName, machineRaw, errors)
    validateMachineFieldValues(machineName, machineRaw, errors)
    validateMachineFieldsTakeEffect(machineName, machineRaw, errors)
  }
}

// ── Compilation result ───────────────────────────────────────────────────────

export interface CompiledWorkflowConfig {
  readonly definition: WorkflowDefinition
  /** The lowest-precedence layer of the merged `it.vars` (see `src/Edge.ts`'s `resolveVars`). `{}` when absent. */
  readonly vars: Record<string, string>
  /** The machine-instance tree built while compiling — a compilation output for tooling (`gtd visualize`), never part of the pure `WorkflowDefinition` the engine reads. */
  readonly tree: MachineNode
  /** Qualified state name -> the machine-instance path that owns it — the memory-scope lookup `src/Edge.ts` threads through. Asserted (below) to exactly match `definition.states`'s key set. */
  readonly scopes: Record<StateName, InstancePath>
  /** Non-fatal `validateDefinition` findings (e.g. a state with no `C` row) — never thrown on. */
  readonly warnings: readonly string[]
}

const formatErrors = (errors: readonly string[]): string =>
  `workflow config:\n${errors.map((e) => `  - ${e}`).join("\n")}`

// ── Content resolution (file-ref auto-inlining) ─────────────────────────────

/**
 * The filesystem seam behind `./`/`../` content file references
 * (`resolveContent`). `nodeFileRefReader` is the production adapter (real
 * `fs`); every threading function below defaults to it. `src/testing/`
 * injects a repo-backed reader instead, so an in-memory `.gtdrc`'s file
 * references resolve against the FAKE worktree rather than the real
 * filesystem.
 */
export interface FileRefReader {
  readonly exists: (path: string) => boolean
  readonly read: (path: string) => string
}

export const nodeFileRefReader: FileRefReader = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, "utf8"),
}

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
  fileRefs: FileRefReader = nodeFileRefReader,
): string | undefined => {
  if (!isFileReference(value)) return value
  const filePath = resolvePath(configDir, value)
  if (!fileRefs.exists(filePath)) {
    errors.push(`${where}: file reference "${value}" does not exist (resolved to "${filePath}")`)
    return undefined
  }
  try {
    return fileRefs.read(filePath)
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
 * Machine-authored fields whose `./`/`../` value is a file reference,
 * derived from `MACHINE_FIELD_ENTRIES` rather than hand-listed. Deliberately
 * NOT every machine-authored field: `model` is an opaque harness hint today,
 * and looping it here would turn `model: ./tiers/fast.txt` into a file read
 * — a load error for a value that used to work.
 */
const MACHINE_FILE_REF_FIELDS: readonly string[] = MACHINE_FIELD_ENTRIES.filter(
  ([, spec]) => spec.fileRef === true,
).map(([key]) => key)

const inlineStateFileRefs = (
  def: Record<string, unknown>,
  machineName: string,
  local: string,
  configDir: string,
  errors: string[],
  fileRefs: FileRefReader = nodeFileRefReader,
): Record<string, unknown> => {
  if (typeof def["machine"] === "string") return def
  const next: Record<string, unknown> = { ...def }
  for (const key of CONTENT_FIELDS) {
    const value = def[key]
    if (typeof value !== "string" || !isFileReference(value)) continue
    const resolved = resolveContent(
      value,
      configDir,
      `machine "${machineName}" state "${local}" (${key})`,
      errors,
      fileRefs,
    )
    if (resolved !== undefined) next[key] = resolved
  }
  return next
}

/**
 * Inline a machine's own file-reference fields plus every state's content
 * file references. The machine-level pass runs first and unconditionally —
 * only the states loop is gated on a well-formed `states:` — so a machine
 * with a malformed `states:` still gets its own `system:` reference resolved
 * rather than skipping inlining entirely.
 */
const inlineMachineFileRefs = (
  machineRaw: unknown,
  machineName: string,
  configDir: string,
  errors: string[],
  fileRefs: FileRefReader = nodeFileRefReader,
): unknown => {
  if (!isPlainObject(machineRaw)) return machineRaw
  const next: Record<string, unknown> = { ...machineRaw }
  for (const key of MACHINE_FILE_REF_FIELDS) {
    const value = machineRaw[key]
    if (typeof value !== "string" || !isFileReference(value)) continue
    const resolved = resolveContent(
      value,
      configDir,
      `machine "${machineName}" (${key})`,
      errors,
      fileRefs,
    )
    if (resolved !== undefined) next[key] = resolved
  }
  const rawStates = machineRaw["states"]
  if (isPlainObject(rawStates)) {
    const states: Record<string, unknown> = {}
    for (const [local, def] of Object.entries(rawStates)) {
      states[local] = isPlainObject(def)
        ? inlineStateFileRefs(def, machineName, local, configDir, errors, fileRefs)
        : def
    }
    next["states"] = states
  }
  return next
}

/**
 * Inline every `./`/`../` content file reference in one raw `workflow:`
 * value against `configDir` (the directory of the `.gtdrc` that declared it).
 * Used by `src/Config.ts`'s `loadMerged` to resolve each config level's
 * references against its OWN directory before the levels are deep-merged —
 * the merge collapses every level into one anonymous object, erasing which
 * file a given path came from, so resolving up front is the only way a
 * parent `.gtdrc`'s reference resolves against the parent, not a child
 * repo's cwd. `compileWorkflowConfig` then runs with `inlineFileRefs: false`
 * on the merged result.
 */
export const inlineWorkflowFileRefs = (
  rawWorkflow: unknown,
  configDir: string,
  errors: string[],
  fileRefs: FileRefReader = nodeFileRefReader,
): unknown => {
  if (!isPlainObject(rawWorkflow)) return rawWorkflow
  const next: Record<string, unknown> = { ...rawWorkflow }
  const rawSummary = rawWorkflow["summary"]
  if (typeof rawSummary === "string" && isFileReference(rawSummary)) {
    const resolved = resolveContent(rawSummary, configDir, `"summary"`, errors, fileRefs)
    if (resolved !== undefined) next["summary"] = resolved
  }
  const rawMachines = rawWorkflow["machines"]
  if (!isPlainObject(rawMachines)) return next
  const machines: Record<string, unknown> = {}
  for (const [machineName, machineRaw] of Object.entries(rawMachines)) {
    machines[machineName] = inlineMachineFileRefs(
      machineRaw,
      machineName,
      configDir,
      errors,
      fileRefs,
    )
  }
  return { ...next, machines }
}

// ── Per-state field compilers ────────────────────────────────────────────────

const KNOWN_EDGE_KEYS: ReadonlySet<string> = new Set(["to", "describe", "action"])

/** A missing/malformed field's failure sentinel, distinct from a legitimate `undefined` value. */
const INVALID = Symbol("invalid edge field")

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
  // placeholder in slot 3, since `OnEdge` is a positional tuple).
  if (actionField !== undefined) return [pattern, to, describeField, actionField]
  return describeField !== undefined ? [pattern, to, describeField] : [pattern, to]
}

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

const compileText = (
  raw: Record<string, unknown>,
  key: string,
  name: string,
  errors: string[],
): string | undefined => {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    errors.push(`state "${name}": "${key}" must be a string`)
    return undefined
  }
  return value
}

/**
 * `file:` — prepended under `STATE_DIR` after rejecting (never rewriting) a
 * `..` segment, a leading `/`, or an already-declared `STATE_DIR` prefix (the
 * last would otherwise silently double up into `.gtd/.gtd/...`). A blank
 * value is left alone, unprepended, so the field's own `nonEmpty` rule still
 * catches it rather than hiding behind a non-empty `"${STATE_DIR}/"` string.
 *
 * A templated `file:` (e.g. `file: <%= it.vars.x %>`) is checked against its
 * SOURCE, not its rendered form — a var supplying `../REVIEW.md` at runtime
 * passes every one of these checks and renders outside `.gtd/` at the edge.
 * Accepted, not guarded.
 */
const compileStateFile = (
  raw: Record<string, unknown>,
  key: string,
  name: string,
  ctx: CompileCtx,
): string | undefined => {
  const value = compileText(raw, key, name, ctx.errors)
  if (value === undefined || value === "") return value
  if (value.split("/").includes("..")) {
    ctx.errors.push(`state "${name}": "${key}" must not contain a ".." segment (got "${value}")`)
    return undefined
  }
  if (value.startsWith("/")) {
    ctx.errors.push(
      `state "${name}": "${key}" must not be an absolute path (a leading "/") (got "${value}")`,
    )
    return undefined
  }
  if (value === STATE_DIR || value.startsWith(`${STATE_DIR}/`)) {
    ctx.errors.push(
      `state "${name}": "${key}" is resolved under "${STATE_DIR}/" automatically — drop the "${STATE_DIR}/" prefix (got "${value}")`,
    )
    return undefined
  }
  return `${STATE_DIR}/${value}`
}

/**
 * A boolean state flag: `true` only for the literal `true`; a non-boolean is
 * a config error; `false` (or absent) compiles away to `undefined`, since
 * `false` and "unset" mean the same thing for every such flag. `reviewBase`
 * goes through `compileBooleanOrTemplateFlag` instead.
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

const compileBooleanOrTemplateFlag = (
  raw: Record<string, unknown>,
  key: string,
  name: string,
  errors: string[],
): true | string | undefined => {
  const value = raw[key]
  if (value === undefined) return undefined
  if (value === true) return true
  if (typeof value === "string" && value.trim() !== "") return value
  errors.push(`state "${name}": "${key}" must be a boolean or a non-blank string`)
  return undefined
}

/**
 * One content field: a string, file-refs auto-inlined. `ctx.inlineFileRefs`
 * is `false` only when the caller (`src/Config.ts`'s `loadMerged`) has
 * already inlined every reference per declaring file, so the content is then
 * taken verbatim — a `script:` whose inlined text happens to begin with `./`
 * is never mistaken for a second file reference. The "exactly one content
 * kind" rule is the engine's `validateDefinition` concern, not this one's.
 */
const compileContentRef = (
  raw: Record<string, unknown>,
  key: string,
  name: string,
  ctx: CompileCtx,
): string | undefined => {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    ctx.errors.push(`state "${name}": "${key}" must be a string`)
    return undefined
  }
  if (!ctx.inlineFileRefs) return value
  return resolveContent(value, ctx.configDir, `state "${name}" (${key})`, ctx.errors, ctx.fileRefs)
}

interface CompileCtx {
  readonly errors: string[]
  readonly configDir: string
  readonly inlineFileRefs: boolean
  /** How a `./file` content reference is read — injected so the compiler has no hard `node:fs` dependency (see `FileRefReader`). */
  readonly fileRefs: FileRefReader
}

type FieldCompiler = (
  raw: Record<string, unknown>,
  key: string,
  name: string,
  ctx: CompileCtx,
) => unknown

/**
 * One compiler per `FieldKind` — the exhaustiveness guard for the field
 * table: a new `FieldKind` fails to compile here (and in `ConfigSchema.ts`'s
 * `JSON_TYPE`) until it's given a compiler.
 */
const COMPILE: Record<FieldKind, FieldCompiler> = {
  actor: (raw, key, name, ctx) => compileText(raw, key, name, ctx.errors),
  text: (raw, key, name, ctx) => compileText(raw, key, name, ctx.errors),
  stateFile: compileStateFile,
  mode: (raw, key, name, ctx) => compileText(raw, key, name, ctx.errors),
  content: compileContentRef,
  flag: (raw, key, name, ctx) => compileBooleanFlag(raw, key, name, ctx.errors),
  flagOrTemplate: (raw, key, name, ctx) => compileBooleanOrTemplateFlag(raw, key, name, ctx.errors),
  edges: (raw, key, name, ctx) => compileOn(raw[key], name, ctx.errors),
  retry: (raw, key, name, ctx) => compileRetry(raw[key], name, ctx.errors),
}

/**
 * `entry` (`surface: "authoring-only"`) is excluded here — `COMPILE` still
 * validates its shape, but `compileWorkflowConfig` reads the raw `entry:
 * true` flag directly off each qualified state to build `WorkflowEntries.manual`
 * instead.
 */
const assembleStateDef = (compiled: Record<string, unknown>): StateDef => {
  const def: Record<string, unknown> = {}
  for (const [key, spec] of STATE_FIELD_ENTRIES) {
    if (spec.surface !== "def") continue
    const value = compiled[key]
    if (value !== undefined) def[key] = value
  }
  return def as StateDef
}

/**
 * One state's full shape: every `STATE_FIELDS` entry, compiled through
 * `COMPILE`'s per-kind dispatch. Operates on a QUALIFIED state entry from
 * `FlattenedWorkflow.states` — `$param`s already substituted, every
 * `on`/`retry.otherwise` target already an absolute qualified name.
 */
const compileState = (
  name: string,
  raw: unknown,
  configDir: string,
  errors: string[],
  inlineFileRefs: boolean,
  fileRefs: FileRefReader = nodeFileRefReader,
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

  const ctx: CompileCtx = { errors, configDir, inlineFileRefs, fileRefs }
  const compiled: Record<string, unknown> = {}
  for (const [key, spec] of STATE_FIELD_ENTRIES) {
    compiled[key] = COMPILE[spec.kind](raw, key, name, ctx)
  }

  return assembleStateDef(compiled)
}

/**
 * Compiler invariant, not a workflow-author finding: `flattenMachines`
 * promises a `scopes` entry for every state it emits — a mismatch here means
 * the flattener itself missed a state, which must fail loudly rather than
 * silently produce a memory key that reads as "outside every scope". Exported
 * so this invariant is directly testable against a contrived `scopes` map.
 */
export const assertScopesCoverStates = (
  stateNames: readonly string[],
  scopes: Readonly<Record<string, InstancePath>>,
  errors: string[],
): void => {
  for (const name of stateNames) {
    if (!(name in scopes)) {
      errors.push(`internal error: scopes map produced by the flattener is missing state "${name}"`)
    }
  }
}

/**
 * Compile the top-level `summary:` template — the `gtd summary` prompt. An
 * absent value is legal (`gtd summary` refuses at runtime instead); a
 * present-but-blank value (or a blank inlined file) is a load error, the same
 * rule a mode's `format:`/`validate:` follows. File-ref inlining mirrors
 * `compileContentRef`'s `ctx.inlineFileRefs` discipline.
 */
const compileSummary = (
  raw: Record<string, unknown>,
  configDir: string,
  errors: string[],
  inlineFileRefs: boolean,
  fileRefs: FileRefReader,
): string | undefined => {
  const value = raw["summary"]
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    errors.push(`"summary" must be a string`)
    return undefined
  }
  const resolved = inlineFileRefs
    ? resolveContent(value, configDir, `"summary"`, errors, fileRefs)
    : value
  if (resolved !== undefined && resolved.trim() === "") {
    errors.push(`"summary" must not be blank`)
    return undefined
  }
  return resolved
}

// ── Top-level compile ────────────────────────────────────────────────────────

/**
 * Compile the raw, decoded `workflow:` YAML value into a `WorkflowDefinition`
 * plus the workflow's own compiled `vars:` map and its machine tree.
 * `rcModes` (the already-compiled top-level `.gtdrc` `modes:` key) is layered
 * over the workflow's own `modes:` per half before validation. `inlineFileRefs`
 * defaults to `true`; `src/Config.ts`'s `loadMerged` passes `false` because it
 * has already inlined every reference per declaring file across the merge
 * chain. Throws one `Error` (one line per finding) on any config-shape
 * problem or `validateDefinition` finding — never partially succeeds.
 */
export const compileWorkflowConfig = (
  raw: unknown,
  configDir: string,
  rcModes?: Readonly<Record<string, ModeDef>>,
  inlineFileRefs: boolean = true,
  fileRefs: FileRefReader = nodeFileRefReader,
): CompiledWorkflowConfig => {
  if (!isPlainObject(raw)) {
    throw new Error(`workflow config: must be an object, got ${describeType(raw)}`)
  }

  detectLegacyShape(raw)
  detectLegacyEntryKeys(raw)

  const errors: string[] = []

  const unknownTopKeys = Object.keys(raw).filter((k) => !KNOWN_TOP_KEYS.has(k))
  if (unknownTopKeys.length > 0) {
    errors.push(`unknown top-level key(s) ${unknownTopKeys.join(", ")}`)
  }

  const vars = compileVarsMap(raw.vars, errors)
  const seeded = Object.fromEntries(
    builtInModeNames().map((name) => [name, { validate: seededValidateCommand(name) }]),
  )
  // `mergeModes` is `undefined` only when both arguments are; `seeded` never is.
  const modes = mergeModes(mergeModes(seeded, compileModesMap(raw.modes, errors)), rcModes)!
  validateMachinesShape(raw.machines, errors)

  const flattened = flattenMachines(raw, errors)
  if (flattened.entries === undefined) {
    // Unassemblable: there is no per-state work to even attempt, so there is
    // nothing `validateDefinition` could add — throw with just the findings
    // collected so far.
    throw new Error(formatErrors(errors))
  }

  const states: Record<string, StateDef> = {}
  const manualSet = new Set<string>()
  for (const [name, s] of Object.entries(flattened.states)) {
    states[name] = compileState(name, s, configDir, errors, inlineFileRefs, fileRefs)
    // A state's own `entry: true` is authoring-only — collected off the raw
    // (pre-compile) value into a sorted, deduped `entries.manual`.
    if (isPlainObject(s) && s["entry"] === true) manualSet.add(name)
  }
  const manual = Array.from(manualSet).sort()

  // Run validateDefinition unconditionally and merge its findings with the
  // shape errors above into one error, rather than stopping at the first
  // shape problem and hiding what validateDefinition would otherwise catch.
  const summary = compileSummary(raw, configDir, errors, inlineFileRefs, fileRefs)

  const entries = { default: flattened.entries.default, manual }
  const definition: WorkflowDefinition = {
    states,
    entries,
    modes,
    ...(summary !== undefined ? { summary } : {}),
  }

  assertScopesCoverStates(Object.keys(states), flattened.scopes, errors)

  const definitionResult = validateDefinition(definition)
  const allErrors = Array.from(new Set([...errors, ...definitionResult.errors]))
  if (allErrors.length > 0) throw new Error(formatErrors(allErrors))

  // `flattened.tree` is undefined only when the root machine failed to
  // instantiate — already ruled out by the `entries === undefined` throw above.
  return {
    definition,
    vars,
    tree: flattened.tree!,
    scopes: flattened.scopes,
    warnings: definitionResult.warnings,
  }
}
