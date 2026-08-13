import { existsSync, readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import {
  validateDefinition,
  type ModeDef,
  type OnEdge,
  type RetryDef,
  type StateDef,
  type StateName,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import { CONTENT_FIELDS, STATE_FIELDS, STATE_FIELD_ENTRIES, type FieldKind } from "./StateFields.js"
import { flattenMachines, type InstancePath, type MachineNode } from "./Machines.js"
import { builtInModeNames, seededValidateCommand } from "./SteeringFormats.js"

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
 * stateDir: <string>?   # optional — an Eta template naming where this workflow keeps its own plumbing; defaults to ".gtd" (see PatternMachine.stateDirOf)
 * entry:
 *   default: <machine name>     # which machine is the ROOT instance
 * machines:
 *   <name>:
 *     params: [<param>, ...]?   # advisory only — documents which $params a caller may bind
 *     model: <string>?          # optional, opaque harness hint — stamped onto every one of THIS machine's own `prompt` states; a state may NOT declare its own
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
 *         label: <string>     # optional, opaque display name — never on a commit state
 *         file: <string>      # optional, an Eta template naming the state's steering file — never on a commit state
 *         mode: <modeName>    # optional, requires "file" — a built-in (qa/review) or a `modes:` entry; never on a commit state
 *         entry: true         # optional — an EXTRA reachability root (WorkflowEntries.manual), enterable via `gtd --entry <this state's qualified name>`; distinct from the top-level `entry:` key above
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
 * back in as `rcModes`, merged per half by `mergeModes`. Underneath BOTH layers
 * this compiler seeds `src/SteeringFormats.ts`'s built-in registry names (`qa`/
 * `review`) with that module's own `seededValidateCommand(name)` template as
 * their `validate:`, so every compiled definition's `modes` map always carries
 * a usable `validate:` command for them and a workflow never has to declare
 * them just to use gtd's own validators — a workflow (or `.gtdrc`) may still
 * override either half per name, and `src/SteeringFormats.ts`'s
 * `isSeededValidateCommand` lets the edge (`src/SteeringMode.ts`) tell gtd's
 * own seeding apart from a genuine user override.
 *
 * ## `stateDir:` — where this workflow keeps its own plumbing
 *
 * A sibling `stateDir:` key INSIDE the `workflow:` value declares the raw Eta
 * template source for gtd's own scratch/bookkeeping directory (see
 * `PatternMachine.WorkflowDefinition.stateDir`/`stateDirOf`) — a
 * DEFINITION-level declaration, not a var, because the value must reach
 * `enforceStepGuards`'s `hasCodeChange` (`src/StepGuards.ts`), computed once
 * per call before any one guard runs, rather than any guard reaching into
 * `it.vars` itself (a blessed-config-key shape this repo forbids). Absent
 * compiles to `undefined`, so `stateDirOf`'s `.gtd` default applies — a
 * workflow declaring nothing behaves exactly as before this key existed. The
 * bundled template renders this from its own ordinary `vars.stateDir` (the
 * knob a user actually overrides) — this compiler never renders it itself,
 * the same discipline as a state's own `file:`.
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

/**
 * Compile the `stateDir:` key — the raw Eta template source for where this
 * workflow keeps its own plumbing (see `PatternMachine.WorkflowDefinition.stateDir`).
 * An absent key compiles to `undefined` — the definition then carries none,
 * and `stateDirOf`'s `.gtd` default applies. A non-string value pushes one
 * load error and drops the value, never guessed at. Never rendered here —
 * the pure engine carries the string verbatim, the same discipline as a
 * state's own `file:`.
 */
const compileStateDir = (raw: unknown, errors: string[]): string | undefined => {
  if (raw === undefined) return undefined
  if (typeof raw !== "string") {
    errors.push(`"stateDir" must be a string, got ${describeType(raw)}`)
    return undefined
  }
  return raw
}

/** Every state property a flattened state may carry — `STATE_FIELDS`'s own key set, in table order. */
const KNOWN_STATE_KEYS: ReadonlySet<string> = new Set(Object.keys(STATE_FIELDS))

const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set([
  "entry",
  "machines",
  "vars",
  "modes",
  "stateDir",
])
const KNOWN_MACHINE_KEYS: ReadonlySet<string> = new Set(["params", "entry", "states", "model"])
const KNOWN_REF_KEYS: ReadonlySet<string> = new Set(["machine", "with"])

/** A state-level key removed by the `entry:`/`machines:` rewrite (or, for `memory`, by the machine-scoped-memory restructure), naming its replacement so a stale config's error points somewhere useful instead of a bare "unknown key". The state-level `model` case is instead caught pre-flatten by `LEGACY_AUTHORED_STATE_KEY_HINTS`/`validateMachineStateKeys`, because by the time a state reaches `KNOWN_STATE_KEYS`/`compileState` its `model` may be a legitimately machine-stamped key. */
const LEGACY_STATE_KEY_HINTS: Readonly<Record<string, string>> = {
  initial: `"initial" no longer exists — declare this state's qualified path in the top-level "entry.default" instead`,
  reviewEntry: `"reviewEntry" no longer exists — declare "entry: true" on this state instead`,
  fixEntry: `"fixEntry" no longer exists — declare "entry: true" on this state instead`,
  memory: `"memory" no longer exists — a machine's memory scope is derived from its position in the tree and starts fresh on every entry`,
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
 * A top-level `entry.review`/`entry.fix` key from the pre-`entry: true`
 * shape. Detected and thrown FIRST — right after `detectLegacyShape`, before
 * `flattenMachines` (or anything else) ever runs — so a stale config
 * migrating off the named review/fix entry points gets ONLY this message,
 * never mixed with `detectLegacyShape`'s own unrelated top-level findings or
 * any generic downstream complaint about an unknown key inside `entry:`.
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

/**
 * Structural validation over the raw `machines:` map that `src/Machines.ts`'s
 * `flattenMachines` does not itself perform: unknown keys on a machine
 * (`KNOWN_MACHINE_KEYS`), keys that have MOVED off a state
 * (`LEGACY_AUTHORED_STATE_KEY_HINTS`), and unknown keys on a reference local
 * (`KNOWN_REF_KEYS`), the last surfacing the old `use:` invocation's
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

/**
 * A key an author may no longer put on a STATE, mapped to the hint naming its
 * replacement. Checked against the AUTHORED `machines.<name>.states` map rather
 * than through `KNOWN_STATE_KEYS`/`compileState`, because those two see the
 * FLATTENED shape — where `src/Machines.ts` has already stamped the owning
 * machine's own `model` onto each of its `prompt` states, and a `model` key is
 * exactly what a well-formed emitted state carries.
 */
const LEGACY_AUTHORED_STATE_KEY_HINTS: Readonly<Record<string, (machineName: string) => string>> =
  Object.fromEntries(
    STATE_FIELD_ENTRIES.filter(([, spec]) => spec.authored === "machine").map(([key]) => [
      key,
      (machineName: string) =>
        `"${key}" is no longer a state key — declare it once on the machine that owns this state ("machines.${machineName}.${key}")`,
    ]),
  )

/** Flag any `LEGACY_AUTHORED_STATE_KEY_HINTS` key declared on one machine's own (non-reference) states. */
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

/**
 * The machine-level `model:` field — the ONLY place a model may be authored
 * (`validateMachineStateKeys`, above, rejects the state-level form): a
 * non-empty string, else a load error naming the machine. Validates the value
 * a machine stamps onto its own `prompt` states (`src/Machines.ts`'s
 * `resolveInstanceModel`/`emitTree`); the per-state `compileModel` (below) is
 * then only the type guard over that STAMPED value.
 */
const compileMachineModel = (
  machineName: string,
  machineRaw: Record<string, unknown>,
  errors: string[],
): void => {
  if (machineRaw.model === undefined) return
  if (typeof machineRaw.model !== "string" || machineRaw.model === "") {
    errors.push(`machines.${machineName}: "model" must be a non-empty string`)
  }
}

/** Does `machineRaw` declare at least one of its OWN (non-reference) states with content kind `prompt`? Mirrors exactly which states `src/Machines.ts` stamps a machine-level `model` onto — a reference local's states belong to the CHILD machine, never this one. */
const machineHasPromptState = (machineRaw: Record<string, unknown>): boolean => {
  const statesRaw = machineRaw["states"]
  if (!isPlainObject(statesRaw)) return false
  return Object.values(statesRaw).some(
    (def) => isPlainObject(def) && !isRefRaw(def) && typeof def["prompt"] === "string",
  )
}

/**
 * A machine declaring `model:` with no `prompt`-content state anywhere among
 * its own states is a load error, not a silent no-op — see this module's
 * "BOUNDARY CORRECTION" note in package 02: the model would never land on any
 * emitted state, so the declaration does nothing.
 */
const validateMachineModelHasPromptState = (
  machineName: string,
  machineRaw: Record<string, unknown>,
  errors: string[],
): void => {
  if (machineRaw.model === undefined) return
  if (!machineHasPromptState(machineRaw)) {
    errors.push(
      `machine "${machineName}": declares "model" but has no "prompt" state — this would never take effect`,
    )
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
    compileMachineModel(machineName, machineRaw, errors)
    validateMachineModelHasPromptState(machineName, machineRaw, errors)
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
  /** Qualified state name -> the machine-instance path (`InstancePath`) that owns it, straight from `FlattenedWorkflow.scopes` — the memory-scope lookup a future package (`src/Edge.ts`) threads through. Its key set is asserted (below, in `compileWorkflowConfig`) to exactly match `definition.states`'s key set. */
  readonly scopes: Record<StateName, InstancePath>
}

const formatErrors = (errors: readonly string[]): string =>
  `workflow config:\n${errors.map((e) => `  - ${e}`).join("\n")}`

// ── Content resolution (file-ref auto-inlining) ─────────────────────────────

/**
 * The filesystem seam behind `./`/`../` content file references
 * (`resolveContent`). `nodeFileRefReader` is the production adapter (real
 * `fs`); every threading function below defaults to it so every existing call
 * site compiles unchanged — `src/testing/` injects a repo-backed reader
 * instead, so an in-memory `.gtdrc`'s file references resolve against the
 * FAKE worktree rather than the real filesystem.
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

/** Inline every state's content file references for one machine; a malformed machine/states shape passes through untouched. */
const inlineMachineFileRefs = (
  machineRaw: unknown,
  machineName: string,
  configDir: string,
  errors: string[],
  fileRefs: FileRefReader = nodeFileRefReader,
): unknown => {
  if (!isPlainObject(machineRaw)) return machineRaw
  const rawStates = machineRaw["states"]
  if (!isPlainObject(rawStates)) return machineRaw
  const states: Record<string, unknown> = {}
  for (const [local, def] of Object.entries(rawStates)) {
    states[local] = isPlainObject(def)
      ? inlineStateFileRefs(def, machineName, local, configDir, errors, fileRefs)
      : def
  }
  return { ...machineRaw, states }
}

export const inlineWorkflowFileRefs = (
  rawWorkflow: unknown,
  configDir: string,
  errors: string[],
  fileRefs: FileRefReader = nodeFileRefReader,
): unknown => {
  if (!isPlainObject(rawWorkflow)) return rawWorkflow
  const rawMachines = rawWorkflow["machines"]
  if (!isPlainObject(rawMachines)) return rawWorkflow
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
 * One text field (`actor`/`model`/`label`/`file`/`mode`): a plain string, or
 * undefined (either absent or invalid — the type mismatch is its own error).
 * Vocabulary/shape rules (non-empty, forbidden on a commit state, requires a
 * sibling field, naming a known mode) are `STATE_FIELDS`'/
 * `validateDefinition`'s concern, not this compiler's.
 */
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
 * A boolean state flag (`reviewWindow`/`requireProgress`/`answerGate`/
 * `entry`): `true` only when the raw value is the literal `true`; a
 * non-boolean is a config error; `false` (or absent) compiles away to
 * `undefined` so it never lands in the `StateDef` — `false` and "unset" mean
 * the same thing for every such flag. `reviewBase` no longer goes through
 * this — see `compileBooleanOrTemplateFlag`.
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

/**
 * `reviewBase`'s own flag shape: the literal `true`, OR a non-blank string (an
 * Eta template rendering a commitish, returned verbatim — no trimming, just a
 * blank-after-trim rejection) — see `StateDef.reviewBase`'s widened type.
 * `false`, a number, an object, or a blank string are all rejected with the
 * same finding shape `compileBooleanFlag` uses; `undefined` (absent) passes
 * through untouched.
 */
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
 * One content field (`script`/`prompt`/`message`/`commit`): a string,
 * file-refs auto-inlined. `ctx.inlineFileRefs` is `false` only when the
 * caller (`src/Config.ts`'s `loadMerged`) has ALREADY inlined every
 * reference per declaring file — the content is then taken verbatim, so a
 * `script:` whose inlined text happens to begin with `./` is never mistaken
 * for a second file reference and re-resolved. The "exactly one content
 * kind" rule is NOT checked here — it's owned solely by the engine's
 * `validateDefinition` (`validateContentKind`), which runs over the fully
 * assembled definition alongside every other shape error (see
 * `compileWorkflowConfig`'s aggregation).
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

/** Per-state compile context threaded through `COMPILE` — bundles what a field compiler needs beyond the raw state object and its own key. */
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
  mode: (raw, key, name, ctx) => compileText(raw, key, name, ctx.errors),
  content: compileContentRef,
  flag: (raw, key, name, ctx) => compileBooleanFlag(raw, key, name, ctx.errors),
  flagOrTemplate: (raw, key, name, ctx) => compileBooleanOrTemplateFlag(raw, key, name, ctx.errors),
  edges: (raw, key, name, ctx) => compileOn(raw[key], name, ctx.errors),
  retry: (raw, key, name, ctx) => compileRetry(raw[key], name, ctx.errors),
}

/**
 * Assemble the compiled field values into a `StateDef`: every field whose
 * `surface` is `"def"`, spread only when defined — the shared "omit rather
 * than write `undefined`" pattern `exactOptionalPropertyTypes` needs.
 * `entry` (`surface: "authoring-only"`) is structurally excluded here —
 * `COMPILE` still validates its shape like any other field (see
 * `compileState`), but it never lands on the compiled `StateDef`;
 * `compileWorkflowConfig` reads the RAW `entry: true` flag directly off
 * each qualified state to build `WorkflowEntries.manual` instead.
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
 * `FlattenedWorkflow.states` (`src/Machines.ts`) — `$param`s already
 * substituted, every `on`/`retry.otherwise` target already an absolute
 * qualified name — so this is exactly the flat compilation the
 * pre-`entry:`/`machines:` compiler already did. The old named entry-point
 * flags (`initial`/`reviewEntry`/`fixEntry`) are gone from this shape
 * entirely: the flattener resolves `entry.default` directly into
 * `WorkflowDefinition.entries.default`, and a state's own `entry: true` flag
 * (compiled here, collected by the caller) seeds `entries.manual` instead —
 * neither ever lands on the compiled `StateDef`.
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
 * (`src/Machines.ts`) promises a `scopes` entry for EVERY state it emits (see
 * that module's doc comment, "Bindings carry their scope") — a mismatch here
 * means the flattener itself missed a state, which must fail loudly rather
 * than silently produce a memory key that reads as "outside every scope".
 * Exported so this invariant is directly testable against a contrived
 * `scopes` map, independent of whether `flattenMachines` itself can currently
 * be made to violate its own guarantee.
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
 * Four error-sequencing rules, in order:
 *
 * 1. `detectLegacyShape` short-circuits first — a stale pre-`entry:`/`machines:`
 *    config throws with ONLY the migration findings, never mixed with
 *    downstream noise.
 * 2. `detectLegacyEntryKeys` short-circuits next — a stale top-level
 *    `entry.review`/`entry.fix` key (the pre-`entry: true` named entry points)
 *    throws with ONLY its own migration findings, before `flattenMachines`
 *    (or anything else) has a chance to notice those same keys some other way.
 * 3. Unassemblable throws early: `flattenMachines`'s `entries` coming back
 *    `undefined` (no `entry.default`, no `machines`, an unresolvable root)
 *    means there is no definition for `validateDefinition` to add findings to
 *    — throw immediately with whatever findings exist so far.
 * 4. Otherwise the flattener's findings and `validateDefinition`'s findings
 *    merge into one de-duplicated, thrown error.
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
  // `mergeModes` is `undefined` only when BOTH arguments are — `seeded` never
  // is, so this merge (and the one layering `rcModes` over it) always resolves.
  const modes = mergeModes(mergeModes(seeded, compileModesMap(raw.modes, errors)), rcModes)!
  const stateDir = compileStateDir(raw.stateDir, errors)
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
    // A state's own `entry: true` (distinct from the top-level `entry:`
    // machine-tree key of the same name) is authoring-only — `compileState`
    // validates its shape but never carries it onto the `StateDef`. Collected
    // here, off the RAW (pre-compile) qualified state value, into a sorted,
    // deduped `entries.manual` — see `PatternMachine.WorkflowEntries`.
    if (isPlainObject(s) && s["entry"] === true) manualSet.add(name)
  }
  const manual = Array.from(manualSet).sort()

  // A definition can still be assembled (however messy) whenever the flattener
  // resolved `entries` — so run `validateDefinition` unconditionally and merge
  // its findings with the shape errors collected above into ONE thrown error,
  // rather than stopping at the first shape problem and hiding everything
  // `validateDefinition` would otherwise have caught (e.g. a bad content kind
  // in an unrelated state). De-duplicate identical messages (both passes can
  // independently notice the same problem).
  const entries = { default: flattened.entries.default, manual }
  const definition: WorkflowDefinition = {
    states,
    entries,
    modes,
    ...(stateDir !== undefined ? { stateDir } : {}),
  }

  assertScopesCoverStates(Object.keys(states), flattened.scopes, errors)

  const definitionErrors = validateDefinition(definition)
  const allErrors = Array.from(new Set([...errors, ...definitionErrors]))
  if (allErrors.length > 0) throw new Error(formatErrors(allErrors))

  // `flattened.tree` is `undefined` only when the root machine itself could not
  // be instantiated (`src/Machines.ts`'s `flattenMachines`) — which is exactly
  // the case already ruled out by the `entries === undefined` throw above,
  // since `entries` can only resolve once the root instantiated.
  return { definition, vars, tree: flattened.tree!, scopes: flattened.scopes }
}
