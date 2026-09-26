import { createServer, type Server } from "node:http"
import { spawn } from "node:child_process"
import type { FlowGraph, NodeKind } from "./analyze/index.js"
import type { ResolvedRest } from "./Edge.js"
import type { TemplateEdge } from "./wire/index.js"
import type { PendingChange } from "./Workflow.js"
import visualizeHtml from "./visualize.html"

/** One edge out of a step, flattened for the viewer: `pattern` is the source text of the conditions along its path. */
export interface VizEdge {
  readonly pattern: string
  readonly to: string
}

/** One step, described for the viewer. */
export interface VizState {
  readonly name: string
  /** `script` | `prompt` | `message` | `restart`. */
  readonly kind: string
  /** The step's content: its value when the analyzer could read it as a constant, its source text otherwise. */
  readonly content?: string
  readonly initial?: boolean
  readonly actor?: string
  readonly label?: string
  readonly file?: string
  readonly mode?: string
  readonly model?: string
  readonly system?: string
  readonly skills?: string
  /** Boolean step options that are set, plus `entry` for an entry's first step. */
  readonly flags: readonly string[]
  readonly on: readonly VizEdge[]
  /** Kept for the page's shape; a TypeScript workflow routes judgments in plain code. */
  readonly routes: readonly never[]
  readonly incoming: ReadonlyArray<{ readonly from: string; readonly pattern: string }>
  /** The step's scope — its name minus its last segment. */
  readonly group?: string
}

/** One scope, as a cluster. */
export interface VizGroup {
  readonly name: string
  readonly machine: string
  /** This scope's DIRECT steps only (its descendants get their own entries). */
  readonly states: readonly string[]
  readonly parent?: string
  readonly depth: number
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

/** Drop keys whose value is `undefined` (so optionals stay absent, not `undefined`). */
const stripUndefined = (o: Record<string, unknown>): Record<string, unknown> => {
  for (const key of Object.keys(o)) if (o[key] === undefined) delete o[key]
  return o
}

const VIZ_FIELD_NAMES = ["label", "file", "mode", "model", "system", "skills"] as const

const FLAG_KEYS = [
  "reviewBase",
  "requireProgress",
  "answerGate",
  "requireRevert",
  "allowEmpty",
  "acceptClean",
] as const

/** Tooltip text for every field the visualizer shows. */
const FIELD_DOCS: Record<string, string> = {
  actor: "Who acts at this step: agent, human, check (a run step) or judge.",
  label: "Display name passed through gtd next --json for drivers and viewers.",
  file: "The step's steering file, under .gtd/.",
  mode: "The steering file's format — a built-in mode or a .gtdrc modes: entry.",
  model: "Opaque model hint for the agent harness.",
  system: "The agent harness system prompt — one per memory scope.",
  skills: "Skills prose prepended through the skillsPreamble var.",
  reviewBase: "The commit entering this step anchors the review window's diff base.",
  requireProgress: "A turn that only deletes the steering file is refused.",
  answerGate: "A turn leaving a qa-mode question unanswered is refused.",
  requireRevert: "A turn that did not revert the human's review-round edit is refused.",
  allowEmpty: "An agent turn that changes nothing completes the step instead of being an attempt.",
  acceptClean: "A clean landing completes this human gate — accepting as-is.",
  entry: "The first step of a --entry flow.",
  initial: "Where a finished process waits — the default entry's first step.",
}

const GRAPH_KIND: Readonly<Record<NodeKind, string>> = {
  agent: "prompt",
  human: "message",
  run: "script",
  judge: "message",
  restart: "restart",
}

const GRAPH_ACTOR: Readonly<Record<NodeKind, string | undefined>> = {
  agent: "agent",
  human: "human",
  run: "check",
  judge: "judge",
  restart: undefined,
}

/** Every scope prefix of `scope`, outermost first: `a.b.c` → `a`, `a.b`, `a.b.c`. */
const scopePrefixes = (scope: string): string[] =>
  scope === "" ? [] : scope.split(".").map((_, i, parts) => parts.slice(0, i + 1).join("."))

/**
 * The viewer's model, read off the analyzer's step graph: an edge's `pattern`
 * carries the source text of the conditions along its path, and each scope
 * becomes a cluster.
 */
export const buildGraphVizModel = (graph: FlowGraph, vars: Record<string, string>): VizModel => {
  const defaultEntry = graph.entries.find((entry) => entry.name === "default")
  const initial = defaultEntry?.edges[0]?.to ?? ""
  // The end of an episode is where the next one begins: the initial step.
  const target = (to: string): string => (to === "$end" ? initial : to)
  const incoming = new Map<string, Array<{ from: string; pattern: string }>>()
  for (const edge of graph.edges) {
    const list = incoming.get(target(edge.to)) ?? []
    list.push({ from: edge.from, pattern: edge.label })
    incoming.set(target(edge.to), list)
  }
  const manual = new Set(
    graph.entries
      .filter((entry) => entry.name !== "default")
      .flatMap((e) => e.edges.map((x) => x.to)),
  )
  const states = graph.nodes.map((node): VizState => {
    const fields: Record<string, unknown> = { actor: GRAPH_ACTOR[node.kind] }
    for (const key of VIZ_FIELD_NAMES) {
      if (node.options[key] !== undefined) fields[key] = node.options[key]
    }
    return stripUndefined({
      name: node.name,
      ...fields,
      kind: GRAPH_KIND[node.kind],
      content: node.content,
      initial: node.name === initial ? true : undefined,
      flags: [
        ...FLAG_KEYS.filter((key) => node.options[key] === true),
        ...(manual.has(node.name) ? ["entry"] : []),
      ],
      on: graph.edges
        .filter((e) => e.from === node.name)
        .map((e) => ({ pattern: e.label, to: target(e.to) })),
      routes: [],
      incoming: incoming.get(node.name) ?? [],
      group: node.scope === "" ? undefined : node.scope,
    }) as unknown as VizState
  })
  const scopes = [...new Set(graph.nodes.flatMap((node) => scopePrefixes(node.scope)))].sort()
  const groups = scopes.map((name): VizGroup => {
    const dot = name.lastIndexOf(".")
    const model = graph.nodes.find((n) => n.scope === name && n.kind === "agent")?.options.model
    return {
      name,
      machine: name,
      states: graph.nodes.filter((n) => n.scope === name).map((n) => n.name),
      ...(dot === -1 ? {} : { parent: name.slice(0, dot) }),
      depth: name.split(".").length - 1,
      ...(typeof model === "string" ? { model } : {}),
    }
  })
  return { states, initial, groups, vars, fieldDocs: FIELD_DOCS }
}

/** One edge out of the rested step, flagged when it is the one the pending change replays to. */
export interface CurrentStateEdge {
  readonly pattern: string
  readonly to: string
  readonly matched: boolean
}

/** Where the active process rests right now, for the viewer's "Current state" panel. */
export interface CurrentStateModel {
  readonly state: string
  readonly actor: string
  readonly kind: string
  readonly group?: string
  readonly edges: readonly CurrentStateEdge[]
  readonly pending: readonly PendingChange[]
}

/** The rested step's out-edges, the one leading to `next` (the step the pending change replays to) flagged. */
export const buildCurrentStateModel = (
  rest: ResolvedRest,
  changes: readonly PendingChange[],
  edges: readonly TemplateEdge[],
  next: string | undefined,
  group?: string,
): CurrentStateModel => {
  const matchedIndex = edges.findIndex((edge) => edge.target === next)
  return stripUndefined({
    state: rest.state,
    actor: rest.actor,
    kind: rest.stepDef.kind,
    group,
    edges: edges.map((edge, i) => ({
      pattern: edge.pattern,
      to: edge.target,
      matched: i === matchedIndex,
    })),
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
