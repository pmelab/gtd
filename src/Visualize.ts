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
  type WorkflowDefinition,
  type WorkflowEntries,
} from "./PatternMachine.js"
import type { MachineNode } from "./Machines.js"
import type { ResolvedRest } from "./Edge.js"
import { renderStateTemplate, varsOnlyContext } from "./PatternTemplates.js"
import visualizeHtml from "./visualize.html"

/**
 * `gtd visualize` — the read-only workflow viewer (see `runVisualizeCommand` in
 * `src/program.ts`). It builds a plain JSON DESCRIPTION of the active workflow
 * (`VizModel`) and serves it, alongside a self-contained HTML page
 * (`src/visualize.html`, bundled as text), from a tiny local HTTP server.
 * `visualize.html` fetches `/workflow.json` and draws the main flow with each
 * sub-machine invocation collapsed into a single opaque black-box node — the
 * "one box per invocation" diagram — plus a separate, real Mermaid diagram per
 * sub-machine (its own member states, true shapes/colours, and a muted ghost
 * node for any edge leaving the group) rendered below (each diagram supporting
 * scroll/drag pan-zoom), and a per-state inspector whose drawer also shows the
 * state's own raw `script`/`prompt`/`message` source (`VizState.content`,
 * omitted for a commit state) — the text that actually instructs the actor,
 * not just the state's shape.
 *
 * A third route, `/state.json`, serves best-effort CURRENT-STATE info: the
 * `CurrentStateModel` built by `buildCurrentStateModel` — where the active
 * process rests right now, which `on` edge would fire on its pending changes,
 * its retry redirect, and the pending changes themselves. The browser fetches
 * it ONCE at page load (no polling — a refresh re-reads) to render a "Current
 * state" panel — including a readout of those pending changes, explaining
 * which edge is about to fire and why — and highlight the resting node in
 * both the main flow and its sub-machine diagram. This route is served by a
 * caller-supplied `resolveCurrent` callback (`startVizServer`'s 4th argument)
 * so this module stays git/Effect-free; `program.ts`'s `runVisualizeCommand`
 * supplies one backed by `resolveRest`.
 *
 * Everything here is a plain function of its inputs — no Effect, no git — so the
 * model builders and the request handler unit-test directly; `program.ts` wires
 * the server (and its `resolveCurrent` callback) into the Effect runtime.
 */

/** One `on` edge, flattened for the viewer. */
export interface VizEdge {
  readonly pattern: string
  readonly to: string
  readonly describe?: string
  readonly action?: string
}

/** One state, described for the viewer. */
export interface VizState {
  readonly name: string
  /** The state's actor, or omitted for a commit state. */
  readonly actor?: string
  /** `script` | `prompt` | `message` | `commit` | `unknown` (a malformed state). */
  readonly kind: string
  /** The state's raw template source (script/prompt/message), verbatim — omitted for a commit state. */
  readonly content?: string
  readonly initial?: boolean
  readonly model?: string
  readonly memory?: string
  readonly file?: string
  readonly mode?: string
  readonly retry?: { readonly max: number; readonly otherwise: string }
  /** Boolean state flags that are set: reviewWindow/reviewBase/reviewEntry/fixEntry/requireProgress/answerGate. */
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
  /** The machine this instance instantiates. */
  readonly machine: string
  /** This instance's DIRECT states only (its descendants get their own entries). */
  readonly states: readonly string[]
  /** The enclosing instance path — absent for a top-level reference. */
  readonly parent?: string
  /** `0` for a top-level reference, incrementing with nesting depth. */
  readonly depth: number
}

/** The whole workflow, described for the viewer — the `/workflow.json` payload. */
export interface VizModel {
  readonly states: readonly VizState[]
  readonly initial: string
  readonly groups: readonly VizGroup[]
  readonly vars: Record<string, string>
}

const FLAG_KEYS = ["reviewWindow", "reviewBase", "requireProgress", "answerGate"] as const

// The boolean state flags that are set. `initial` is NOT included here — it is
// carried as its own `VizState.initial` field. `reviewEntry`/`fixEntry` are also
// excluded — they are no longer per-state `StateDef` flags but named entries on
// `WorkflowDefinition.entries` (see `toVizState`'s `entries` parameter).
const flagsOf = (def: StateDef): string[] => FLAG_KEYS.filter((k) => def[k] === true)

const edgeToViz = ([pattern, to, describe, action]: OnEdge): VizEdge =>
  stripUndefined({ pattern, to, describe, action }) as unknown as VizEdge

/** Drop keys whose value is `undefined` (so `exactOptionalPropertyTypes` optionals stay absent, not `undefined`). */
const stripUndefined = (o: Record<string, unknown>): Record<string, unknown> => {
  for (const key of Object.keys(o)) if (o[key] === undefined) delete o[key]
  return o
}

/** Describe one compiled state for the viewer (optional fields omitted when unset). `onEdges` is that state's `on`, ALREADY RENDERED against `it.vars` (see `buildVizModel`) — never `def.on` directly, which would show the unrendered literal. `entries` is the workflow's `entries` — `name`'s match against `.default`/`.review`/`.fix` drives `initial` and the `reviewEntry`/`fixEntry` flags. */
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
    actor: def.actor,
    kind: contentKindOf(def) ?? "unknown",
    content: contentOf(def),
    initial: entries.default === name ? true : undefined,
    model: def.model,
    memory: def.memory,
    file: def.file,
    mode: def.mode,
    retry: def.retry,
    flags: [
      ...flagsOf(def),
      ...(entries.review === name ? ["reviewEntry"] : []),
      ...(entries.fix === name ? ["fixEntry"] : []),
    ],
    on: onEdges.map(edgeToViz),
    incoming,
    group,
  }) as unknown as VizState

/** Render one `on` pattern key against `vars` (see `Edge.ts`'s `renderOnEdges`), falling back to the raw pattern string on a render failure — the viewer is best-effort, unlike a real step (which refuses). */
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

/** A state's qualified name minus its last segment — the instance it directly belongs to, or `undefined` for a root-owned state. */
const groupOf = (name: string): string | undefined => {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? undefined : name.slice(0, dot)
}

/**
 * Flatten a `MachineNode` tree (`CompiledWorkflowConfig.tree`, from
 * `src/Machines.ts`'s `flattenMachines`) into `VizModel.groups` — a flat,
 * depth-first array of every instance STRICTLY BELOW the root (the root
 * machine itself is the canvas, never a box). Kept flat (rather than a
 * recursive payload) so every index-based front-end helper
 * (`groupBoxId`/`groupIndexOf`/`scrollToSubmachine`/etc — `src/visualize.html`)
 * keeps working unchanged.
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
 * Build the viewer's JSON description from the active COMPILED workflow plus
 * the machine tree its flattening produced (`CompiledWorkflowConfig.tree`).
 * `vars` is shown for reference, AND used to render every state's `on` pattern
 * (see `renderedOnByState`) so the diagram shows real paths rather than a
 * repointed var's stale literal.
 */
export const buildVizModel = (
  workflow: WorkflowDefinition,
  tree: MachineNode,
  vars: Record<string, string>,
): VizModel => {
  const groups: VizGroup[] = []
  flattenTree(tree, undefined, 0, groups)

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
      groupOf(name),
      incoming.get(name) ?? [],
      workflow.entries,
    ),
  )

  return {
    states,
    initial: initialStateOf(workflow),
    groups,
    vars,
  }
}

/** One `on` edge from the currently-rested state, flagged with whether it's the one `gtd step` would fire right now. */
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
 * Describe the currently-rested state for the viewer: its `on` edges each
 * flagged with whether it's the one that would fire on the CURRENT pending
 * changes (same first-match semantics `PatternMachine.step` decides a real
 * step with), plus the retry redirect and pending changes verbatim. `onEdges`
 * is the resting state's `on` edges ALREADY RENDERED against `it.vars` (see
 * `Edge.ts`'s `renderOnEdges`) — this function never renders anything itself,
 * it only matches/emits from what it's given (never `rest.stateDef.on`, which
 * would be the unrendered literal). `group` is threaded in by the caller
 * (already computed once by `buildVizModel` from the same workflow) rather
 * than recomputed here.
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

/** A ready-to-send HTTP response for a viewer route. */
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
 * Start the viewer's HTTP server, resolving once it is listening with the
 * chosen URL (a `port` of `0` picks a free port). Rejects if the port is in
 * use. The caller owns the returned `server` (closes it on shutdown).
 *
 * `resolveCurrent`, when given, backs an extra `/state.json` route serving
 * where the active process rests right now (resolved fresh on every request
 * — there's no polling on the browser side, just a single fetch at page
 * load). It resolves to `null` when there's no active process to report
 * (not a repo, no commits) — served as `{}`. This route is handled INLINE
 * (not through `handleVizRequest`) because it's async and per-request, unlike
 * the static routes `handleVizRequest` serves synchronously from a fixed model.
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
