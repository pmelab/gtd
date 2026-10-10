import { isSettingName, SETTING_NAME_RULE } from "./vars.js"
import { seededValidateCommand } from "./SteeringFormats.js"
import { BUILT_IN_MODE_NAMES } from "../steering/index.js"
import type { ModeDef } from "./Workflow.js"
import type { ScopeAccess } from "../flows/index.js"
import { accessShapeFault } from "../replay/index.js"
import type { JudgeConfig, UiConfig } from "./ConfigSchema.js"
import {
  BUILT_IN_ORIGIN,
  dedupeDiagnostics,
  sortDiagnostics,
  type Diagnostic,
} from "./Diagnostic.js"

/**
 * One config layer: the raw, parsed-but-undecoded content of a single
 * `.gtdrc`-family file, plus `origin` (its filepath — the string every
 * `Diagnostic.origin` from this layer is stamped with). Ordered outermost
 * (furthest ancestor / home) to innermost (closest to the repo root) — the
 * same order `sortDiagnostics` expects its `layerOrder` argument in.
 */
export interface ConfigLayer {
  readonly origin: string
  readonly dir: string
  readonly value: unknown
}

export interface CompiledConfig {
  readonly rcVars: Record<string, string>
  readonly rcEnv: Record<string, string>
  /** Every well-shaped `vars:` key of every layer, with that layer's origin — so `load.ts`'s wrong-kind check names each file. */
  readonly varsKeys: readonly { readonly key: string; readonly origin: string }[]
  /** The same, for `env:`. */
  readonly envKeys: readonly { readonly key: string; readonly origin: string }[]
  readonly judge?: JudgeConfig
  /** The built-in modes (qa/review, with gtd's own validators) merged with every layer's `modes:`, per half. */
  readonly modes: Record<string, ModeDef>
  readonly ui?: UiConfig
  /** The `.gtdrc` `skills:` map, shape-validated but NOT yet checked against the workflow's own step names — that check needs the loaded workflow, so it runs in `../workflow/load.ts` instead. */
  readonly rcSkills: Record<string, readonly string[]>
  /** Every well-shaped `skills:` key of every layer, with that layer's origin — so `load.ts`'s unknown-step-name check reports each file, not just the innermost. */
  readonly skillsKeys: readonly { readonly key: string; readonly origin: string }[]
  /** The `.gtdrc` `access:` map, shape-validated; its keys are checked against the workflow's scopes in `skills.ts`. */
  readonly access: Record<string, ScopeAccess>
  /** Every well-shaped `access:` key of every layer, with that layer's origin. */
  readonly accessKeys: readonly { readonly key: string; readonly origin: string }[]
  /** Every finding across every layer — sorted (origin outermost→innermost, then config path) and deduped. */
  readonly diagnostics: readonly Diagnostic[]
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const describeType = (v: unknown): string => {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean"

const err = (path: readonly (string | number)[], message: string): Diagnostic => ({
  severity: "error",
  message,
  path,
  origin: "",
})

/** A flat `name -> scalar` map; a malformed value is a load error and is dropped. */
const compileVarsMap = (
  raw: unknown,
  keyName: "vars" | "env",
): { readonly vars: Record<string, string>; readonly diagnostics: readonly Diagnostic[] } => {
  const diagnostics: Diagnostic[] = []
  if (raw === undefined) return { vars: {}, diagnostics }
  if (!isPlainObject(raw)) {
    diagnostics.push(
      err(
        [keyName],
        `"${keyName}" must be a mapping of name -> scalar value, got ${describeType(raw)}`,
      ),
    )
    return { vars: {}, diagnostics }
  }
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isSettingName(key)) {
      diagnostics.push(
        err(
          [keyName],
          `"${keyName}" key ${JSON.stringify(key)} is not a valid setting name — ${SETTING_NAME_RULE}`,
        ),
      )
      continue
    }
    if (!isScalar(value)) {
      diagnostics.push(
        err(
          [keyName, key],
          `"${keyName}.${key}" must be a string, number, or boolean, got ${describeType(value)}`,
        ),
      )
      continue
    }
    vars[key] = String(value)
  }
  return { vars, diagnostics }
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((entry) => typeof entry === "string")

/** A flat `scope full name -> skill list` map; a malformed value is a load error and is dropped. */
const compileSkillsMap = (
  raw: unknown,
): {
  readonly skills: Record<string, readonly string[]>
  readonly diagnostics: readonly Diagnostic[]
} => {
  const diagnostics: Diagnostic[] = []
  if (raw === undefined) return { skills: {}, diagnostics }
  if (!isPlainObject(raw)) {
    diagnostics.push(
      err(
        ["skills"],
        `"skills" must be a mapping of scope name -> array of skill names, got ${describeType(raw)}`,
      ),
    )
    return { skills: {}, diagnostics }
  }
  // Null prototype: a `__proto__` key must stay an ordinary (reportable) entry.
  const skills: Record<string, readonly string[]> = Object.create(null)
  for (const [key, value] of Object.entries(raw)) {
    if (!isStringArray(value)) {
      diagnostics.push(
        err(
          ["skills", key],
          `"skills.${key}" must be an array of skill names (strings), got ${describeType(value)}`,
        ),
      )
      continue
    }
    skills[key] = value
  }
  return { skills, diagnostics }
}

/** A flat `scope full name -> { read?, write? }` map; a malformed value is a load error and is dropped. */
const compileAccessMap = (
  raw: unknown,
): {
  readonly access: Record<string, ScopeAccess>
  readonly diagnostics: readonly Diagnostic[]
} => {
  const diagnostics: Diagnostic[] = []
  if (raw === undefined) return { access: {}, diagnostics }
  if (!isPlainObject(raw)) {
    diagnostics.push(
      err(
        ["access"],
        `"access" must be a mapping of scope name -> { read?, write? }, got ${describeType(raw)}`,
      ),
    )
    return { access: {}, diagnostics }
  }
  const access: Record<string, ScopeAccess> = Object.create(null)
  for (const [key, value] of Object.entries(raw)) {
    const fault = accessShapeFault(value)
    if (fault === undefined) access[key] = value as ScopeAccess
    else diagnostics.push(err(["access", key], `"access.${key}": ${fault}`))
  }
  return { access, diagnostics }
}

/** The `.gtdrc` `access:` load-error message for a key that is not a known scope. */
export const unknownAccessKeyMessage = (key: string, known: readonly string[]): string =>
  `"access.${key}" is not a scope that runs a turn — known scopes: ${known.join(", ")}`

/** The `.gtdrc` `skills:` load-error message for a key that is not a known scope. */
export const unknownSkillsKeyMessage = (key: string, known: readonly string[]): string =>
  `"skills.${key}" is not a scope that runs a turn — known scopes: ${known.join(", ")}`

const MODE_COMMAND_KEYS = ["format", "validate"] as const

/** One `modes:` entry; malformed entries are load errors and are dropped. */
const compileMode = (
  name: string,
  entry: unknown,
  diagnostics: Diagnostic[],
): ModeDef | undefined => {
  if (!isPlainObject(entry)) {
    diagnostics.push(
      err(
        ["modes", name],
        `mode "${name}": must be an object with "format" and/or "validate", got ${describeType(entry)}`,
      ),
    )
    return undefined
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
    } else if (command.trim() === "") {
      diagnostics.push(
        err(["modes", name, key], `mode "${name}": "${key}" must be a non-empty shell command`),
      )
    } else {
      commands[key] = command
    }
  }
  return commands
}

const compileModesMap = (
  raw: unknown,
): { readonly modes: Record<string, ModeDef>; readonly diagnostics: readonly Diagnostic[] } => {
  const diagnostics: Diagnostic[] = []
  if (raw === undefined) return { modes: {}, diagnostics }
  if (!isPlainObject(raw)) {
    diagnostics.push(
      err(
        ["modes"],
        `"modes" must be a mapping of mode name -> { format, validate }, got ${describeType(raw)}`,
      ),
    )
    return { modes: {}, diagnostics }
  }
  const modes: Record<string, ModeDef> = {}
  for (const [name, entry] of Object.entries(raw)) {
    if (name === "") diagnostics.push(err(["modes"], `"modes" declares a mode with an empty name`))
    const mode = compileMode(name, entry, diagnostics)
    if (mode !== undefined) modes[name] = mode
  }
  return { modes, diagnostics }
}

/** Layer one `modes:` map over another, per half: an override's `format:`/`validate:` wins, a half it leaves out keeps the base's. */
const mergeModes = (
  base: Readonly<Record<string, ModeDef>>,
  override: Readonly<Record<string, ModeDef>>,
): Record<string, ModeDef> => {
  const merged: Record<string, ModeDef> = { ...base }
  for (const [name, entry] of Object.entries(override)) merged[name] = { ...merged[name], ...entry }
  return merged
}

/**
 * One config PATH's origin tree node: `self` is the innermost layer that
 * contributed ANYTHING under this node (whether it replaced the whole
 * subtree wholesale, or only merged one nested key deeper); `children`,
 * present whenever this node's value is itself a plain object, gives each
 * key's own more specific node. A path that runs out of `children` before it
 * runs out of segments (e.g. a key no layer declared at all, or a leaf under
 * an object) resolves to the nearest ancestor's `self` — the innermost layer
 * that touched that ENCLOSING subtree, never a fixed fallback constant.
 */
interface OriginNode {
  readonly self: string
  readonly children?: Readonly<Record<string, OriginNode>>
}

/** Stamp a whole (possibly deeply nested) value with ONE origin, recursively — used when `inner` replaces `base` wholesale: every key inside still needs its own node, or a LATER layer partially overriding just one nested key would silently lose the rest of this subtree's origin. */
const uniformOrigin = (value: unknown, origin: string): OriginNode => {
  if (!isPlainObject(value)) return { self: origin }
  const children: Record<string, OriginNode> = {}
  for (const [key, v] of Object.entries(value)) children[key] = uniformOrigin(v, origin)
  return { self: origin, children }
}

/**
 * Deep-merge `base`/`inner` (identical rule to a plain `deepMerge`:
 * recurses only when BOTH sides are plain objects, `inner` overwrites
 * otherwise) while tracking WHICH layer each resulting path came from —
 * the piece a single per-top-level-key origin map can't express: two layers
 * each contributing DIFFERENT nested keys under the same top-level key
 * (`vars`, `modes`, `workflow`) need different origins for their own
 * findings, not one origin for the whole merged key.
 */
const mergeWithOrigin = (
  base: unknown,
  baseOrigin: OriginNode | undefined,
  inner: unknown,
  innerOrigin: string,
): { readonly value: unknown; readonly origin: OriginNode } => {
  if (!isPlainObject(base) || !isPlainObject(inner)) {
    return { value: inner, origin: uniformOrigin(inner, innerOrigin) }
  }
  const value: Record<string, unknown> = { ...base }
  const children: Record<string, OriginNode> = { ...baseOrigin?.children }
  for (const [key, innerVal] of Object.entries(inner)) {
    const merged = mergeWithOrigin(base[key], baseOrigin?.children?.[key], innerVal, innerOrigin)
    value[key] = merged.value
    children[key] = merged.origin
  }
  // `self` is always THIS call's `innerOrigin`: reaching this call at all
  // means `inner` (the current layer) contributed something here, whether
  // wholesale or merged deeper — so it is, by construction, the innermost
  // layer that touched this subtree so far.
  return { value, origin: { self: innerOrigin, children } }
}

/**
 * Walk `path` down through `tree` as far as recorded `children` go, then
 * return whichever node was last reached's `self` — the innermost layer
 * that touched that node's ENCLOSING subtree. Never falls back to a fixed
 * constant: `tree` itself always has a `self` (the innermost layer overall,
 * or `BUILT_IN_ORIGIN` when the fold below never ran because there are no
 * layers at all), so the walk always resolves to a real origin.
 */
const originAt = (tree: OriginNode, path: readonly (string | number)[]): string => {
  let node = tree
  for (const segment of path) {
    const next = node.children?.[String(segment)]
    if (next === undefined) break
    node = next
  }
  return node.self
}

const withOrigin = (
  diagnostics: readonly Diagnostic[],
  lookup: (path: readonly (string | number)[]) => string,
): Diagnostic[] => diagnostics.map((d) => ({ ...d, origin: lookup(d.path) }))

const layerKeys = (
  layers: readonly ConfigLayer[],
  name: "vars" | "env",
): { key: string; origin: string }[] =>
  layers.flatMap((layer) => {
    const own = isPlainObject(layer.value) ? layer.value[name] : undefined
    return isPlainObject(own) ? Object.keys(own).map((key) => ({ key, origin: layer.origin })) : []
  })

/**
 * Merge every layer outermost→innermost and compile what a `.gtdrc` may carry:
 * `vars`, `env`, `judge`, `modes` and `ui`. A workflow is defined only in `gtd.config.ts`, so a
 * leftover `workflow:` key is an error pointing there. Pure and total.
 */
export const compileConfig = (layers: readonly ConfigLayer[]): CompiledConfig => {
  const layerOrder = layers.map((l) => l.origin)
  const diagnostics: Diagnostic[] = []
  let merged: unknown = {}
  let originTree: OriginNode = { self: BUILT_IN_ORIGIN }
  for (const layer of layers) {
    const value = isPlainObject(layer.value) ? layer.value : {}
    const step = mergeWithOrigin(merged, originTree, value, layer.origin)
    merged = step.value
    originTree = step.origin
  }
  const mergedConfig = merged as Record<string, unknown>
  const lookupIn = (path: readonly (string | number)[]): string => originAt(originTree, path)

  const ui = mergedConfig["ui"] as UiConfig | undefined
  const judge = mergedConfig["judge"] as JudgeConfig | undefined
  const { vars: rcVars, diagnostics: varsDiagnostics } = compileVarsMap(
    mergedConfig["vars"],
    "vars",
  )
  diagnostics.push(...withOrigin(varsDiagnostics, lookupIn))
  const { vars: rcEnv, diagnostics: envDiagnostics } = compileVarsMap(mergedConfig["env"], "env")
  diagnostics.push(...withOrigin(envDiagnostics, lookupIn))
  const varsKeys = layerKeys(layers, "vars")
  const envKeys = layerKeys(layers, "env")
  const { modes: rcModes, diagnostics: modesDiagnostics } = compileModesMap(mergedConfig["modes"])
  diagnostics.push(...withOrigin(modesDiagnostics, lookupIn))
  // Validated per layer, before merging: a nearer layer's good entry must not
  // hide an outer layer's broken one.
  const skillsKeys: { key: string; origin: string }[] = []
  for (const layer of layers) {
    if (!isPlainObject(layer.value)) continue
    const own = compileSkillsMap(layer.value["skills"])
    diagnostics.push(...own.diagnostics.map((d) => ({ ...d, origin: layer.origin })))
    skillsKeys.push(...Object.keys(own.skills).map((key) => ({ key, origin: layer.origin })))
  }
  const { skills: rcSkills } = compileSkillsMap(mergedConfig["skills"])
  const accessKeys: { key: string; origin: string }[] = []
  for (const layer of layers) {
    if (!isPlainObject(layer.value)) continue
    const own = compileAccessMap(layer.value["access"])
    diagnostics.push(...own.diagnostics.map((d) => ({ ...d, origin: layer.origin })))
    accessKeys.push(...Object.keys(own.access).map((key) => ({ key, origin: layer.origin })))
  }
  const { access: rcAccess } = compileAccessMap(mergedConfig["access"])
  const seeded = Object.fromEntries(
    BUILT_IN_MODE_NAMES.map((name) => [name, { validate: seededValidateCommand(name) }]),
  )
  return {
    rcVars,
    rcEnv,
    varsKeys,
    envKeys,
    ...(judge !== undefined ? { judge } : {}),
    modes: mergeModes(seeded, rcModes),
    ...(ui !== undefined ? { ui } : {}),
    rcSkills,
    skillsKeys,
    access: rcAccess,
    accessKeys,
    diagnostics: dedupeDiagnostics(sortDiagnostics(diagnostics, layerOrder)),
  }
}
