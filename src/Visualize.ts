import { createServer, type Server } from "node:http"
import { spawn } from "node:child_process"
import {
  contentKindOf,
  contentOf,
  initialStateOf,
  matchesPattern,
  parsePattern,
  type OnEdge,
  type PendingChange,
  type RetryDef,
  type StateDef,
  type StateName,
  type WorkflowDefinition,
  type WorkflowEntries,
} from "./PatternMachine.js"
import { STATE_FIELDS, STATE_FIELD_ENTRIES, type StateFieldsTable } from "./StateFields.js"
import type { MachineNode } from "./Machines.js"
import type { ResolvedRest } from "./Edge.js"
import { renderStateTemplate, varsOnlyContext } from "./PatternTemplates.js"
import visualizeHtml from "./visualize.html"

/** One `on` edge, flattened for the viewer. */
export interface VizEdge {
  readonly pattern: string
  readonly to: string
  readonly describe?: string
  readonly action?: string
}

/** Every `StateDef` field marked `viz: "field"` in `STATE_FIELDS` (key/value, as opposed to a boolean flag chip — see `FLAG_KEYS`) — derived so a new such field needs no separate edit here. */
type VizFieldName = {
  [K in keyof StateFieldsTable]: StateFieldsTable[K] extends { viz: "field" } ? K : never
}[keyof StateFieldsTable]

type VizFields = { readonly [K in VizFieldName]?: StateDef[K] }

/** One state, described for the viewer. */
export interface VizState extends VizFields {
  readonly name: string
  /** `script` | `prompt` | `message` | `commit` | `unknown` (a malformed state). */
  readonly kind: string
  /** The state's raw template source (script/prompt/message), verbatim — omitted for a commit state. */
  readonly content?: string
  readonly initial?: boolean
  /** Boolean state flags that are set: reviewWindow/reviewBase/entry/requireProgress/answerGate. */
  readonly flags: readonly string[]
  readonly on: readonly VizEdge[]
  /** Every edge (and retry redirect) that targets this state — computed, for the "routes in from" view. */
  readonly incoming: ReadonlyArray<{ readonly from: string; readonly pattern: string }>
  /** This state's qualified name minus its last segment — the instance it directly belongs to, if any. */
  readonly group?: string
}

/** One machine instance, flattened from the tree for the viewer — see `flattenTree`. */
export interface VizGroup {
  /** The instance path — e.g. `packages.health`. */
  readonly name: string
  readonly machine: string
  /** This instance's DIRECT states only (its descendants get their own entries). */
  readonly states: readonly string[]
  readonly parent?: string
  readonly depth: number
  /** This instance's machine's own `model:` (stamped onto every one of its `prompt`-content states — see `Machines.ts`'s `resolveInstanceMachineFields`), read off any one of them. Absent when the machine declares no `model:` or owns no `prompt` state. */
  readonly model?: string
}

/** The whole workflow, described for the viewer — the `/workflow.json` payload. */
export interface VizModel {
  readonly states: readonly VizState[]
  readonly initial: string
  readonly groups: readonly VizGroup[]
  readonly vars: Record<string, string>
  readonly fieldDocs: Record<string, string>
}

/** Every state property name marked `viz: "field"` in `STATE_FIELDS` — the key/value fields `toVizState` copies onto `VizState`. */
const VIZ_FIELD_NAMES: readonly string[] = STATE_FIELD_ENTRIES.filter(
  ([, spec]) => spec.viz === "field",
).map(([key]) => key)

/** Every state property marked `viz: "flag"` — excludes `initial` (its own `VizState` field) and `entry` (derived from `entries.manual`, not a `StateDef` field). */
const FLAG_KEYS: readonly string[] = STATE_FIELD_ENTRIES.filter(
  ([, spec]) => spec.viz === "flag",
).map(([key]) => key)

const fieldOf = (def: StateDef, key: string): unknown => (def as Record<string, unknown>)[key]

const flagsOf = (def: StateDef): string[] => FLAG_KEYS.filter((k) => fieldOf(def, k) === true)

/** Every `viz: "field"` value actually set on `def`, keyed by field name. */
const vizFieldsOf = (def: StateDef): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const key of VIZ_FIELD_NAMES) {
    const value = fieldOf(def, key)
    if (value !== undefined) out[key] = value
  }
  return out
}

const edgeToViz = ([pattern, to, describe, action]: OnEdge): VizEdge =>
  stripUndefined({ pattern, to, describe, action }) as unknown as VizEdge

/** Drop keys whose value is `undefined` (so `exactOptionalPropertyTypes` optionals stay absent, not `undefined`). */
const stripUndefined = (o: Record<string, unknown>): Record<string, unknown> => {
  for (const key of Object.keys(o)) if (o[key] === undefined) delete o[key]
  return o
}

/** Describe one compiled state for the viewer. `onEdges` must be already rendered against `it.vars` (see `buildVizModel`), never the unrendered `def.on`. */
const toVizState = (
  name: string,
  def: StateDef,
  onEdges: readonly OnEdge[],
  group: string | undefined,
  incoming: ReadonlyArray<{ from: string; pattern: string }>,
  entries: WorkflowEntries,
): VizState =>
  stripUndefined({
    name,
    ...vizFieldsOf(def),
    kind: contentKindOf(def) ?? "unknown",
    content: contentOf(def),
    initial: entries.default === name ? true : undefined,
    flags: [...flagsOf(def), ...(entries.manual.includes(name) ? ["entry"] : [])],
    on: onEdges.map(edgeToViz),
    incoming,
    group,
  }) as unknown as VizState

/** Render one `on` pattern against `vars`, falling back to the raw string on failure — the viewer is best-effort, unlike a real step (which refuses). */
const renderPatternOrRaw = (pattern: string, vars: Record<string, string>): string => {
  try {
    return renderStateTemplate(pattern, varsOnlyContext(vars))
  } catch {
    return pattern
  }
}

/** Render every `on` edge of every state against `vars` (pattern key only — `target`/`describe`/`action` pass through verbatim), keyed by state name. */
const renderedOnByState = (
  workflow: WorkflowDefinition,
  vars: Record<string, string>,
): ReadonlyMap<string, readonly OnEdge[]> =>
  new Map(
    Object.entries(workflow.states).map(([name, def]) => [
      name,
      (def.on ?? []).map(([pattern, target, describe, action]): OnEdge => {
        const renderedPattern = renderPatternOrRaw(pattern, vars)
        if (action !== undefined) return [renderedPattern, target, describe, action]
        return describe !== undefined
          ? [renderedPattern, target, describe]
          : [renderedPattern, target]
      }),
    ]),
  )

/** A state's owning instance path, from `scopes` — a direct lookup, not a string chop off the qualified name (a state's group isn't always "everything before the last dot"). Root-owned (`""`) reports as `undefined`. */
const groupOf = (name: string, scopes: Record<StateName, string>): string | undefined => {
  const scope = scopes[name]
  return scope === "" || scope === undefined ? undefined : scope
}

/**
 * Flatten a `MachineNode` tree into `VizModel.groups` — a flat, depth-first
 * array of every instance strictly below the root (the root machine is the
 * canvas, never a box). Kept flat so index-based front-end helpers
 * (`src/visualize.html`) keep working unchanged.
 */
const flattenTree = (
  node: MachineNode,
  parent: string | undefined,
  depth: number,
  out: VizGroup[],
): void => {
  for (const child of node.children) {
    out.push({
      name: child.key,
      machine: child.machine,
      states: [...child.states],
      ...(parent !== undefined ? { parent } : {}),
      depth,
    })
    flattenTree(child, child.key, depth + 1, out)
  }
}

/**
 * A group's `model:`, read off any one of its prompt-content states (every
 * prompt state one machine instance owns carries the identical `def.model`).
 * `undefined` when the group owns no prompt state or declares no `model:`.
 */
const modelOfGroup = (
  groupName: string,
  workflow: WorkflowDefinition,
  scopes: Record<StateName, string>,
): string | undefined => {
  for (const [name, def] of Object.entries(workflow.states)) {
    if (scopes[name] === groupName && contentKindOf(def) === "prompt") return def.model
  }
  return undefined
}

/**
 * Tooltip text for every field the visualizer can show, keyed by field name:
 * every `viz`-marked `STATE_FIELDS` entry, plus `entry`/`initial` (both
 * derived pseudo-flags with no `StateFields` entry of their own).
 */
const FIELD_DOCS: Record<string, string> = {
  ...Object.fromEntries(
    STATE_FIELD_ENTRIES.filter(([, spec]) => spec.viz !== undefined).map(([key, spec]) => [
      key,
      spec.doc,
    ]),
  ),
  entry: STATE_FIELDS.entry.doc,
  initial: "The one initial state — an unrecognized HEAD (any non-gtd history) resolves here.",
}

/** Build the viewer's JSON description from the compiled workflow, its machine tree, and its scope map. `vars` is shown for reference and used to render every state's `on` pattern to a real path rather than a stale literal. */
export const buildVizModel = (
  workflow: WorkflowDefinition,
  tree: MachineNode,
  vars: Record<string, string>,
  scopes: Record<StateName, string>,
): VizModel => {
  const flatGroups: VizGroup[] = []
  flattenTree(tree, undefined, 0, flatGroups)
  const groups = flatGroups.map((group) => {
    const model = modelOfGroup(group.name, workflow, scopes)
    return model !== undefined ? { ...group, model } : group
  })

  const renderedOn = renderedOnByState(workflow, vars)

  const incoming = new Map<string, Array<{ from: string; pattern: string }>>()
  const addIncoming = (target: string, from: string, pattern: string) => {
    const list = incoming.get(target) ?? []
    list.push({ from, pattern })
    incoming.set(target, list)
  }
  for (const [name, def] of Object.entries(workflow.states)) {
    for (const [pattern, to] of renderedOn.get(name) ?? []) addIncoming(to, name, pattern)
    if (def.retry) addIncoming(def.retry.otherwise, name, `retry ×${def.retry.max}`)
  }

  const states = Object.entries(workflow.states).map(([name, def]) =>
    toVizState(
      name,
      def,
      renderedOn.get(name) ?? [],
      groupOf(name, scopes),
      incoming.get(name) ?? [],
      workflow.entries,
    ),
  )

  return {
    states,
    initial: initialStateOf(workflow),
    groups,
    vars,
    fieldDocs: FIELD_DOCS,
  }
}

/** One `on` edge from the currently-rested state, flagged with whether it's the one `gtd land` would fire right now. */
export interface CurrentStateEdge {
  readonly pattern: string
  readonly to: string
  readonly matched: boolean
  readonly action?: string
}

/** Where the active process rests right now, for the viewer's "Current state" panel — resolved once at page load, never polled. */
export interface CurrentStateModel {
  readonly state: string
  readonly actor: string
  readonly kind: string
  readonly group?: string
  readonly edges: readonly CurrentStateEdge[]
  readonly retry?: RetryDef
  readonly pending: readonly PendingChange[]
}

/**
 * Describe the currently-rested state: its `on` edges flagged with whether
 * each is the one that would fire on the current pending changes (same
 * first-match semantics as a real step), plus retry/pending verbatim.
 * `onEdges` must already be rendered against `it.vars` — never the unrendered
 * `rest.stateDef.on`.
 */
export const buildCurrentStateModel = (
  rest: ResolvedRest,
  changes: readonly PendingChange[],
  onEdges: readonly OnEdge[],
  group?: string,
): CurrentStateModel => {
  const matchedIndex = onEdges.findIndex(([patternStr]) => {
    const parsed = parsePattern(patternStr)
    return parsed !== undefined && matchesPattern(parsed, changes)
  })
  const edges = onEdges.map(([pattern, to, , action], i) => ({
    pattern,
    to,
    matched: i === matchedIndex,
    ...(action !== undefined ? { action } : {}),
  }))
  return stripUndefined({
    state: rest.state,
    actor: rest.actor,
    kind: contentKindOf(rest.stateDef) ?? "unknown",
    group,
    edges,
    retry: rest.stateDef.retry,
    pending: changes,
  }) as unknown as CurrentStateModel
}

export interface VizResponse {
  readonly status: number
  readonly contentType: string
  readonly body: string
}

/**
 * Route one request (pure): `/` (or `/index.html`) serves the viewer page,
 * `/workflow.json` serves the model, anything else is a 404. Kept separate from
 * the server so it unit-tests without a socket.
 */
export const handleVizRequest = (pathname: string, model: VizModel): VizResponse => {
  if (pathname === "/" || pathname === "/index.html")
    return { status: 200, contentType: "text/html; charset=utf-8", body: visualizeHtml }
  if (pathname === "/workflow.json")
    return {
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(model),
    }
  return { status: 404, contentType: "text/plain; charset=utf-8", body: "not found" }
}

/**
 * Start the viewer's HTTP server (`port: 0` picks a free port). The caller
 * owns the returned `server`. `resolveCurrent`, when given, backs a
 * `/state.json` route resolved fresh per request (served as `{}` when there's
 * no active process) — handled inline rather than via `handleVizRequest`
 * since it's async, unlike the static routes.
 */
export const startVizServer = (
  model: VizModel,
  port: number,
  host = "127.0.0.1",
  resolveCurrent?: () => Promise<CurrentStateModel | null>,
): Promise<{ server: Server; url: string }> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const { pathname } = new URL(req.url ?? "/", "http://localhost")
      if (pathname === "/state.json") {
        Promise.resolve(resolveCurrent ? resolveCurrent() : null).then((current) => {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
          res.end(JSON.stringify(current ?? {}))
        })
        return
      }
      const { status, contentType, body } = handleVizRequest(pathname, model)
      res.writeHead(status, { "content-type": contentType })
      res.end(body)
    })
    server.once("error", reject)
    server.listen(port, host, () => {
      const address = server.address()
      const chosen = typeof address === "object" && address !== null ? address.port : port
      resolve({ server, url: `http://${host}:${chosen}` })
    })
  })

/** Best-effort open a URL in the default browser (macOS `open`, Windows `start`, else `xdg-open`); failures are ignored — the URL is always printed too. */
export const openInBrowser = (url: string): void => {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
  try {
    const child = spawn(cmd, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    })
    child.on("error", () => {})
    child.unref()
  } catch {
    /* ignore — the URL is printed for the user to open manually */
  }
}
