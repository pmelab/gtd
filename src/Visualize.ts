import { createServer, type Server } from "node:http"
import { spawn } from "node:child_process"
import {
  contentKindOf,
  initialStateOf,
  type OnEdge,
  type StateDef,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import { collectGroups } from "./Submachines.js"
import visualizeHtml from "./visualize.html"

/**
 * `gtd visualize` — the read-only workflow viewer (see `runVisualizeCommand` in
 * `src/program.ts`). It builds a plain JSON DESCRIPTION of the active workflow
 * (`VizModel`) and serves it, alongside a self-contained HTML page
 * (`src/visualize.html`, bundled as text), from a tiny local HTTP server. The
 * page fetches `/workflow.json` and renders the machine — a Mermaid flowchart
 * with one `subgraph` per sub-machine, plus a per-state inspector.
 *
 * Everything here is a plain function of its inputs — no Effect, no git — so the
 * model builder and the request handler unit-test directly; `program.ts` wires
 * the server into the Effect runtime.
 */

/** One `on` edge, flattened for the viewer. */
export interface VizEdge {
  readonly pattern: string
  readonly to: string
  readonly describe?: string
}

/** One state, described for the viewer. */
export interface VizState {
  readonly name: string
  /** The state's actor, or omitted for a commit state. */
  readonly actor?: string
  /** `script` | `prompt` | `message` | `commit` | `unknown` (a malformed state). */
  readonly kind: string
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
  /** The name of the innermost sub-machine group this state belongs to, if any. */
  readonly group?: string
}

/** The whole workflow, described for the viewer — the `/workflow.json` payload. */
export interface VizModel {
  readonly states: readonly VizState[]
  readonly initial: string
  readonly groups: ReadonlyArray<{
    readonly name: string
    readonly submachine: string
    readonly states: readonly string[]
  }>
  readonly vars: Record<string, string>
}

const FLAG_KEYS = [
  "reviewWindow",
  "reviewBase",
  "reviewEntry",
  "fixEntry",
  "requireProgress",
  "answerGate",
] as const

// The boolean state flags that are set. `initial` is NOT included here — it is
// carried as its own `VizState.initial` field.
const flagsOf = (def: StateDef): string[] => FLAG_KEYS.filter((k) => def[k] === true)

const edgeToViz = ([pattern, to, describe]: OnEdge): VizEdge =>
  describe !== undefined ? { pattern, to, describe } : { pattern, to }

/** Drop keys whose value is `undefined` (so `exactOptionalPropertyTypes` optionals stay absent, not `undefined`). */
const stripUndefined = (o: Record<string, unknown>): Record<string, unknown> => {
  for (const key of Object.keys(o)) if (o[key] === undefined) delete o[key]
  return o
}

/** Describe one compiled state for the viewer (optional fields omitted when unset). */
const toVizState = (
  name: string,
  def: StateDef,
  group: string | undefined,
  incoming: ReadonlyArray<{ from: string; pattern: string }>,
): VizState =>
  stripUndefined({
    name,
    actor: def.actor,
    kind: contentKindOf(def) ?? "unknown",
    initial: def.initial === true ? true : undefined,
    model: def.model,
    memory: def.memory,
    file: def.file,
    mode: def.mode,
    retry: def.retry,
    flags: flagsOf(def),
    on: (def.on ?? []).map(edgeToViz),
    incoming,
    group,
  }) as unknown as VizState

/**
 * Build the viewer's JSON description from the active COMPILED workflow plus its
 * RAW value (the pre-expansion `submachines:`/`use:` form — `rawWorkflow` from
 * `ConfigService`), which is the only place the sub-machine grouping survives
 * (`compileWorkflowConfig` flattens it away). `vars` is shown for reference.
 */
export const buildVizModel = (
  workflow: WorkflowDefinition,
  rawWorkflow: unknown,
  vars: Record<string, string>,
): VizModel => {
  const groups = collectGroups(rawWorkflow)
  // Map each state to its INNERMOST group (the smallest one containing it), so a
  // state inside a nested sub-machine is attributed to the tighter cluster.
  const sizeOf = new Map(groups.map((g) => [g.name, g.states.length]))
  const groupOf = new Map<string, string>()
  for (const g of groups) {
    for (const s of g.states) {
      const cur = groupOf.get(s)
      if (cur === undefined || sizeOf.get(g.name)! < sizeOf.get(cur)!) groupOf.set(s, g.name)
    }
  }

  const incoming = new Map<string, Array<{ from: string; pattern: string }>>()
  const addIncoming = (target: string, from: string, pattern: string) => {
    const list = incoming.get(target) ?? []
    list.push({ from, pattern })
    incoming.set(target, list)
  }
  for (const [name, def] of Object.entries(workflow.states)) {
    for (const [pattern, to] of def.on ?? []) addIncoming(to, name, pattern)
    if (def.retry) addIncoming(def.retry.otherwise, name, `retry ×${def.retry.max}`)
  }

  const states = Object.entries(workflow.states).map(([name, def]) =>
    toVizState(name, def, groupOf.get(name), incoming.get(name) ?? []),
  )

  return {
    states,
    initial: initialStateOf(workflow),
    groups: groups.map((g) => ({ name: g.name, submachine: g.submachine, states: [...g.states] })),
    vars,
  }
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
 */
export const startVizServer = (
  model: VizModel,
  port: number,
  host = "127.0.0.1",
): Promise<{ server: Server; url: string }> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const { pathname } = new URL(req.url ?? "/", "http://localhost")
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
