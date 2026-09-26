import { MACHINE_FIELD_ENTRIES } from "./StateFields.js"
import type { StateName } from "./PatternMachine.js"
import type { WorkspaceOps } from "./platform/index.js"
import type { Diagnostic } from "./workflow/index.js"

/** A finding's `origin` is unknown to this module (it never sees which config layer a raw value came from) — the boundary that calls `flattenMachines` fills it in. */
const UNKNOWN_ORIGIN = ""

const machinePath = (machineName: string): readonly (string | number)[] => ["machines", machineName]

const statePath = (machineName: string, local: string): readonly (string | number)[] => [
  ...machinePath(machineName),
  "states",
  local,
]

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
  /**
   * Set only when THIS instance was created by a reference declaring
   * `each:`, and only once `drained:` resolves (Pass 2 — see
   * `resolveEachTargets`). Mutated in place rather than threaded back
   * through `instantiate`'s return value, the same way `instancesByPath`
   * itself is built up imperatively across the recursion.
   */
  each?: EachDeclaration
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
  /** qualified name -> raw state def, `$param`s substituted, targets absolutized. Always a plain object — `emitState` never emits anything else. */
  readonly states: Record<string, Record<string, unknown>>
  /** Resolved root default entry; `undefined` when `entries.default` itself failed to resolve. */
  readonly entries: { readonly default: string } | undefined
  /** `undefined` only when the root machine itself could not be instantiated. */
  readonly tree: MachineNode | undefined
  /** qualified state name -> the instance path (see `InstancePath`) that owns it. */
  readonly scopes: Record<string, InstancePath>
  /** Every instantiated node, keyed by its own path — how a later pass reads a reference's resolved `each:` declaration (`instances.get(path)?.each`). */
  readonly instances: ReadonlyMap<InstancePath, Instance>
  /** Findings collected across both passes — `origin` unset (`""`); the boundary calling `flattenMachines` fills it in. */
  readonly diagnostics: readonly Diagnostic[]
}

const qualify = (path: InstancePath, local: string): string =>
  path === "" ? local : `${path}.${local}`

/** A local is a REFERENCE iff its raw value carries a `machine` key. */
const isRef = (
  v: unknown,
): v is { machine: string; with?: Record<string, unknown>; each?: unknown } =>
  isPlainObject(v) && typeof v["machine"] === "string"

/** Where an `each:` source's item tokens come from — mutually exclusive, see `validateEach`. */
export type EachSource =
  | { readonly kind: "glob"; readonly value: string }
  | {
      readonly kind: "var"
      readonly value: string
    }

/**
 * A reference's `each:` declaration, recorded on the CHILD instance it
 * instantiates once `drained:` resolves (see `FlattenedWorkflow.instances`).
 * Nothing in this pass turns `source` into item tokens or reads `drained` for
 * anything but validation — a later pass does both (see
 * .gtd/packages/01-each-declaration.md).
 */
export interface EachDeclaration {
  readonly source: EachSource
  /** The reference's `drained:` target, resolved through the same resolver an `on:` target uses, against the REFERRING (parent) instance. */
  readonly drained: string
  /** The reference's OWN machine's `entry:` local, resolved against the CHILD instance itself — where the loop enters each item, base name (qualification is a runtime notion, see `PatternMachine.ts`). */
  readonly entry: string
}

/**
 * Turns an `each: { var: ... }` source into ordered item tokens: split on
 * `,`, trim each field, drop empty fields. Pure string splitting — the value
 * NEVER reaches a shell (unlike `qualityReview.seeding`'s own comma-split,
 * which interpolates the var raw into a `sh -c` script; see
 * .gtd/packages/01-each-declaration.md Requirement B). A token containing
 * `$(...)` or a backtick is returned as the literal string it is; nothing
 * here ever spawns a subshell to expand it.
 */
export const resolveVarTokens = (value: string): readonly string[] =>
  value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

/**
 * Turns an `each: { glob: ... }` source into ordered item tokens — a thin
 * seam over `Workspace.glob` (see its own doc comment for the working-
 * tree/repo-relative/lexicographic contract), taken as a plain function
 * argument rather than an injected `Workspace` tag, matching
 * `templateRead`/`templateDiff`'s own synchronous-caller exception.
 */
export const resolveGlobTokens =
  (workspace: Pick<WorkspaceOps, "glob">) =>
  (pattern: string): readonly string[] =>
    workspace.glob(pattern)

const EACH_KEYS = new Set(["glob", "var", "drained"])

/** `validateEach`'s result before `drained:` is resolved (Pass 2 needs the referring instance, not yet fully built here). */
interface PendingEach {
  readonly source: EachSource
  readonly drainedRaw: string
  readonly where: string
  readonly path: readonly (string | number)[]
  /** The REFERRING instance's own path — `drained:` resolves against it, not the child `each:` instantiates. */
  readonly parentPath: InstancePath
  /** The reference's own machine — its `entry:` resolves against the CHILD instance (see `EachDeclaration.entry`), already confirmed to be a string by `validateEach`. */
  readonly refMachine: string
}

/**
 * Validate one reference's `each:` shape: no unknown key, exactly one of
 * `glob`/`var`, a required `drained:`, and a referenced machine that declares
 * its own `entry:` (an `each:` loop has to enter its machine somewhere).
 * `drained:`'s TARGET is left unresolved here — that happens in Pass 2,
 * against the referring instance, through the same resolver an `on:` target
 * uses.
 */
const validateEach = (
  eachRaw: unknown,
  machineName: string,
  refMachine: string,
  localName: string,
  parentPath: InstancePath,
  ctx: InstantiateCtx,
): PendingEach | undefined => {
  const path = statePath(machineName, localName)
  const where = `machines.${machineName}.${localName}.each`
  if (!isPlainObject(eachRaw)) {
    ctx.diagnostics.push(err(path, `${where}: must be an object`))
    return undefined
  }
  for (const key of Object.keys(eachRaw)) {
    if (!EACH_KEYS.has(key)) {
      ctx.diagnostics.push(err(path, `${where}: unknown key "${key}"`))
      return undefined
    }
  }
  const hasGlob = typeof eachRaw["glob"] === "string"
  const hasVar = typeof eachRaw["var"] === "string"
  if (hasGlob === hasVar) {
    ctx.diagnostics.push(err(path, `${where}: declare exactly one of "glob" or "var"`))
    return undefined
  }
  if (typeof eachRaw["drained"] !== "string") {
    ctx.diagnostics.push(err(path, `${where}: "drained" is required`))
    return undefined
  }
  const rawRefMachine = ctx.machinesRaw[refMachine]
  const refEntry = isPlainObject(rawRefMachine) ? rawRefMachine["entry"] : undefined
  if (typeof refEntry !== "string") {
    ctx.diagnostics.push(
      err(path, `${where}: machine "${refMachine}" declares no "entry:" for the loop to enter`),
    )
    return undefined
  }
  const source: EachSource = hasGlob
    ? { kind: "glob", value: eachRaw["glob"] as string }
    : { kind: "var", value: eachRaw["var"] as string }
  return {
    source,
    drainedRaw: eachRaw["drained"],
    where,
    path,
    parentPath,
    refMachine,
  }
}

/**
 * Reject a NESTED `each:` — a reference whose own `each:` declaration sits
 * inside another `each:` reference's subtree (its child path is a true
 * dotted descendant of the outer reference's own child path). Runtime
 * position derivation (`PatternMachine.ts`'s `qualifierIndexAt`/`qualifyAt`)
 * anchors on a BASE ref path, which cannot see an already-qualified ancestor
 * segment — an inner loop would silently never advance past item 0. Caught
 * here, at load time, so that case can't be authored at all: an author who
 * wants a per-item sub-loop has to flatten it into one `each:` instead.
 */
const validateNoNestedEach = (
  eachPending: ReadonlyMap<InstancePath, PendingEach>,
  diagnostics: Diagnostic[],
): void => {
  for (const [childPath, pending] of eachPending) {
    for (const [otherPath] of eachPending) {
      if (otherPath !== childPath && childPath.startsWith(`${otherPath}.`)) {
        diagnostics.push(
          err(
            pending.path,
            `${pending.where}: nested inside each: reference "${otherPath}" — a nested each: is not supported`,
          ),
        )
      }
    }
  }
}

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

const err = (path: readonly (string | number)[], message: string): Diagnostic => ({
  severity: "error",
  message,
  path,
  origin: UNKNOWN_ORIGIN,
})

/** Pass-1 state threaded through every `instantiate`/`instantiateLocal` call — the parts that never change across the recursion. */
interface InstantiateCtx {
  readonly machinesRaw: Record<string, unknown>
  readonly referenced: Set<string>
  readonly instancesByPath: Map<InstancePath, Instance>
  readonly diagnostics: Diagnostic[]
  /** A validated `each:` awaiting Pass 2's target resolution, keyed by the CHILD instance's own path. */
  readonly eachPending: Map<InstancePath, PendingEach>
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
    ctx.diagnostics.push(
      err(
        statePath(machineName, localName),
        `machine "${machineName}": local name "${localName}" must not contain "."`,
      ),
    )
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
  if (child === undefined) return
  if (def.each !== undefined) {
    const pending = validateEach(def.each, machineName, def.machine, localName, path, ctx)
    if (pending !== undefined) ctx.eachPending.set(child.path, pending)
  }
  children.push(child)
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
    ctx.diagnostics.push(
      err(
        machinePath(machineName),
        `machine reference cycle: ${[...ancestorChain, machineName].join(" → ")}`,
      ),
    )
    return undefined
  }
  const rawMachine = ctx.machinesRaw[machineName]
  if (rawMachine === undefined) {
    ctx.diagnostics.push(
      err(machinePath(machineName), `${unknownLocation}: unknown machine "${machineName}"`),
    )
    return undefined
  }
  if (!isPlainObject(rawMachine) || !isPlainObject(rawMachine["states"])) {
    ctx.diagnostics.push(
      err(machinePath(machineName), `machine "${machineName}": must declare a "states" mapping`),
    )
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
  path: readonly (string | number)[],
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): string | undefined => {
  const result = resolveCore(target, instance, instancesByPath, machinesRaw)
  const label = formatTrail(where, result.trail)
  if (result.kind === "ok") return result.value
  if (result.kind === "unbound") {
    diagnostics.push(err(path, `${label}: references unbound param "$${result.name}"`))
    return undefined
  }
  diagnostics.push(
    err(
      path,
      `${label}: "on" target "${target}" is not a state or reference of machine "${result.machine}" — declare a "params:" entry and bind it at the reference site`,
    ),
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
  diagnostics: Diagnostic[],
): string | undefined => {
  const result = resolveCore(target, instance, instancesByPath, machinesRaw)
  if (result.kind === "ok") return result.value
  if (result.kind === "unbound") {
    diagnostics.push(err(["entry"], `"${entryKey}" references unbound param "$${result.name}"`))
    return undefined
  }
  diagnostics.push(
    err(["entry"], `"${entryKey}" names "${target}", which is not a state or machine reference`),
  )
  return undefined
}

/** Substitute a WHOLE-value `$param` in any scalar field against `instance`'s own bindings — a literal splice, no scope-aware resolution. */
const substituteScalar = (
  value: unknown,
  instance: Instance,
  where: string,
  path: readonly (string | number)[],
  diagnostics: Diagnostic[],
): unknown => {
  if (typeof value !== "string") return value
  const m = PARAM_REF.exec(value)
  if (!m) return value
  const name = m[1]!
  const binding = instance.bindings[name]
  if (binding === undefined) {
    diagnostics.push(err(path, `${where}: references unbound param "$${name}"`))
    return value
  }
  return binding.value
}

/** Rewrite one object-form `on` row (`{ to, describe?, action? }`): `to` through the resolver, `describe`/`action` through whole-value `$param` substitution. */
const emitOnObjectEdge = (
  value: Record<string, unknown>,
  instance: Instance,
  where: string,
  path: readonly (string | number)[],
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...value }
  if (typeof value["to"] === "string") {
    next["to"] =
      resolveOnTarget(
        value["to"],
        instance,
        where,
        path,
        instancesByPath,
        machinesRaw,
        diagnostics,
      ) ?? value["to"]
  }
  if (typeof value["describe"] === "string") {
    next["describe"] = substituteScalar(value["describe"], instance, where, path, diagnostics)
  }
  if (typeof value["action"] === "string") {
    next["action"] = substituteScalar(value["action"], instance, where, path, diagnostics)
  }
  return next
}

/** Rewrite the `on` mapping — each row's target (string, or `{ to, describe, action }`) — through the resolver, preserving pattern keys and declaration order. */
const emitOn = (
  raw: unknown,
  instance: Instance,
  where: string,
  path: readonly (string | number)[],
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): unknown => {
  if (!isPlainObject(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [pattern, value] of Object.entries(raw)) {
    const edgePath = [...path, "on", pattern]
    if (typeof value === "string") {
      out[pattern] =
        resolveOnTarget(
          value,
          instance,
          where,
          edgePath,
          instancesByPath,
          machinesRaw,
          diagnostics,
        ) ?? value
    } else if (isPlainObject(value)) {
      out[pattern] = emitOnObjectEdge(
        value,
        instance,
        where,
        edgePath,
        instancesByPath,
        machinesRaw,
        diagnostics,
      )
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
  path: readonly (string | number)[],
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): unknown => {
  if (!isPlainObject(raw)) return raw
  const next: Record<string, unknown> = { ...raw }
  if (typeof raw["otherwise"] === "string") {
    next["otherwise"] =
      resolveOnTarget(
        raw["otherwise"],
        instance,
        where,
        [...path, "retry", "otherwise"],
        instancesByPath,
        machinesRaw,
        diagnostics,
      ) ?? raw["otherwise"]
  }
  return next
}

/** Rewrite the `routes` list — each row's `to` (a `RouteRow`'s only target-shaped field) through the resolver, same discipline as `emitRetry`'s `otherwise`; `question`/`is`/`minP` are left untouched (never target-shaped). */
const emitRoutes = (
  raw: unknown,
  instance: Instance,
  where: string,
  path: readonly (string | number)[],
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): unknown => {
  if (!Array.isArray(raw)) return raw
  return raw.map((rowRaw, i) => {
    if (!isPlainObject(rowRaw)) return rowRaw
    const next: Record<string, unknown> = { ...rowRaw }
    if (typeof rowRaw["to"] === "string") {
      next["to"] =
        resolveOnTarget(
          rowRaw["to"],
          instance,
          where,
          [...path, "routes", i, "to"],
          instancesByPath,
          machinesRaw,
          diagnostics,
        ) ?? rowRaw["to"]
    }
    return next
  })
}

const emitState = (
  stateRaw: unknown,
  instance: Instance,
  localName: string,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): Record<string, unknown> => {
  const where = `machines.${instance.machine}.${localName}`
  const path = statePath(instance.machine, localName)
  if (!isPlainObject(stateRaw)) {
    diagnostics.push(err(path, `${where}: state must be an object, got ${describeType(stateRaw)}`))
    return {}
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(stateRaw)) {
    if (key === "on") {
      out[key] = emitOn(value, instance, where, path, instancesByPath, machinesRaw, diagnostics)
      continue
    }
    if (key === "retry") {
      out[key] = emitRetry(value, instance, where, path, instancesByPath, machinesRaw, diagnostics)
      continue
    }
    if (key === "routes") {
      out[key] = emitRoutes(value, instance, where, path, instancesByPath, machinesRaw, diagnostics)
      continue
    }
    const resolved = substituteScalar(value, instance, where, [...path, key], diagnostics)
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
  diagnostics: Diagnostic[],
): Record<string, unknown> => {
  const resolved: Record<string, unknown> = {}
  for (const [key] of MACHINE_FIELD_ENTRIES) {
    const raw = rawMachine[key]
    if (raw === undefined) continue
    const substituted = substituteScalar(
      raw,
      instance,
      `machines.${instance.machine}`,
      [...machinePath(instance.machine), key],
      diagnostics,
    )
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
  diagnostics: Diagnostic[],
): void => {
  const rawMachine = machinesRaw[instance.machine] as Record<string, unknown>
  const statesRaw = rawMachine["states"] as Record<string, unknown>
  const resolvedFields = resolveInstanceMachineFields(rawMachine, instance, diagnostics)
  for (const [localName, local] of instance.locals) {
    if (local.kind !== "state") continue
    const qualified = qualify(instance.path, localName)
    const emitted = emitState(
      statesRaw[localName],
      instance,
      localName,
      instancesByPath,
      machinesRaw,
      diagnostics,
    )
    if (typeof emitted["prompt"] === "string") {
      Object.assign(emitted, resolvedFields)
    }
    states[qualified] = emitted
    scopes[qualified] = instance.path
  }
  for (const child of instance.children)
    emitTree(child, machinesRaw, states, scopes, instancesByPath, diagnostics)
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
 * Pass 2 for `each:`: resolve every pending `drained:` target against its
 * REFERRING (parent) instance — now that Pass 1 has finished, so every
 * instance the parent's own locals could name is already in
 * `instancesByPath` — and record the result on the CHILD instance `each:`
 * instantiated. A parent missing from `instancesByPath` means it failed to
 * instantiate itself (already reported); its pending `each:` entries are
 * silently dropped, same as any other finding downstream of an already-
 * reported Pass 1 failure.
 */
const resolveEachTargets = (
  eachPending: ReadonlyMap<InstancePath, PendingEach>,
  instancesByPath: ReadonlyMap<InstancePath, Instance>,
  machinesRaw: Record<string, unknown>,
  diagnostics: Diagnostic[],
): void => {
  for (const [childPath, pending] of eachPending) {
    const parent = instancesByPath.get(pending.parentPath)
    if (parent === undefined) continue
    const child = instancesByPath.get(childPath)
    if (child === undefined) continue
    const resolved = resolveOnTarget(
      pending.drainedRaw,
      parent,
      pending.where,
      pending.path,
      instancesByPath,
      machinesRaw,
      diagnostics,
    )
    if (resolved === undefined) continue
    // Already confirmed a string by `validateEach` — the CHILD instance's own
    // machine's `entry:`, resolved against the CHILD (where the loop enters
    // each item), not the parent `drained:` resolves against.
    const refEntry = (machinesRaw[pending.refMachine] as Record<string, unknown>)["entry"] as string
    const entry = resolveEntry(
      `${pending.where}.entry`,
      refEntry,
      child,
      instancesByPath,
      machinesRaw,
      diagnostics,
    )
    if (entry !== undefined) child.each = { source: pending.source, drained: resolved, entry }
  }
}

/**
 * Flatten a raw `entry:`/`machines:` config — a tree of reusable,
 * parameterized "machines" a workflow is authored with — into qualified
 * states, resolved entry points, and a visualization tree, so the rest of the
 * compiler and the pure engine only ever see ordinary qualified states.
 * Findings are collected into the returned `diagnostics`; a structurally
 * invalid `raw` (not an object, or missing `entry.default`) yields the
 * all-empty/`undefined` shape without attempting the passes.
 */
export const flattenMachines = (raw: unknown): FlattenedWorkflow => {
  const diagnostics: Diagnostic[] = []
  const instancesByPath = new Map<InstancePath, Instance>()
  const empty: FlattenedWorkflow = {
    states: {},
    entries: undefined,
    tree: undefined,
    scopes: {},
    instances: instancesByPath,
    diagnostics,
  }
  if (!isPlainObject(raw)) {
    diagnostics.push(err([], `workflow must be an object, got ${describeType(raw)}`))
    return empty
  }
  const entryRaw = raw["entry"]
  if (!isPlainObject(entryRaw) || typeof entryRaw["default"] !== "string") {
    diagnostics.push(err(["entry", "default"], `"entry.default" must name a machine`))
    return empty
  }
  const machinesRaw: Record<string, unknown> = isPlainObject(raw["machines"])
    ? (raw["machines"] as Record<string, unknown>)
    : {}

  const referenced = new Set<string>()
  const rootMachineName = entryRaw["default"]
  referenced.add(rootMachineName)
  const eachPending = new Map<InstancePath, PendingEach>()
  const ctx: InstantiateCtx = { machinesRaw, referenced, instancesByPath, diagnostics, eachPending }
  const root = instantiate(rootMachineName, "", [], {}, ctx, "entry.default")

  for (const name of Object.keys(machinesRaw)) {
    if (!referenced.has(name)) {
      diagnostics.push(err(machinePath(name), `machine "${name}" is declared but never referenced`))
    }
  }

  if (root === undefined) return empty

  validateNoNestedEach(eachPending, diagnostics)
  resolveEachTargets(eachPending, instancesByPath, machinesRaw, diagnostics)

  const states: Record<string, Record<string, unknown>> = {}
  const scopes: Record<string, InstancePath> = {}
  emitTree(root, machinesRaw, states, scopes, instancesByPath, diagnostics)
  const tree = buildTree(root)

  const rootMachine = machinesRaw[rootMachineName] as Record<string, unknown>
  const rootEntry = rootMachine["entry"]
  let defaultResolved: string | undefined
  if (typeof rootEntry === "string") {
    defaultResolved = resolveEntry(
      "entry.default",
      rootEntry,
      root,
      instancesByPath,
      machinesRaw,
      diagnostics,
    )
  } else {
    diagnostics.push(
      err(machinePath(rootMachineName), `machine "${rootMachineName}": "entry" must be a string`),
    )
  }

  if (defaultResolved === undefined)
    return { states, entries: undefined, tree, scopes, instances: instancesByPath, diagnostics }

  return {
    states,
    entries: { default: defaultResolved },
    tree,
    scopes,
    instances: instancesByPath,
    diagnostics,
  }
}
