import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import generatedClientHtml from "./client.generated.html"
import { readStep, type BeatDeps, type StepRead } from "./Beat.js"
import { resolveDiff } from "./Diff.js"
import type { UiHandler, UiHostOps } from "./Ports.js"
import { readSteeringFile } from "./ReadSteeringFile.js"
import { appRouter, type RouterContext } from "./Router.js"
import {
  humanRestCache,
  writeNote,
  writeValue,
  writeValues,
  type HumanRestCache,
  type WriteResult,
} from "./Write.js"

/** One worktree's gate page: what it reads, and where its API is served. */
export interface GateOptions {
  readonly root: string
  readonly host: UiHostOps
  /** The path of the page's tRPC API. Every other path serves the page. */
  readonly endpoint: string
  readonly clientHtml?: string
  readonly readStep: () => Promise<StepRead>
  /** The one steering file the page may read and write, if any. */
  readonly servedFile: () => Promise<string | undefined>
  /** Shared by the served-file check and the write guard; build once per worktree, outside any per-request handler. */
  readonly rest?: HumanRestCache
  /** Runs after each write that landed. */
  readonly onEdit?: () => void
  /** Presses Proceed for this worktree; a standalone `gtd ui` gives none. */
  readonly proceed?: RouterContext["proceed"]
}

export const beatDepsOf = (host: UiHostOps): BeatDeps => ({
  run: host.run,
  readLocalGtdVersion: host.readLocalGtdVersion,
  headSha: host.headSha,
})

/** A per-worktree cache of the human rest. */
export const humanRestOf = (host: UiHostOps): HumanRestCache =>
  humanRestCache(host.headSha, async (root) => {
    const step = await readStep({ path: root }, beatDepsOf(host))
    return step.status === "ok" && step.actor === "human" ? { file: step.file } : undefined
  })

/** `root`'s rest as of now, with the steering file its person may edit. */
export const currentRest = (
  root: string,
  host: UiHostOps,
  rest: HumanRestCache = humanRestOf(host),
): Pick<GateOptions, "readStep" | "servedFile" | "rest"> => ({
  readStep: (): Promise<StepRead> => readStep({ path: root }, beatDepsOf(host)),
  servedFile: async () => (await rest.restOf(root))?.file,
  rest,
})

const escapeAttribute = (text: string): string =>
  text.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!)

/** The page with the path of its API, which the client reads from the `gtd-trpc` meta tag. */
export const withTrpcEndpoint = (html: string, endpoint: string): string =>
  html.replace(
    /<head[^>]*>/,
    (head) => `${head}<meta name="gtd-trpc" content="${escapeAttribute(endpoint)}">`,
  )

/** The workspace dashboard: the same client, which the `gtd-page` meta tag tells to open the dashboard. */
export const dashboardPage = (endpoint: string, clientHtml = generatedClientHtml): string =>
  withTrpcEndpoint(clientHtml, endpoint).replace(
    /<head[^>]*>/,
    (head) =>
      `${head}<meta name="gtd-page" content="workspace"><link rel="manifest" href="${MANIFEST_PATH}">`,
  )

export const MANIFEST_PATH = "/manifest.webmanifest"

/** The dashboard's web app manifest; icons are the data URIs the client page already carries. */
export const dashboardManifest = (clientHtml = generatedClientHtml): string => {
  const icon = (match: RegExp): string | undefined => match.exec(clientHtml)?.[1]
  const png = icon(/<link rel="icon" type="image\/png" sizes="192x192" href="([^"]+)"/)
  const svg = icon(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)"/)
  return JSON.stringify({
    name: "gtd",
    short_name: "gtd",
    start_url: "/",
    display: "standalone",
    theme_color: "#f4f4f1",
    background_color: "#f4f4f1",
    icons: [
      ...(png !== undefined ? [{ src: png, sizes: "192x192", type: "image/png" }] : []),
      ...(svg !== undefined ? [{ src: svg, sizes: "any", type: "image/svg+xml" }] : []),
    ],
  })
}

const vanished: WriteResult = { ok: false, reason: "file-vanished" }

/** Serves one worktree's gate page and its API. */
export const gateHandler = (options: GateOptions): UiHandler => {
  const { root, host, endpoint } = options
  const page = withTrpcEndpoint(options.clientHtml ?? generatedClientHtml, endpoint)
  const writeDeps = {
    headSha: host.headSha,
    actorAt: (options.rest ?? humanRestOf(host)).actorAt,
    readFile: host.readFile,
    writeFile: host.writeFile,
  }
  // Reads and writes reach only the served steering file, never the rest of
  // the worktree. Any other path reads as vanished, as no real page asks for it.
  const isServed = async (filePath: string): Promise<boolean> =>
    (await options.servedFile()) === filePath
  const edited = (result: WriteResult): WriteResult => {
    if (result.ok) options.onEdit?.()
    return result
  }
  const context: RouterContext = {
    readStep: options.readStep,
    ...(options.proceed !== undefined ? { proceed: options.proceed } : {}),
    writeNote: async (request) =>
      (await isServed(request.filePath))
        ? edited(await writeNote({ ...request, worktreePath: root }, writeDeps))
        : vanished,
    writeValue: async (request) =>
      (await isServed(request.filePath))
        ? edited(await writeValue({ ...request, worktreePath: root }, writeDeps))
        : vanished,
    writeValues: async (request) =>
      (await isServed(request.filePath))
        ? edited(await writeValues({ ...request, worktreePath: root }, writeDeps))
        : vanished,
    resolveDiff: (path, line, endLine) => resolveDiff(root, path, line, endLine, host),
    readSteeringFile: async (request) =>
      (await isServed(request.filePath))
        ? readSteeringFile({ ...request, worktreePath: root }, host)
        : { ok: false, reason: "file-vanished" },
  }
  return (request) => {
    const path = new URL(request.url).pathname
    if (path !== endpoint && !path.startsWith(`${endpoint}/`)) {
      return Promise.resolve(
        new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }),
      )
    }
    return fetchRequestHandler({
      endpoint,
      req: request,
      router: appRouter,
      createContext: () => context,
    })
  }
}
