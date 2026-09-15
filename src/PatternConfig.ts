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
import { seededValidateCommand } from "./SteeringFormats.js"
import { builtInModeNames } from "./steering/index.js"
import type { Diagnostic } from "./workflow/index.js"

/** A finding's `origin` is unknown at this compile-phase level — the `src/workflow/` boundary that assembles config layers fills it in. */
const UNKNOWN_ORIGIN = ""

const err = (path: readonly (string | number)[], message: string): Diagnostic => ({
  severity: "error",
  message,
  path,
  origin: UNKNOWN_ORIGIN,
})

const warn = (path: readonly (string | number)[], message: string): Diagnostic => ({
  severity: "warning",
  message,
  path,
  origin: UNKNOWN_ORIGIN,
})

const machinePath = (machineName: string): readonly (string | number)[] => ["machines", machineName]

const statePath = (machineName: string, local: string): readonly (string | number)[] => [
  ...machinePath(machineName),
  "states",
  local,
]

/**
 * Qualified state name -> the LOCAL name it was declared under, on the
 * machine `flattened.tree` (below) already names — `["machines", machine,
 * "states", local]`, the actual authoring path in the user's `.gtdrc`, not
 * the flattened `states.<qualified>` namespace the engine itself uses.
 * `scopes[qualified]` is the owning instance's path prefix (possibly `""`
 * for the root); stripping it (plus its separating `.`) off `qualified`
 * leaves exactly the local name that instance's machine declared.
 */
const authoringPath = (
  qualifiedName: string,
  machineByState: ReadonlyMap<string, string>,
  scopes: Readonly<Record<string, InstancePath>>,
): readonly (string | number)[] => {
  const machineName = machineByState.get(qualifiedName)
  const scope = scopes[qualifiedName]
  if (machineName === undefined || scope === undefined) return ["states", qualifiedName]
  const local = scope === "" ? qualifiedName : qualifiedName.slice(scope.length + 1)
  return statePath(machineName, local)
}

/** Every qualified state name -> the machine it was instantiated from — walks `flattened.tree` (`MachineNode.states` are already qualified names owned directly by that instance). */
const machineNamesByState = (tree: MachineNode | undefined): ReadonlyMap<string, string> => {
  const map = new Map<string, string>()
  const walk = (node: MachineNode): void => {
    for (const state of node.states) map.set(state, node.machine)
    for (const child of node.children) walk(child)
  }
  if (tree !== undefined) walk(tree)
  return map
}

/**
 * `src/PatternMachine.ts`'s `validateDefinition` is out of this package's
 * scope (see the package's `## Paths`) and still returns plain prose — this
 * extracts a best-effort structured path from its message text (a `state
 * "X"`/`mode "X"` mention) rather than leaving the finding path-less. A
 * mentioned state resolves through `authoringPath` — same real
 * `machines.<machine>.states.<local>` path `compileState`'s own findings
 * use, not the flattened `states.<qualified>` namespace — falling back to
 * the flattened name only when the mentioned state is unknown to the
 * flattener (shouldn't happen, but a regex scrape over prose has no
 * stronger guarantee).
 */
const bestEffortPath = (
  message: string,
  machineByState: ReadonlyMap<string, string>,
  scopes: Readonly<Record<string, InstancePath>>,
): readonly (string | number)[] => {
  const stateMatch = /state "([^"]+)"/.exec(message)
  if (stateMatch) return authoringPath(stateMatch[1]!, machineByState, scopes)
  const modeMatch = /mode "([^"]+)"/.exec(message)
  if (modeMatch) return ["modes", modeMatch[1]!]
  return []
}

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
 * (`src/workflow/compile.ts` calls this same function for both layers, so
 * they validate identically). A malformed value pushes a load error and is
 * dropped; the well-formed keys still compile.
 */
export const compileVarsMap = (
  raw: unknown,
): { readonly vars: Record<string, string>; readonly diagnostics: readonly Diagnostic[] } => {
  const diagnostics: Diagnostic[] = []
  if (raw === undefined) return { vars: {}, diagnostics }
  if (!isPlainObject(raw)) {
    diagnostics.push(
      err(["vars"], `"vars" must be a mapping of name -> scalar value, got ${describeType(raw)}`),
    )
    return { vars: {}, diagnostics }
  }
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isScalar(value)) {
      diagnostics.push(
        err(
          ["vars", key],
          `"vars.${key}" must be a string, number, or boolean, got ${describeType(value)}`,
        ),
      )
      continue
    }
    vars[key] = String(value)
  }
  return { vars, diagnostics }
}

const MODE_COMMAND_KEYS = ["format", "validate"] as const

/**
 * Compile the `modes:` map — mode name -> `{ format?, validate? }` shell
 * commands. Malformed entries push a load error and are dropped; the
 * semantic rules (at least one command per mode) belong to
 * `validateDefinition`. A command is never treated as a `./`-relative file
 * reference the way content strings are: `./scripts/check.sh` is a perfectly
 * good shell command. Exported because `src/workflow/compile.ts` calls this
 * for both the top-level `.gtdrc` `modes:` layer and the workflow's own — not
 * exported-for-testability (there is no non-test caller-free export left in
 * this file; `compileState`'s old non-object guard and
 * `assertScopesCoverStates` were the ones that were, and both are gone).
 */
export const compileModesMap = (
  raw: unknown,
): {
  readonly modes: Record<string, ModeDef> | undefined
  readonly diagnostics: readonly Diagnostic[]
} => {
  const diagnostics: Diagnostic[] = []
  if (raw === undefined) return { modes: undefined, diagnostics }
  if (!isPlainObject(raw)) {
    diagnostics.push(
      err(
        ["modes"],
        `"modes" must be a mapping of mode name -> { format, validate }, got ${describeType(raw)}`,
      ),
    )
    return { modes: undefined, diagnostics }
  }
  const modes: Record<string, ModeDef> = {}
  for (const [name, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      diagnostics.push(
        err(
          ["modes", name],
          `mode "${name}": must be an object with "format" and/or "validate", got ${describeType(entry)}`,
        ),
      )
      continue
    }
    const unknownKeys = Object.keys(entry).filter(
      (k) => !(MODE_COMMAND_KEYS as readonly string[]).includes(k),
    )
    if (unknownKeys.length > 0) {
      diagnostics.push(
        err(["modes", name], `mode "${name}": unknown key(s) ${unknownKeys.join(", ")}`),
      )
    }
    const commands: { format?: string; validate?: string } = {}
    for (const key of MODE_COMMAND_KEYS) {
      const command = entry[key]
      if (command === undefined) continue
      if (typeof command !== "string") {
        diagnostics.push(
          err(["modes", name, key], `mode "${name}": "${key}" must be a shell command (string)`),
        )
        continue
      }
      commands[key] = command
    }
    modes[name] = commands
  }
  return { modes, diagnostics }
}

/**
 * Layer one `modes:` map over another, per half: an override's `format:`/
 * `validate:` wins, and a half it leaves out keeps the base's. This is how
 * the top-level `.gtdrc` `modes:` key plugs a formatter into a mode gtd
 * already validates without touching its validation. Exported because
 * `src/workflow/compile.ts` calls it directly (layering the top-level
 * `.gtdrc` `modes:` over the workflow's own, and again over the seeded
 * built-in mode commands) — a real production caller, not a test seam.
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

const detectLegacyShape = (raw: Record<string, unknown>): readonly Diagnostic[] => {
  const found = Object.keys(LEGACY_TOP_KEY_MESSAGES).filter((k) => k in raw)
  return found.map((k) => err([k], LEGACY_TOP_KEY_MESSAGES[k]!))
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

const detectLegacyEntryKeys = (raw: Record<string, unknown>): readonly Diagnostic[] => {
  const entryRaw = raw["entry"]
  if (!isPlainObject(entryRaw)) return []
  const found = Object.keys(LEGACY_ENTRY_KEY_MESSAGES).filter((k) => k in entryRaw)
  return found.map((k) => err(["entry", k], LEGACY_ENTRY_KEY_MESSAGES[k]!))
}

const validateMachineRefs = (
  machineName: string,
  machineRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): void => {
  const statesRaw = machineRaw["states"]
  if (!isPlainObject(statesRaw)) return
  for (const [local, def] of Object.entries(statesRaw)) {
    if (!isRefRaw(def)) continue
    const unknownRefKeys = Object.keys(def).filter((k) => !KNOWN_REF_KEYS.has(k))
    if (unknownRefKeys.length > 0) {
      diagnostics.push(
        err(
          statePath(machineName, local),
          `machine "${machineName}": reference "${local}": unknown key(s) ${formatUnknownKeys(unknownRefKeys, LEGACY_REF_KEY_HINTS)}`,
        ),
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
  diagnostics: Diagnostic[],
): void => {
  const statesRaw = machineRaw["states"]
  if (!isPlainObject(statesRaw)) return
  for (const [local, def] of Object.entries(statesRaw)) {
    if (!isPlainObject(def) || isRefRaw(def)) continue
    for (const [key, hint] of Object.entries(LEGACY_AUTHORED_STATE_KEY_HINTS)) {
      if (!(key in def)) continue
      diagnostics.push(
        err(
          statePath(machineName, local),
          `machine "${machineName}": state "${local}": unknown key(s) ${key} (${hint(machineName)})`,
        ),
      )
    }
  }
}

/** Every machine-authored field: a non-empty string, else a load error naming the machine — the only place any of them may be authored (`validateMachineStateKeys` rejects the state-level form). */
const validateMachineFieldValues = (
  machineName: string,
  machineRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): void => {
  for (const [key, spec] of MACHINE_FIELD_ENTRIES) {
    const value = machineRaw[key]
    if (value === undefined) continue
    if (spec.nonEmpty === true && (typeof value !== "string" || value === "")) {
      diagnostics.push(
        err(
          [...machinePath(machineName), key],
          `machines.${machineName}: "${key}" must be a non-empty string`,
        ),
      )
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
  diagnostics: Diagnostic[],
): void => {
  for (const [key] of MACHINE_FIELD_ENTRIES) {
    if (machineRaw[key] === undefined) continue
    if (!machineHasPromptState(machineRaw)) {
      diagnostics.push(
        err(
          [...machinePath(machineName), key],
          `machine "${machineName}": declares "${key}" but has no "prompt" state — this would never take effect`,
        ),
      )
    }
  }
}

/**
 * `params:` (advisory-only documentation of which `$name`s a reference's
 * `with:` may bind) is still an authored array — malformed entries are a
 * load error like any other, each pointing at its own index
 * (`machines.<name>.params.<i>`), the one place this compiler's config path
 * is genuinely array-shaped rather than object-keyed.
 */
const validateMachineParams = (
  machineName: string,
  machineRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): void => {
  const params = machineRaw["params"]
  if (params === undefined) return
  const path = [...machinePath(machineName), "params"]
  if (!Array.isArray(params)) {
    diagnostics.push(
      err(
        path,
        `machine "${machineName}": "params" must be an array of strings, got ${describeType(params)}`,
      ),
    )
    return
  }
  params.forEach((entry, i) => {
    if (typeof entry !== "string") {
      diagnostics.push(
        err(
          [...path, i],
          `machine "${machineName}": "params.${i}" must be a string, got ${describeType(entry)}`,
        ),
      )
    }
  })
}

const validateMachinesShape = (raw: unknown): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = []
  if (raw === undefined) return diagnostics
  if (!isPlainObject(raw)) {
    diagnostics.push(
      err(
        ["machines"],
        `"machines" must be a mapping of machine name -> { params?, entry, states }, got ${describeType(raw)}`,
      ),
    )
    return diagnostics
  }
  for (const [machineName, machineRaw] of Object.entries(raw)) {
    if (!isPlainObject(machineRaw)) continue
    const unknownMachineKeys = Object.keys(machineRaw).filter((k) => !KNOWN_MACHINE_KEYS.has(k))
    if (unknownMachineKeys.length > 0) {
      diagnostics.push(
        err(
          machinePath(machineName),
          `machine "${machineName}": unknown key(s) ${unknownMachineKeys.join(", ")}`,
        ),
      )
    }
    validateMachineRefs(machineName, machineRaw, diagnostics)
    validateMachineStateKeys(machineName, machineRaw, diagnostics)
    validateMachineFieldValues(machineName, machineRaw, diagnostics)
    validateMachineFieldsTakeEffect(machineName, machineRaw, diagnostics)
    validateMachineParams(machineName, machineRaw, diagnostics)
  }
  return diagnostics
}

// ── Compilation result ───────────────────────────────────────────────────────

export interface CompiledWorkflowConfig {
  readonly definition: WorkflowDefinition
  /** The lowest-precedence layer of the merged `it.vars` (see `src/Edge.ts`'s `resolveVars`). `{}` when absent. */
  readonly vars: Record<string, string>
  /** The machine-instance tree built while compiling, or `undefined` when the root machine itself could not be instantiated (`diagnostics` then carries at least one error). A compilation output for tooling (`gtd visualize`), never part of the pure `WorkflowDefinition` the engine reads. */
  readonly tree: MachineNode | undefined
  /** Qualified state name -> the machine-instance path that owns it — the memory-scope lookup `src/Edge.ts` threads through. */
  readonly scopes: Record<StateName, InstancePath>
  /**
   * Every finding from every phase, `origin` unset (`""`) — the `src/workflow/`
   * boundary that merges config layers fills it in. Never thrown on: an
   * `"error"`-severity entry means the caller must not use `definition`, but
   * `compileWorkflowConfig` itself always returns a (possibly empty/partial)
   * result rather than throwing.
   */
  readonly diagnostics: readonly Diagnostic[]
}

// ── Content resolution (file-ref auto-inlining) ─────────────────────────────

/**
 * The synchronous read behind `./`/`../` content file references
 * (`resolveContent`) — this compiler is plain, non-Effect code (it cannot
 * `yield*`), so per the seam rule (`src/platform/index.ts`) it takes a SYNC
 * function rather than injecting `Workspace` as a tag. Required, not
 * defaulted: the one real caller, `src/workflow/compile.ts`, always injects
 * `WorkflowFiles.read` (built over `Workspace`, so an in-memory `@inmem`
 * `.gtdrc`'s file references resolve against the FAKE worktree, a real one
 * against real disk) — a built-in real-`fs` default here would be a second,
 * silent way to reach the filesystem that bypasses that port entirely if a
 * future caller forgot to pass one.
 */
export type ReadFile = (path: string) => string | undefined

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
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
  readFile: ReadFile,
): string | undefined => {
  if (!isFileReference(value)) return value
  const filePath = resolvePath(configDir, value)
  try {
    const content = readFile(filePath)
    if (content === undefined) {
      diagnostics.push(
        err(path, `${where}: file reference "${value}" does not exist (resolved to "${filePath}")`),
      )
      return undefined
    }
    return content
  } catch (e) {
    diagnostics.push(
      err(
        path,
        `${where}: file reference "${value}" could not be read: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
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
  diagnostics: Diagnostic[],
  readFile: ReadFile,
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
      [...statePath(machineName, local), key],
      diagnostics,
      readFile,
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
  diagnostics: Diagnostic[],
  readFile: ReadFile,
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
      [...machinePath(machineName), key],
      diagnostics,
      readFile,
    )
    if (resolved !== undefined) next[key] = resolved
  }
  const rawStates = machineRaw["states"]
  if (isPlainObject(rawStates)) {
    const states: Record<string, unknown> = {}
    for (const [local, def] of Object.entries(rawStates)) {
      states[local] = isPlainObject(def)
        ? inlineStateFileRefs(def, machineName, local, configDir, diagnostics, readFile)
        : def
    }
    next["states"] = states
  }
  return next
}

/**
 * Inline every `./`/`../` content file reference in one raw `workflow:`
 * value against `configDir` (the directory of the `.gtdrc` that declared it).
 * Used by `src/workflow/compile.ts`'s `compileWorkflow` to resolve each
 * config layer's references against its OWN directory before the layers are
 * deep-merged — the merge collapses every layer into one anonymous object,
 * erasing which file a given path came from, so resolving up front is the
 * only way a parent `.gtdrc`'s reference resolves against the parent, not a
 * child repo's cwd. `compileWorkflowConfig` never inlines file refs itself —
 * it always runs on an already-inlined `workflow:` value.
 */
export const inlineWorkflowFileRefs = (
  rawWorkflow: unknown,
  configDir: string,
  readFile: ReadFile,
): { readonly value: unknown; readonly diagnostics: readonly Diagnostic[] } => {
  const diagnostics: Diagnostic[] = []
  if (!isPlainObject(rawWorkflow)) return { value: rawWorkflow, diagnostics }
  const next: Record<string, unknown> = { ...rawWorkflow }
  const rawSummary = rawWorkflow["summary"]
  if (typeof rawSummary === "string" && isFileReference(rawSummary)) {
    const resolved = resolveContent(
      rawSummary,
      configDir,
      `"summary"`,
      ["summary"],
      diagnostics,
      readFile,
    )
    if (resolved !== undefined) next["summary"] = resolved
  }
  const rawMachines = rawWorkflow["machines"]
  if (!isPlainObject(rawMachines)) return { value: next, diagnostics }
  const machines: Record<string, unknown> = {}
  for (const [machineName, machineRaw] of Object.entries(rawMachines)) {
    machines[machineName] = inlineMachineFileRefs(
      machineRaw,
      machineName,
      configDir,
      diagnostics,
      readFile,
    )
  }
  return { value: { ...next, machines }, diagnostics }
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
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
): string | undefined | typeof INVALID => {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    diagnostics.push(err(path, `state "${name}": "on.${pattern}.${field}" must be a string`))
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
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
): OnEdge | undefined => {
  if (typeof value === "string") return [pattern, value]
  if (!isPlainObject(value)) {
    diagnostics.push(
      err(
        path,
        `state "${name}": "on" entry for pattern "${pattern}" must be a target state name (string) or a { to, describe } object`,
      ),
    )
    return undefined
  }
  const unknownKeys = Object.keys(value).filter((k) => !KNOWN_EDGE_KEYS.has(k))
  if (unknownKeys.length > 0) {
    diagnostics.push(
      err(
        path,
        `state "${name}": "on" entry for pattern "${pattern}" has unknown key(s) ${unknownKeys.join(", ")}`,
      ),
    )
  }
  const { to, describe, action } = value
  if (typeof to !== "string") {
    diagnostics.push(
      err(path, `state "${name}": "on.${pattern}.to" must be a target state name (string)`),
    )
    return undefined
  }
  const describeField = compileOptionalEdgeField(
    describe,
    pattern,
    name,
    "describe",
    path,
    diagnostics,
  )
  if (describeField === INVALID) return undefined
  const actionField = compileOptionalEdgeField(action, pattern, name, "action", path, diagnostics)
  if (actionField === INVALID) return undefined
  // `describe` may be `undefined` here even though `action` is set (an edge
  // wanting an `action` but no `describe` passes an explicit `undefined`
  // placeholder in slot 3, since `OnEdge` is a positional tuple).
  if (actionField !== undefined) return [pattern, to, describeField, actionField]
  return describeField !== undefined ? [pattern, to, describeField] : [pattern, to]
}

const compileOn = (
  raw: unknown,
  name: string,
  statePath: readonly (string | number)[],
  diagnostics: Diagnostic[],
): readonly OnEdge[] | undefined => {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    diagnostics.push(
      err(
        [...statePath, "on"],
        `state "${name}": "on" must be a mapping of pattern -> target state`,
      ),
    )
    return undefined
  }
  const edges: OnEdge[] = []
  for (const [pattern, value] of Object.entries(raw)) {
    const edge = compileOnEdge(pattern, value, name, [...statePath, "on", pattern], diagnostics)
    if (edge !== undefined) edges.push(edge)
  }
  return edges
}

const compileRetry = (
  raw: unknown,
  name: string,
  statePath: readonly (string | number)[],
  diagnostics: Diagnostic[],
): RetryDef | undefined => {
  if (raw === undefined) return undefined
  const path = [...statePath, "retry"]
  if (!isPlainObject(raw)) {
    diagnostics.push(
      err(path, `state "${name}": "retry" must be an object with "max" and "otherwise"`),
    )
    return undefined
  }
  const unknownKeys = Object.keys(raw).filter((k) => k !== "max" && k !== "otherwise")
  if (unknownKeys.length > 0) {
    diagnostics.push(
      err(path, `state "${name}": "retry" has unknown key(s) ${unknownKeys.join(", ")}`),
    )
  }
  const { max, otherwise } = raw
  const maxOk = typeof max === "number"
  const otherwiseOk = typeof otherwise === "string"
  if (!maxOk)
    diagnostics.push(err([...path, "max"], `state "${name}": "retry.max" must be a number`))
  if (!otherwiseOk) {
    diagnostics.push(
      err([...path, "otherwise"], `state "${name}": "retry.otherwise" must be a string`),
    )
  }
  return maxOk && otherwiseOk ? { max, otherwise } : undefined
}

const compileText = (
  raw: Record<string, unknown>,
  key: string,
  name: string,
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
): string | undefined => {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    diagnostics.push(err(path, `state "${name}": "${key}" must be a string`))
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
  const value = compileText(raw, key, name, ctx.path, ctx.diagnostics)
  if (value === undefined || value === "") return value
  if (value.split("/").includes("..")) {
    ctx.diagnostics.push(
      err(ctx.path, `state "${name}": "${key}" must not contain a ".." segment (got "${value}")`),
    )
    return undefined
  }
  if (value.startsWith("/")) {
    ctx.diagnostics.push(
      err(
        ctx.path,
        `state "${name}": "${key}" must not be an absolute path (a leading "/") (got "${value}")`,
      ),
    )
    return undefined
  }
  if (value === STATE_DIR || value.startsWith(`${STATE_DIR}/`)) {
    ctx.diagnostics.push(
      err(
        ctx.path,
        `state "${name}": "${key}" is resolved under "${STATE_DIR}/" automatically — drop the "${STATE_DIR}/" prefix (got "${value}")`,
      ),
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
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
): true | undefined => {
  const value = raw[key]
  if (value === undefined) return undefined
  if (value !== true && value !== false) {
    diagnostics.push(err(path, `state "${name}": "${key}" must be a boolean`))
    return undefined
  }
  return value === true ? true : undefined
}

const compileBooleanOrTemplateFlag = (
  raw: Record<string, unknown>,
  key: string,
  name: string,
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
): true | string | undefined => {
  const value = raw[key]
  if (value === undefined) return undefined
  if (value === true) return true
  if (typeof value === "string" && value.trim() !== "") return value
  diagnostics.push(err(path, `state "${name}": "${key}" must be a boolean or a non-blank string`))
  return undefined
}

/**
 * One content field: a string, taken verbatim. File-ref inlining happens
 * ONCE, before this compiler ever runs (`inlineWorkflowFileRefs`, called by
 * the `src/workflow/` boundary against each config layer's own directory) —
 * by the time a value reaches here, a `./`/`../` reference has either
 * already become its file's content or already failed to load. The "exactly
 * one content kind" rule is the engine's `validateDefinition` concern, not
 * this one's.
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
    ctx.diagnostics.push(err(ctx.path, `state "${name}": "${key}" must be a string`))
    return undefined
  }
  return value
}

interface CompileCtx {
  readonly diagnostics: Diagnostic[]
  /** This field's own config path (`["machines", name, "states", local, key]`). */
  readonly path: readonly (string | number)[]
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
  actor: (raw, key, name, ctx) => compileText(raw, key, name, ctx.path, ctx.diagnostics),
  text: (raw, key, name, ctx) => compileText(raw, key, name, ctx.path, ctx.diagnostics),
  stateFile: compileStateFile,
  mode: (raw, key, name, ctx) => compileText(raw, key, name, ctx.path, ctx.diagnostics),
  content: compileContentRef,
  flag: (raw, key, name, ctx) => compileBooleanFlag(raw, key, name, ctx.path, ctx.diagnostics),
  flagOrTemplate: (raw, key, name, ctx) =>
    compileBooleanOrTemplateFlag(raw, key, name, ctx.path, ctx.diagnostics),
  edges: (raw, key, name, ctx) => compileOn(raw[key], name, ctx.path.slice(0, -1), ctx.diagnostics),
  retry: (raw, key, name, ctx) =>
    compileRetry(raw[key], name, ctx.path.slice(0, -1), ctx.diagnostics),
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
 * `on`/`retry.otherwise` target already an absolute qualified name. `raw` is
 * always a plain object here: `src/Machines.ts`'s `emitState` already
 * normalizes every non-object state to `{}` before it lands in
 * `FlattenedWorkflow.states`, so there is nothing left to guard against.
 */
const compileState = (
  qualifiedName: string,
  raw: Record<string, unknown>,
  machineByState: ReadonlyMap<string, string>,
  scopes: Readonly<Record<string, InstancePath>>,
  diagnostics: Diagnostic[],
): StateDef => {
  // The REAL authoring path (`machines.<machine>.states.<local>`), not the
  // flattened `states.<qualified>` namespace the engine itself uses — a
  // qualified name may descend through several machine references, so
  // `authoringPath` resolves it against the flattener's own tree/scopes.
  const path = authoringPath(qualifiedName, machineByState, scopes)

  const unknownKeys = Object.keys(raw).filter((k) => !KNOWN_STATE_KEYS.has(k))
  if (unknownKeys.length > 0) {
    diagnostics.push(
      err(
        path,
        `state "${qualifiedName}": unknown key(s) ${formatUnknownKeys(unknownKeys, LEGACY_STATE_KEY_HINTS)}`,
      ),
    )
  }

  const ctx: CompileCtx = { diagnostics, path }
  const compiled: Record<string, unknown> = {}
  for (const [key, spec] of STATE_FIELD_ENTRIES) {
    compiled[key] = COMPILE[spec.kind](raw, key, qualifiedName, { ...ctx, path: [...path, key] })
  }

  return assembleStateDef(compiled)
}

/**
 * Compile the top-level `summary:` template — the `gtd summary` prompt. An
 * absent value is legal (`gtd summary` refuses at runtime instead); a
 * present-but-blank value is a load error, the same rule a mode's
 * `format:`/`validate:` follows. File-ref inlining already happened once, at
 * the `src/workflow/` boundary — a value reaching here is either inline
 * source or a file's already-loaded content.
 */
const compileSummary = (
  raw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): string | undefined => {
  const value = raw["summary"]
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    diagnostics.push(err(["summary"], `"summary" must be a string`))
    return undefined
  }
  if (value.trim() === "") {
    diagnostics.push(err(["summary"], `"summary" must not be blank`))
    return undefined
  }
  return value
}

// ── Top-level compile ────────────────────────────────────────────────────────

/**
 * Compile the raw `workflow:` value — with every `./`/`../` content file
 * reference already inlined (`inlineWorkflowFileRefs`, run once by the
 * caller, against whichever directory/directories the value's own layer(s)
 * came from) — into a `WorkflowDefinition` plus the workflow's own compiled
 * `vars:` map and its machine tree. `rcModes` (the already-compiled top-level
 * `.gtdrc` `modes:` key) is layered over the workflow's own `modes:` per half
 * before validation. Pure and total: never throws, always returns a
 * `diagnostics` list instead — an `"error"`-severity entry means the caller
 * must not use `definition`. Exported because `src/workflow/compile.ts`'s
 * `compileWorkflow` calls this to compile the merged `workflow:` value — the
 * ~118 tests below exercise a function with a real production caller, not
 * one exported only so a test could reach it (that pattern — `compileState`'s
 * old non-object-`raw` guard, `assertScopesCoverStates` — was deleted, not
 * rewritten, earlier in this package).
 */
export const compileWorkflowConfig = (
  raw: unknown,
  rcModes?: Readonly<Record<string, ModeDef>>,
): CompiledWorkflowConfig => {
  const empty: CompiledWorkflowConfig = {
    definition: { states: {}, entries: { default: "", manual: [] }, modes: {} },
    vars: {},
    tree: undefined,
    scopes: {},
    diagnostics: [],
  }

  if (!isPlainObject(raw)) {
    return {
      ...empty,
      diagnostics: [err([], `workflow config: must be an object, got ${describeType(raw)}`)],
    }
  }

  const legacyShape = detectLegacyShape(raw)
  const legacyEntryKeys = detectLegacyEntryKeys(raw)
  if (legacyShape.length > 0 || legacyEntryKeys.length > 0) {
    // A stale config gets only this migration table, not forty downstream
    // findings piled on top of it.
    return { ...empty, diagnostics: [...legacyShape, ...legacyEntryKeys] }
  }

  const diagnostics: Diagnostic[] = []

  const unknownTopKeys = Object.keys(raw).filter((k) => !KNOWN_TOP_KEYS.has(k))
  if (unknownTopKeys.length > 0) {
    diagnostics.push(err([], `unknown top-level key(s) ${unknownTopKeys.join(", ")}`))
  }

  const { vars, diagnostics: varsDiagnostics } = compileVarsMap(raw.vars)
  diagnostics.push(...varsDiagnostics)
  const seeded = Object.fromEntries(
    builtInModeNames().map((name) => [name, { validate: seededValidateCommand(name) }]),
  )
  const { modes: rawModes, diagnostics: modesDiagnostics } = compileModesMap(raw.modes)
  diagnostics.push(...modesDiagnostics)
  // `mergeModes` is `undefined` only when both arguments are; `seeded` never is.
  const modes = mergeModes(mergeModes(seeded, rawModes), rcModes)!
  diagnostics.push(...validateMachinesShape(raw.machines))

  const flattened = flattenMachines(raw)
  diagnostics.push(...flattened.diagnostics)
  if (flattened.entries === undefined) {
    // Unassemblable: there is no per-state work to even attempt, so there is
    // nothing `validateDefinition` could add.
    return { ...empty, diagnostics }
  }

  const machineByState = machineNamesByState(flattened.tree)
  const states: Record<string, StateDef> = {}
  const manualSet = new Set<string>()
  for (const [name, s] of Object.entries(flattened.states)) {
    states[name] = compileState(name, s, machineByState, flattened.scopes, diagnostics)
    // A state's own `entry: true` is authoring-only — collected off the raw
    // (pre-compile) value into a sorted, deduped `entries.manual`.
    if (s["entry"] === true) manualSet.add(name)
  }
  const manual = Array.from(manualSet).sort()

  // Run validateDefinition unconditionally rather than stopping at the first
  // shape problem and hiding what validateDefinition would otherwise catch.
  const summary = compileSummary(raw, diagnostics)

  const entries = { default: flattened.entries.default, manual }
  const definition: WorkflowDefinition = {
    states,
    entries,
    modes,
    ...(summary !== undefined ? { summary } : {}),
  }

  // `flattened.scopes` is guaranteed (by construction — both are populated by
  // the same `emitTree` pass in `src/Machines.ts`) to cover exactly
  // `Object.keys(states)`; no separate cross-check is needed.
  const definitionResult = validateDefinition(definition)
  diagnostics.push(
    ...definitionResult.errors.map((message) =>
      err(bestEffortPath(message, machineByState, flattened.scopes), message),
    ),
    ...definitionResult.warnings.map((message) =>
      warn(bestEffortPath(message, machineByState, flattened.scopes), message),
    ),
  )

  return {
    definition,
    vars,
    tree: flattened.tree,
    scopes: flattened.scopes,
    diagnostics,
  }
}
