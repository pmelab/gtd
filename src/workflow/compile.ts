import {
  compileModesMap,
  compileVarsMap,
  compileWorkflowConfig,
  inlineWorkflowFileRefs,
  mergeModes,
  type ReadFile,
} from "../PatternConfig.js"
import { validateDefinition, type StateName, type WorkflowDefinition } from "../PatternMachine.js"
import type { MachineNode } from "../Machines.js"
import {
  defaultMachineTree,
  defaultStateScopes,
  defaultWorkflowDefinition,
  defaultWorkflowVars,
} from "../workflows/index.js"
import {
  BUILT_IN_ORIGIN,
  dedupeDiagnostics,
  sortDiagnostics,
  type Diagnostic,
} from "./Diagnostic.js"
import type { UiConfig } from "../ConfigSchema.js"
import type { WorkflowFiles } from "./WorkflowFiles.js"

/**
 * One config layer: the raw, parsed-but-undecoded content of a single
 * `.gtdrc`-family file, plus `origin` (its filepath — the string every
 * `Diagnostic.origin` from this layer is stamped with) and `dir` (its own
 * directory — a `./`/`../` content reference in THIS layer's `workflow:`
 * resolves against `dir`, never against a child repo's cwd or another
 * layer's directory). Ordered outermost (furthest ancestor / home) to
 * innermost (closest to the repo root) — the same order `sortDiagnostics`
 * expects its `layerOrder` argument in.
 */
export interface ConfigLayer {
  readonly origin: string
  readonly dir: string
  readonly value: unknown
}

export interface CompiledWorkflow {
  readonly workflow: WorkflowDefinition
  readonly workflowVars: Record<string, string>
  readonly rcVars: Record<string, string>
  readonly machineTree: MachineNode
  readonly stateScopes: Record<StateName, string>
  /** The merged top-level `ui:` key, already decoded per layer by `ConfigSchema` (absent when unconfigured) — `gtd ui` and its CLI flags read it. */
  readonly ui?: UiConfig
  /** Every finding across every layer/phase — sorted (origin outermost→innermost, `(built-in default)` last, then config path) and deduped by `(severity, path, message)`. */
  readonly diagnostics: readonly Diagnostic[]
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

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

/**
 * The pure compile boundary: merge every layer's `workflow:` (inlining its
 * `./`/`../` content file references against ITS OWN `dir` first, via
 * `files.read` — a plain sync port, not an `Effect.Tag`, so this function
 * stays sync and total), deep-merge outermost→innermost, then compile. Never
 * throws and never performs any effectful IO of its own — `files.read` is
 * the one seam, injected by the caller (`load`, in production; a fake in a
 * test), exactly like `compileWorkflowConfig`'s own `readFile` parameter.
 */
export const compileWorkflow = (
  layers: readonly ConfigLayer[],
  files: WorkflowFiles,
): CompiledWorkflow => {
  const readFile: ReadFile = files.read
  const layerOrder = layers.map((l) => l.origin)
  const diagnostics: Diagnostic[] = []

  // Inline each layer's own `workflow:` file references against its own
  // `dir`, THEN merge — the merge collapses every layer into one anonymous
  // object, erasing which file a given path came from, so resolving up
  // front is the only way an outer layer's reference resolves against its
  // own directory rather than an inner repo's cwd.
  const inlinedLayers = layers.map((layer) => {
    if (!isPlainObject(layer.value) || layer.value["workflow"] === undefined) {
      return isPlainObject(layer.value) ? layer.value : {}
    }
    const { value: workflow, diagnostics: refDiagnostics } = inlineWorkflowFileRefs(
      layer.value["workflow"],
      layer.dir,
      readFile,
    )
    diagnostics.push(...withOrigin(refDiagnostics, () => layer.origin))
    return { ...layer.value, workflow }
  })

  // Merge outermost→innermost, tracking per-PATH provenance as we go — NOT
  // just which layer last touched each TOP-LEVEL key: two layers may each
  // contribute different nested keys under the same `vars:`/`modes:`/
  // `workflow:`, and a finding inside one must name that layer, not
  // whichever layer happens to be innermost for the key as a whole.
  let merged: unknown = {}
  // No real layer yet — `BUILT_IN_ORIGIN` here only matters if `layers` is
  // empty AND some diagnostic somehow has a path (it won't: the empty-layers
  // case takes the `mergedConfig["workflow"] === undefined` branch below,
  // whose own findings are stamped `BUILT_IN_ORIGIN` directly).
  let originTree: OriginNode = { self: BUILT_IN_ORIGIN }
  for (let i = 0; i < inlinedLayers.length; i++) {
    const layer = layers[i]!
    const step = mergeWithOrigin(merged, originTree, inlinedLayers[i], layer.origin)
    merged = step.value
    originTree = step.origin
  }
  const mergedConfig = merged as Record<string, unknown>
  const lookupIn = (path: readonly (string | number)[]): string => originAt(originTree, path)

  const ui = mergedConfig["ui"] as UiConfig | undefined
  const { vars: rcVars, diagnostics: rcVarsDiagnostics } = compileVarsMap(mergedConfig["vars"])
  diagnostics.push(...withOrigin(rcVarsDiagnostics, lookupIn))
  const { modes: rcModes, diagnostics: rcModesDiagnostics } = compileModesMap(mergedConfig["modes"])
  diagnostics.push(...withOrigin(rcModesDiagnostics, lookupIn))

  if (mergedConfig["workflow"] === undefined) {
    const modes = mergeModes(defaultWorkflowDefinition.modes, rcModes)
    const workflow =
      modes !== undefined ? { ...defaultWorkflowDefinition, modes } : defaultWorkflowDefinition
    // Derived from the same validator a custom `workflow:` goes through
    // (never hardcoded) — the built-in default just happens to pass clean
    // today, so this never actually fires a diagnostic in production.
    diagnostics.push(
      ...withOrigin(
        validateDefinition(defaultWorkflowDefinition).warnings.map((message) => ({
          severity: "warning" as const,
          message,
          path: [] as readonly (string | number)[],
          origin: "",
        })),
        () => BUILT_IN_ORIGIN,
      ),
    )
    return {
      workflow,
      workflowVars: defaultWorkflowVars,
      rcVars,
      ...(ui !== undefined ? { ui } : {}),
      machineTree: defaultMachineTree,
      stateScopes: defaultStateScopes,
      diagnostics: dedupeDiagnostics(sortDiagnostics(diagnostics, layerOrder)),
    }
  }

  // Every content file reference was already inlined per-layer above, so
  // `compileWorkflowConfig` has nothing left to resolve against a directory.
  const compiled = compileWorkflowConfig(mergedConfig["workflow"], rcModes)
  // `compiled.diagnostics`' own paths are relative to the `workflow:` value
  // itself (e.g. `["machines","root",...]`) — that is NOT a real path into
  // the user's `.gtdrc` (the file has no top-level `machines:`; it has
  // `workflow.machines...`). Prefix with `"workflow"` on the way out, same
  // as the origin lookup already does against `originTree` (rooted at the
  // FULL merged config, `vars`/`modes`/`workflow` as siblings) — every
  // printed path must mirror the actual file, not just the origin.
  diagnostics.push(
    ...compiled.diagnostics.map((d) => {
      const path = ["workflow", ...d.path]
      return { ...d, path, origin: lookupIn(path) }
    }),
  )

  return {
    workflow: compiled.definition,
    workflowVars: compiled.vars,
    rcVars,
    ...(ui !== undefined ? { ui } : {}),
    machineTree: compiled.tree ?? defaultMachineTree,
    stateScopes: compiled.scopes,
    diagnostics: dedupeDiagnostics(sortDiagnostics(diagnostics, layerOrder)),
  }
}
