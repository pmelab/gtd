/**
 * Compile-time SUB-MACHINE EXPANSION (Option C) — a raw → raw pre-pass that runs
 * at the very top of `compileWorkflowConfig` (src/PatternConfig.ts), BEFORE any
 * per-state compilation. It turns two OPTIONAL top-level `workflow:` keys —
 *
 * ```yaml
 * submachines:                 # reusable, parameterized clusters of states
 *   <name>:
 *     params: [<param>, ...]
 *     states: { <local>: <StateDef, with `$param` placeholders> }
 * use:                         # invocations, each expanded into concrete states
 *   - submachine: <name>
 *     as:   { <local>: <concreteName>, ... }   # rename map (default: identity)
 *     with: { <param>: <value>, ... }          # bind each `$param`
 *     set:  { <local>: { <field>: <value> } }  # extra per-instance state fields
 * ```
 *
 * — into ordinary concrete `states`, then strips `submachines`/`use` from its
 * output so the rest of the compiler (and `KNOWN_TOP_KEYS`) only ever sees the
 * familiar `{ vars?, states, modes? }` shape. The pure engine (`PatternMachine`)
 * is entirely unaware sub-machines exist: expansion is a source-authoring
 * convenience with NO runtime footprint. Aliasing
 * each invocation's local state names (via `as:`) to the exact concrete names a
 * hand-written workflow would use makes the expanded definition BYTE-IDENTICAL to
 * the flat one — the guarantee the bundled template's golden test pins
 * (src/workflows/templates.test.ts).
 *
 * ## Two uses of one mechanism
 *
 * - **Dedup** — a multi-instance sub-machine (a gate/loop authored once, invoked
 *   several times with different `with:`/`as:`) removes duplicated states.
 * - **Encapsulation** — a single-instance sub-machine groups a complex cluster
 *   into one named block for source comprehension. It expands 1:1, so it has no
 *   runtime effect; its value is authoring clarity (and a hook for a future
 *   viewer).
 *
 * ## Substitution
 *
 * A `$name` token is resolved from the invocation's `with:` bindings. It is
 * matched ONLY as a WHOLE string value — a field whose entire value is `$name`,
 * or an `on`/`retry.otherwise` target that is exactly `$name` — never as a
 * substring, so bash `$var`/`${var}` inside a `script:` and Eta
 * `<%= it.vars.x %>` inside any content are left untouched. Text that varies per
 * instance (a message, a describe sentence, a prompt) is therefore passed WHOLE
 * as a `$name` binding, not spliced in.
 *
 * An `on`/`retry.otherwise` target that names one of the sub-machine's OWN local
 * states is rewritten through the `as:` rename map (so intra-cluster edges point
 * at the renamed concrete states); any other target passes through verbatim (it
 * names a concrete top-level state, resolved after the merge). `on` PATTERN keys
 * are never touched (they are literal, exactly as the engine treats them).
 *
 * All findings are collected into the shared `errors` array the caller threads
 * through, aggregated with every other config-shape/validation finding into the
 * single error `compileWorkflowConfig` throws — a bad `submachines:`/`use:` fails
 * loudly at load time, never at step time.
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const describeType = (v: unknown): string => {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

/** A whole-value parameter reference: a string that is EXACTLY `$name`. */
const PARAM_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/

const KNOWN_SUBMACHINE_KEYS: ReadonlySet<string> = new Set(["params", "states"])
const KNOWN_INVOCATION_KEYS: ReadonlySet<string> = new Set([
  "submachine",
  "as",
  "with",
  "set",
  "name",
])

interface ExpansionContext {
  /** The sub-machine's own local state names, for target-rename detection. */
  readonly locals: ReadonlySet<string>
  /** local -> concrete rename map (identity for any local not listed). */
  readonly as: Readonly<Record<string, string>>
  /** param name -> bound value. */
  readonly params: Readonly<Record<string, unknown>>
  /** Where we are, for error messages, e.g. `use[0] (assertGreen)`. */
  readonly where: string
}

/** Rewrite an `on`/`retry.otherwise` target: a local -> its concrete name, a `$param` -> its binding, anything else verbatim. */
const resolveTarget = (target: string, ctx: ExpansionContext, errors: string[]): string => {
  const m = PARAM_REF.exec(target)
  if (m) {
    const value = ctx.params[m[1]!]
    if (value === undefined) {
      errors.push(`${ctx.where}: target references unbound param "$${m[1]}"`)
      return target
    }
    if (typeof value !== "string") {
      errors.push(`${ctx.where}: param "$${m[1]}" used as a target must be a string`)
      return target
    }
    return value
  }
  if (ctx.locals.has(target)) return ctx.as[target] ?? target
  return target
}

/** Substitute a WHOLE-value `$param` in any scalar string field; non-`$param` strings and non-strings pass through unchanged. */
const substituteScalar = (value: unknown, ctx: ExpansionContext, errors: string[]): unknown => {
  if (typeof value !== "string") return value
  const m = PARAM_REF.exec(value)
  if (!m) return value
  const bound = ctx.params[m[1]!]
  if (bound === undefined) {
    errors.push(`${ctx.where}: references unbound param "$${m[1]}"`)
    return value
  }
  return bound
}

/** Rewrite the `on` mapping — each row's target (string, or `{ to, describe }`) — preserving pattern keys and declaration order. */
const expandOn = (raw: unknown, ctx: ExpansionContext, errors: string[]): unknown => {
  if (!isPlainObject(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [pattern, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      out[pattern] = resolveTarget(value, ctx, errors)
    } else if (isPlainObject(value)) {
      const next: Record<string, unknown> = { ...value }
      if (typeof value["to"] === "string") next["to"] = resolveTarget(value["to"], ctx, errors)
      if (typeof value["describe"] === "string")
        next["describe"] = substituteScalar(value["describe"], ctx, errors)
      if (typeof value["action"] === "string")
        next["action"] = substituteScalar(value["action"], ctx, errors)
      out[pattern] = next
    } else {
      out[pattern] = value
    }
  }
  return out
}

/** Rewrite a `retry` block's `otherwise` target (and pass `max` through). */
const expandRetry = (raw: unknown, ctx: ExpansionContext, errors: string[]): unknown => {
  if (!isPlainObject(raw)) return raw
  const next: Record<string, unknown> = { ...raw }
  if (typeof raw["otherwise"] === "string")
    next["otherwise"] = resolveTarget(raw["otherwise"], ctx, errors)
  return next
}

/** Clone one sub-machine local state, applying param substitution and target rewriting. */
const expandState = (
  stateRaw: unknown,
  ctx: ExpansionContext,
  errors: string[],
): Record<string, unknown> => {
  if (!isPlainObject(stateRaw)) {
    errors.push(`${ctx.where}: sub-machine state must be an object, got ${describeType(stateRaw)}`)
    return {}
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(stateRaw)) {
    if (key === "on") out[key] = expandOn(value, ctx, errors)
    else if (key === "retry") out[key] = expandRetry(value, ctx, errors)
    else out[key] = substituteScalar(value, ctx, errors)
  }
  return out
}

/** Validate the `submachines:` map's shape (findings pushed onto `errors`), returning it best-effort. */
const readSubmachines = (
  raw: unknown,
  declared: boolean,
  errors: string[],
): Record<string, unknown> => {
  const submachines: Record<string, unknown> = isPlainObject(raw) ? raw : {}
  if (declared && !isPlainObject(raw)) {
    errors.push(
      `"submachines" must be a mapping of name -> { params, states }, got ${describeType(raw)}`,
    )
  }
  for (const [name, sm] of Object.entries(submachines)) {
    if (!isPlainObject(sm)) {
      errors.push(`submachine "${name}": must be an object with "params" and "states"`)
      continue
    }
    const unknown = Object.keys(sm).filter((k) => !KNOWN_SUBMACHINE_KEYS.has(k))
    if (unknown.length > 0)
      errors.push(`submachine "${name}": unknown key(s) ${unknown.join(", ")}`)
    if (!isPlainObject(sm["states"]) || Object.keys(sm["states"] as object).length === 0)
      errors.push(`submachine "${name}": "states" must be a non-empty mapping`)
  }
  return submachines
}

/** Read one invocation's `as:` rename map (local -> concrete), validating against the sub-machine's locals. */
const readAs = (
  raw: unknown,
  smStates: Record<string, unknown>,
  where: string,
  errors: string[],
): Record<string, string> => {
  const as: Record<string, string> = {}
  if (raw === undefined) return as
  if (!isPlainObject(raw)) {
    errors.push(`${where}: "as" must be a mapping of local -> concrete name`)
    return as
  }
  for (const [local, concrete] of Object.entries(raw)) {
    if (typeof concrete !== "string") {
      errors.push(`${where}: "as.${local}" must be a string`)
      continue
    }
    if (!(local in smStates)) errors.push(`${where}: "as" names "${local}", not a state of it`)
    as[local] = concrete
  }
  return as
}

/** Read one invocation's `set:` overrides (local -> extra fields), validating against the sub-machine's locals. */
const readSet = (
  raw: unknown,
  smStates: Record<string, unknown>,
  where: string,
  errors: string[],
): Record<string, Record<string, unknown>> => {
  const set: Record<string, Record<string, unknown>> = {}
  if (raw === undefined) return set
  if (!isPlainObject(raw)) {
    errors.push(`${where}: "set" must be a mapping of local -> { field: value }`)
    return set
  }
  for (const [local, fields] of Object.entries(raw)) {
    if (!isPlainObject(fields)) {
      errors.push(`${where}: "set.${local}" must be an object of extra fields`)
      continue
    }
    if (!(local in smStates)) errors.push(`${where}: "set" names "${local}", not a state of it`)
    set[local] = fields
  }
  return set
}

/** One invocation's validated, resolved parts: the sub-machine's local states, a scope label for errors, and the raw invocation object (for `as`/`with`/`set`). */
interface ResolvedInvocation {
  readonly smStates: Record<string, unknown>
  readonly scope: string
  readonly invocation: Record<string, unknown>
}

/** Validate one invocation's shape and resolve its named sub-machine; `undefined` (with a finding) on anything malformed. */
const resolveInvocation = (
  invRaw: unknown,
  index: number,
  submachines: Record<string, unknown>,
  errors: string[],
): ResolvedInvocation | undefined => {
  const where = `use[${index}]`
  if (!isPlainObject(invRaw)) {
    errors.push(`${where}: each invocation must be an object with a "submachine" key`)
    return undefined
  }
  const unknown = Object.keys(invRaw).filter((k) => !KNOWN_INVOCATION_KEYS.has(k))
  if (unknown.length > 0) errors.push(`${where}: unknown key(s) ${unknown.join(", ")}`)
  const smName = invRaw["submachine"]
  if (typeof smName !== "string") {
    errors.push(`${where}: "submachine" must be a string naming a declared sub-machine`)
    return undefined
  }
  const sm = submachines[smName]
  if (!isPlainObject(sm) || !isPlainObject(sm["states"])) {
    errors.push(`${where}: unknown sub-machine "${smName}"`)
    return undefined
  }
  return {
    smStates: sm["states"] as Record<string, unknown>,
    scope: `${where} (${smName})`,
    invocation: invRaw,
  }
}

/** Clone each local state into its concrete name, claiming names (collision → finding) and applying `set:` overrides. */
const produceStates = (
  smStates: Record<string, unknown>,
  ctx: ExpansionContext,
  set: Record<string, Record<string, unknown>>,
  claimed: Set<string>,
  errors: string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [local, stateRaw] of Object.entries(smStates)) {
    const concrete = ctx.as[local] ?? local
    if (claimed.has(concrete)) {
      errors.push(
        `${ctx.where}: expands to state "${concrete}", which collides with an existing state`,
      )
      continue
    }
    claimed.add(concrete)
    const state = expandState(stateRaw, ctx, errors)
    const overrides = set[local]
    out[concrete] = overrides !== undefined ? { ...state, ...overrides } : state
  }
  return out
}

/**
 * Expand ONE `use:` invocation into concrete states, tracking claimed names in
 * `claimed` (mutated) and pushing findings onto `errors`. Returns the produced
 * `concreteName -> stateDef` map (empty on a malformed invocation).
 */
const expandInvocation = (
  invRaw: unknown,
  index: number,
  submachines: Record<string, unknown>,
  claimed: Set<string>,
  errors: string[],
): Record<string, unknown> => {
  const resolved = resolveInvocation(invRaw, index, submachines, errors)
  if (resolved === undefined) return {}
  const { smStates, scope, invocation } = resolved

  const as = readAs(invocation["as"], smStates, scope, errors)
  const withRaw = invocation["with"]
  const params: Record<string, unknown> = isPlainObject(withRaw) ? withRaw : {}
  if (withRaw !== undefined && !isPlainObject(withRaw))
    errors.push(`${scope}: "with" must be a mapping of param -> value`)
  const set = readSet(invocation["set"], smStates, scope, errors)

  const ctx: ExpansionContext = { locals: new Set(Object.keys(smStates)), as, params, where: scope }
  return produceStates(smStates, ctx, set, claimed, errors)
}

/**
 * Expand `submachines:`/`use:` into concrete `states`. Returns a NEW raw object
 * with those two keys removed and `states` augmented; a non-object input, or one
 * declaring NEITHER key, is returned unchanged (so ordinary workflows are a
 * pure passthrough). Findings are pushed onto `errors`.
 */
export const expandSubmachines = (raw: unknown, errors: string[]): unknown => {
  if (!isPlainObject(raw)) return raw
  if (raw["submachines"] === undefined && raw["use"] === undefined) return raw

  const submachines = readSubmachines(raw["submachines"], raw["submachines"] !== undefined, errors)
  const useRaw = raw["use"]
  const invocations: unknown[] = Array.isArray(useRaw) ? useRaw : []
  if (raw["use"] !== undefined && !Array.isArray(useRaw))
    errors.push(`"use" must be an array of invocations, got ${describeType(useRaw)}`)

  // Start from any explicitly-authored states; track names for collision checks.
  const baseStates: Record<string, unknown> = isPlainObject(raw["states"])
    ? { ...(raw["states"] as Record<string, unknown>) }
    : {}
  const claimed = new Set<string>(Object.keys(baseStates))
  const expanded: Record<string, unknown> = {}
  invocations.forEach((invRaw, index) => {
    Object.assign(expanded, expandInvocation(invRaw, index, submachines, claimed, errors))
  })

  const result: Record<string, unknown> = { ...raw, states: { ...baseStates, ...expanded } }
  delete result["submachines"]
  delete result["use"]
  return result
}

/** One expanded sub-machine invocation, described for visualization (see `collectGroups`). */
export interface SubmachineGroup {
  /** The sub-machine this invocation instantiates. */
  readonly submachine: string
  /** A human label for the instance: the invocation's `name:`, else the sub-machine name (disambiguated with `#i` when it is invoked more than once). */
  readonly name: string
  /** The concrete state names this invocation produced (locals resolved through `as:`), in declaration order. */
  readonly states: readonly string[]
}

/**
 * Describe a raw workflow's `use:` invocations as visualization GROUPS — which
 * concrete states each sub-machine invocation produced — WITHOUT expanding or
 * validating (a best-effort read for tooling like `gtd visualize`; malformed
 * entries are skipped, not reported). A workflow with no `use:` yields `[]`.
 * This is the only way to recover the sub-machine grouping after
 * `compileWorkflowConfig` has flattened it away.
 */
export const collectGroups = (raw: unknown): SubmachineGroup[] => {
  if (!isPlainObject(raw)) return []
  const submachines = isPlainObject(raw["submachines"]) ? raw["submachines"] : {}
  const use = Array.isArray(raw["use"]) ? raw["use"] : []
  const smUseCount = new Map<string, number>()
  for (const inv of use) {
    if (isPlainObject(inv) && typeof inv["submachine"] === "string")
      smUseCount.set(inv["submachine"], (smUseCount.get(inv["submachine"]) ?? 0) + 1)
  }
  const groups: SubmachineGroup[] = []
  use.forEach((inv, index) => {
    if (!isPlainObject(inv)) return
    const smName = inv["submachine"]
    if (typeof smName !== "string") return
    const sm = submachines[smName]
    if (!isPlainObject(sm) || !isPlainObject(sm["states"])) return
    const smStates = sm["states"] as Record<string, unknown>
    const as = isPlainObject(inv["as"]) ? inv["as"] : {}
    const states = Object.keys(smStates).map((local) =>
      typeof as[local] === "string" ? (as[local] as string) : local,
    )
    const name =
      typeof inv["name"] === "string"
        ? inv["name"]
        : (smUseCount.get(smName) ?? 0) > 1
          ? `${smName}#${index}`
          : smName
    groups.push({ submachine: smName, name, states })
  })
  return groups
}
