import { MACHINE_FIELD_ENTRIES } from "./StateFields.js"
import type { StateName } from "./PatternMachine.js"

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const describeType = (v: unknown): string => {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

/** A whole-value parameter reference: a string that is EXACTLY `$name`. */
const PARAM_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/

/** `""` for the root instance, else the dot-joined reference path (e.g. `packages.health`). */
export type InstancePath = string

/**
 * A bound value plus the instance whose namespace it was written in. A
 * `with:` value naming another binding is passed down WHOLE (value and scope
 * unchanged), which is what makes a param threaded grandparent → parent →
 * child resolve in the grandparent's namespace rather than the parent's or
 * child's. `value` is `unknown` because a target position requires a string,
 * but a non-target field may bind anything a `with:` clause can express.
 */
export interface Binding {
  readonly value: unknown
  readonly scope: InstancePath
}

export type Bindings = Readonly<Record<string, Binding>>

/** One instantiated machine — a node in the tree Pass 1 builds. */
export interface Instance {
  readonly path: InstancePath
  readonly machine: string
  readonly bindings: Bindings
  /** local name -> what it is, for target resolution. */
  readonly locals: ReadonlyMap<string, { readonly kind: "state" | "ref"; readonly refKey?: string }>
  readonly children: readonly Instance[]
}

/**
 * The visualization payload, a projection of `Instance`: `states` are only
 * the instance's OWN direct states (qualified), so no state appears in two
 * nodes — the rest live under `children`.
 */
export interface MachineNode {
  readonly key: string
  readonly machine: string
  readonly states: readonly StateName[]
  readonly children: readonly MachineNode[]
}

export interface FlattenedWorkflow {
  /** qualified name -> raw state def, `$param`s substituted, targets absolutized. */
  readonly states: Record<string, unknown>
  /** Resolved root default entry; `undefined` when `entries.default` itself failed to resolve. */
  readonly entries: { readonly default: string } | undefined
  /** `undefined` only when the root machine itself could not be instantiated. */
  readonly tree: MachineNode | undefined
  /** qualified state name -> the instance path (see `InstancePath`) that owns it. */
  readonly scopes: Record<string, InstancePath>
}

const qualify = (path: InstancePath, local: string): string =>
  path === "" ? local : `${path}.${local}`

/** A local is a REFERENCE iff its raw value carries a `machine` key. */
const isRef = (v: unknown): v is { machine: string; with?: Record<string, unknown> } =>
  isPlainObject(v) && typeof v["machine"] === "string"

/**
 * Resolve one `with:` value against the CALLER's own bindings: a whole-value
 * `$param` naming one of them passes that binding down verbatim (value AND
 * scope unchanged — the mechanism that makes a threaded param resolve in the
 * grandparent's namespace); anything else is a fresh binding scoped to the
 * caller's own instance (where it was written).
 */
const resolveWithValue = (
  value: unknown,
  callerBindings: Bindings,
  callerPath: InstancePath,
): Binding => {
  if (typeof value === "string") {
    const m = PARAM_REF.exec(value)
    if (m) {
      const existing = callerBindings[m[1]!]
      if (existing !== undefined) return existing
    }
  }
  return { value, scope: callerPath }
}

/** Pass-1 state threaded through every `instantiate`/`instantiateLocal` call — the parts that never change across the recursion. */
interface InstantiateCtx {
  readonly machinesRaw: Record<string, unknown>
  readonly referenced: Set<string>
  readonly instancesByPath: Map<InstancePath, Instance>
  readonly errors: string[]
}

/**
 * Instantiate one local of `machineName` (a state or a reference) into
 * `locals`/`children`, pushing (and skipping only this local for) a dotted
 * name. A reference recurses via `instantiate`, first resolving its `with:`
 * bindings against the CALLER's own bindings (see `resolveWithValue`).
 */
const instantiateLocal = (
  localName: string,
  def: unknown,
  machineName: string,
  path: InstancePath,
  nextAncestors: readonly string[],
  bindings: Bindings,
  ctx: InstantiateCtx,
  locals: Map<string, { kind: "state" | "ref"; refKey?: string }>,
  children: Instance[],
): void => {
  if (localName.includes(".")) {
    ctx.errors.push(`machine "${machineName}": local name "${localName}" must not contain "."`)
    return
  }
  if (!isRef(def)) {
    locals.set(localName, { kind: "state" })
    return
  }
  locals.set(localName, { kind: "ref", refKey: localName })
  ctx.referenced.add(def.machine)
  const withRaw = isPlainObject(def.with) ? def.with : {}
  const childBindings: Record<string, Binding> = {}
  for (const [key, value] of Object.entries(withRaw)) {
    childBindings[key] = resolveWithValue(value, bindings, path)
  }
  const child = instantiate(
    def.machine,
    qualify(path, localName),
    nextAncestors,
    childBindings,
    ctx,
    `machines.${machineName}.${localName}`,
  )
  if (child !== undefined) children.push(child)
}

/**
 * Instantiate one machine at `path`, recursing into every local reference.
 * Pushes (and skips only the offending subtree/local for) a cycle, an
 * unknown `machine:` name, or a dotted local name. `unknownLocation` is the
 * finding's location prefix if `machineName` itself doesn't resolve (the
 * reference site for a child, `entry.default` for the root).
 */
const instantiate = (
  machineName: string,
  path: InstancePath,
  ancestorChain: readonly string[],
  bindings: Bindings,
  ctx: InstantiateCtx,
  unknownLocation: string,
): Instance | undefined => {
  if (ancestorChain.includes(machineName)) {
    ctx.errors.push(`machine reference cycle: ${[...ancestorChain, machineName].join(" → ")}`)
    return undefined
  }
  const rawMachine = ctx.machinesRaw[machineName]
  if (rawMachine === undefined) {
    ctx.errors.push(`${unknownLocation}: unknown machine "${machineName}"`)
    return undefined
  }
  if (!isPlainObject(rawMachine) || !isPlainObject(rawMachine["states"])) {
    ctx.errors.push(`machine "${machineName}": must declare a "states" mapping`)
    return undefined
  }

  const statesRaw = rawMachine["states"] as Record<string, unknown>
  const locals = new Map<string, { kind: "state" | "ref"; refKey?: string }>()
  const children: Instance[] = []
  const nextAncestors = [...ancestorChain, machineName]

  for (const [localName, def] of Object.entries(statesRaw)) {
    instantiateLocal(
      localName,
      def,
      machineName,
      path,
      nextAncestors,
      bindings,
      ctx,
      locals,
      children,
    )
  }

  const instance: Instance = { path, machine: machineName, bindings, locals, children }
  ctx.instancesByPath.set(path, instance)
  return instance
}

type ResolveResult =
  | { readonly kind: "ok"; readonly value: string; readonly trail: readonly string[] }
  | { readonly kind: "unbound"; readonly name: string; readonly trail: readonly string[] }
  | { readonly kind: "invalid"; readonly machine: string; readonly trail: readonly string[] }

/** Resolve a `$param` target: recurse into the binding's own scope instance, or report it unbound. */
const resolveParamTarget = (
  name: string,
  instance: Instance,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  trail: readonly string[],
): ResolveResult => {
  const binding = instance.bindings[name]
  if (binding === undefined || typeof binding.value !== "string") {
    return { kind: "unbound", name, trail }
  }
  const scopeInstance = instancesByPath.get(binding.scope)
  if (scopeInstance === undefined) return { kind: "unbound", name, trail }
  return resolveCore(binding.value, scopeInstance, instancesByPath, machinesRaw, trail)
}

/** Resolve a local-of-`instance` target: a state (no remainder) qualifies directly; a reference recurses into its child, through its own `entry:` when there's no remainder. */
const resolveLocalTarget = (
  first: string,
  remainder: string | undefined,
  instance: Instance,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  trail: readonly string[],
): ResolveResult => {
  const local = instance.locals.get(first)
  if (local === undefined || (local.kind === "state" && remainder !== undefined)) {
    return { kind: "invalid", machine: instance.machine, trail }
  }
  if (local.kind === "state") {
    return { kind: "ok", value: qualify(instance.path, first), trail }
  }

  const child = instancesByPath.get(qualify(instance.path, first))
  if (child === undefined) {
    // The child failed to instantiate — already reported at Pass 1.
    return { kind: "invalid", machine: instance.machine, trail }
  }
  if (remainder === undefined) {
    const childMachine = machinesRaw[child.machine]
    const childEntry = isPlainObject(childMachine) ? childMachine["entry"] : undefined
    if (typeof childEntry !== "string") return { kind: "invalid", machine: child.machine, trail }
    return resolveCore(childEntry, child, instancesByPath, machinesRaw, [...trail, first])
  }
  return resolveCore(remainder, child, instancesByPath, machinesRaw, trail)
}

/**
 * The pure target resolution at the heart of this module: a `$param` looks up
 * `instance.bindings` and resolves the binding's value starting over at its
 * own scope; otherwise the target is split on the first `.` — the leading
 * segment must name a local of `instance` (a state with no remainder
 * qualifies directly; a reference with no remainder resolves that machine's
 * own `entry:` recursively; a reference with a remainder recurses into the
 * child). `trail` accumulates the reference-key breadcrumb for a
 * "reference, no remainder" hop, so a finding surfacing from deep inside that
 * recursion can still name the reference it went through.
 */
const resolveCore = (
  target: string,
  instance: Instance,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  trail: readonly string[] = [],
): ResolveResult => {
  const paramMatch = PARAM_REF.exec(target)
  if (paramMatch) {
    return resolveParamTarget(paramMatch[1]!, instance, instancesByPath, machinesRaw, trail)
  }

  const dotIdx = target.indexOf(".")
  const first = dotIdx === -1 ? target : target.slice(0, dotIdx)
  const remainder = dotIdx === -1 ? undefined : target.slice(dotIdx + 1)
  return resolveLocalTarget(first, remainder, instance, instancesByPath, machinesRaw, trail)
}

const formatTrail = (where: string, trail: readonly string[]): string =>
  trail.length > 0 ? `${where} (${trail.join(" → ")})` : where

/** Resolve an `on`/`retry.otherwise` target, pushing the "on target" sideways/upward wording on failure. */
const resolveOnTarget = (
  target: string,
  instance: Instance,
  where: string,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  errors: string[],
): string | undefined => {
  const result = resolveCore(target, instance, instancesByPath, machinesRaw)
  const label = formatTrail(where, result.trail)
  if (result.kind === "ok") return result.value
  if (result.kind === "unbound") {
    errors.push(`${label}: references unbound param "$${result.name}"`)
    return undefined
  }
  errors.push(
    `${label}: "on" target "${target}" is not a state or reference of machine "${result.machine}" — declare a "params:" entry and bind it at the reference site`,
  )
  return undefined
}

/** Resolve the root machine's own `entry:` (`entry.default`), pushing the distinct "entry" wording on failure. */
const resolveEntry = (
  entryKey: string,
  target: string,
  instance: Instance,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  errors: string[],
): string | undefined => {
  const result = resolveCore(target, instance, instancesByPath, machinesRaw)
  if (result.kind === "ok") return result.value
  if (result.kind === "unbound") {
    errors.push(`"${entryKey}" references unbound param "$${result.name}"`)
    return undefined
  }
  errors.push(`"${entryKey}" names "${target}", which is not a state or machine reference`)
  return undefined
}

/** Substitute a WHOLE-value `$param` in any scalar field against `instance`'s own bindings — a literal splice, no scope-aware resolution. */
const substituteScalar = (
  value: unknown,
  instance: Instance,
  where: string,
  errors: string[],
): unknown => {
  if (typeof value !== "string") return value
  const m = PARAM_REF.exec(value)
  if (!m) return value
  const name = m[1]!
  const binding = instance.bindings[name]
  if (binding === undefined) {
    errors.push(`${where}: references unbound param "$${name}"`)
    return value
  }
  return binding.value
}

/** Rewrite one object-form `on` row (`{ to, describe?, action? }`): `to` through the resolver, `describe`/`action` through whole-value `$param` substitution. */
const emitOnObjectEdge = (
  value: Record<string, unknown>,
  instance: Instance,
  where: string,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  errors: string[],
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...value }
  if (typeof value["to"] === "string") {
    next["to"] =
      resolveOnTarget(value["to"], instance, where, instancesByPath, machinesRaw, errors) ??
      value["to"]
  }
  if (typeof value["describe"] === "string") {
    next["describe"] = substituteScalar(value["describe"], instance, where, errors)
  }
  if (typeof value["action"] === "string") {
    next["action"] = substituteScalar(value["action"], instance, where, errors)
  }
  return next
}

/** Rewrite the `on` mapping — each row's target (string, or `{ to, describe, action }`) — through the resolver, preserving pattern keys and declaration order. */
const emitOn = (
  raw: unknown,
  instance: Instance,
  where: string,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  errors: string[],
): unknown => {
  if (!isPlainObject(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [pattern, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      out[pattern] =
        resolveOnTarget(value, instance, where, instancesByPath, machinesRaw, errors) ?? value
    } else if (isPlainObject(value)) {
      out[pattern] = emitOnObjectEdge(value, instance, where, instancesByPath, machinesRaw, errors)
    } else {
      out[pattern] = value
    }
  }
  return out
}

const emitRetry = (
  raw: unknown,
  instance: Instance,
  where: string,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  errors: string[],
): unknown => {
  if (!isPlainObject(raw)) return raw
  const next: Record<string, unknown> = { ...raw }
  if (typeof raw["otherwise"] === "string") {
    next["otherwise"] =
      resolveOnTarget(raw["otherwise"], instance, where, instancesByPath, machinesRaw, errors) ??
      raw["otherwise"]
  }
  return next
}

const emitState = (
  stateRaw: unknown,
  instance: Instance,
  localName: string,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  errors: string[],
): Record<string, unknown> => {
  const where = `machines.${instance.machine}.${localName}`
  if (!isPlainObject(stateRaw)) {
    errors.push(`${where}: state must be an object, got ${describeType(stateRaw)}`)
    return {}
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(stateRaw)) {
    if (key === "on") {
      out[key] = emitOn(value, instance, where, instancesByPath, machinesRaw, errors)
      continue
    }
    if (key === "retry") {
      out[key] = emitRetry(value, instance, where, instancesByPath, machinesRaw, errors)
      continue
    }
    const resolved = substituteScalar(value, instance, where, errors)
    // A whole-value `$param` that RESOLVES to the empty string compiles away
    // to "field absent" — the normal "not anchored"/"not set" case for an
    // instance that doesn't need this optional flag (e.g. `reviewBase: ""`
    // bound at a dedup site that has no fixed base). A field whose SOURCE
    // value is itself a literal blank string (never matches `PARAM_REF`)
    // is unaffected and reaches the downstream compiler as authored.
    if (typeof value === "string" && PARAM_REF.test(value) && resolved === "") continue
    out[key] = resolved
  }
  return out
}

/**
 * Resolve every one of an instance's own machine-authored field values
 * (`MACHINE_FIELD_ENTRIES` — `model`, `system`), substituting a whole-value
 * `$param` at the reference site. A whole-value `$param` that resolves to the
 * empty string compiles away to "field absent" (mirrors the same rule in
 * `emitState`) — an instance that doesn't bind a value for this machine
 * should not stamp e.g. `model: ""`.
 */
const resolveInstanceMachineFields = (
  rawMachine: Record<string, unknown>,
  instance: Instance,
  errors: string[],
): Record<string, unknown> => {
  const resolved: Record<string, unknown> = {}
  for (const [key] of MACHINE_FIELD_ENTRIES) {
    const raw = rawMachine[key]
    if (raw === undefined) continue
    const substituted = substituteScalar(raw, instance, `machines.${instance.machine}`, errors)
    if (typeof raw === "string" && PARAM_REF.test(raw) && substituted === "") continue
    resolved[key] = substituted
  }
  return resolved
}

const emitTree = (
  instance: Instance,
  machinesRaw: Record<string, unknown>,
  states: Record<string, unknown>,
  scopes: Record<string, InstancePath>,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  errors: string[],
): void => {
  const rawMachine = machinesRaw[instance.machine] as Record<string, unknown>
  const statesRaw = rawMachine["states"] as Record<string, unknown>
  const resolvedFields = resolveInstanceMachineFields(rawMachine, instance, errors)
  for (const [localName, local] of instance.locals) {
    if (local.kind !== "state") continue
    const qualified = qualify(instance.path, localName)
    const emitted = emitState(
      statesRaw[localName],
      instance,
      localName,
      instancesByPath,
      machinesRaw,
      errors,
    )
    if (typeof emitted["prompt"] === "string") {
      Object.assign(emitted, resolvedFields)
    }
    states[qualified] = emitted
    scopes[qualified] = instance.path
  }
  for (const child of instance.children)
    emitTree(child, machinesRaw, states, scopes, instancesByPath, errors)
}

const buildTree = (instance: Instance): MachineNode => ({
  key: instance.path === "" ? instance.machine : instance.path,
  machine: instance.machine,
  states: Array.from(instance.locals.entries())
    .filter(([, local]) => local.kind === "state")
    .map(([local]) => qualify(instance.path, local)),
  children: instance.children.map(buildTree),
})

/**
 * Flatten a raw `entry:`/`machines:` config — a tree of reusable,
 * parameterized "machines" a workflow is authored with — into qualified
 * states, resolved entry points, and a visualization tree, so the rest of the
 * compiler and the pure engine only ever see ordinary qualified states.
 * Findings are pushed onto `errors`; a structurally invalid `raw` (not an
 * object, or missing `entry.default`) yields the all-empty/`undefined` shape
 * without attempting the passes.
 */
export const flattenMachines = (raw: unknown, errors: string[]): FlattenedWorkflow => {
  const empty: FlattenedWorkflow = { states: {}, entries: undefined, tree: undefined, scopes: {} }
  if (!isPlainObject(raw)) {
    errors.push(`workflow must be an object, got ${describeType(raw)}`)
    return empty
  }
  const entryRaw = raw["entry"]
  if (!isPlainObject(entryRaw) || typeof entryRaw["default"] !== "string") {
    errors.push(`"entry.default" must name a machine`)
    return empty
  }
  const machinesRaw: Record<string, unknown> = isPlainObject(raw["machines"])
    ? (raw["machines"] as Record<string, unknown>)
    : {}

  const instancesByPath = new Map<InstancePath, Instance>()
  const referenced = new Set<string>()
  const rootMachineName = entryRaw["default"]
  referenced.add(rootMachineName)
  const ctx: InstantiateCtx = { machinesRaw, referenced, instancesByPath, errors }
  const root = instantiate(rootMachineName, "", [], {}, ctx, "entry.default")

  for (const name of Object.keys(machinesRaw)) {
    if (!referenced.has(name)) errors.push(`machine "${name}" is declared but never referenced`)
  }

  if (root === undefined) return empty

  const states: Record<string, unknown> = {}
  const scopes: Record<string, InstancePath> = {}
  emitTree(root, machinesRaw, states, scopes, instancesByPath, errors)
  const tree = buildTree(root)

  const rootMachine = machinesRaw[rootMachineName] as Record<string, unknown>
  const rootEntry = rootMachine["entry"]
  const defaultResolved =
    typeof rootEntry === "string"
      ? resolveEntry("entry.default", rootEntry, root, instancesByPath, machinesRaw, errors)
      : (errors.push(`machine "${rootMachineName}": "entry" must be a string`), undefined)

  if (defaultResolved === undefined) return { states, entries: undefined, tree, scopes }

  return { states, entries: { default: defaultResolved }, tree, scopes }
}
