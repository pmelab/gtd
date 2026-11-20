import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import generatedClientHtml from "./client.generated.html"
import { readStep, type BeatDeps, type StepRead } from "./Beat.js"
import { resolveDiff } from "./Diff.js"
import type { UiHandler, UiHostOps } from "./Ports.js"
import { readSteeringFile } from "./ReadSteeringFile.js"
import { appRouter, type RouterContext } from "./Router.js"
import { actorVia, writeNote, writeValue, type WriteResult } from "./Write.js"

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

/** `root`'s rest as of now, with the steering file its person may edit. */
export const currentRest = (
  root: string,
  host: UiHostOps,
): Pick<GateOptions, "readStep" | "servedFile"> => {
  const read = (): Promise<StepRead> => readStep({ path: root }, beatDepsOf(host))
  return {
    readStep: read,
    servedFile: async () => {
      const step = await read()
      return step.status === "ok" && step.actor === "human" ? step.file : undefined
    },
  }
}

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
    (head) => `${head}<meta name="gtd-page" content="workspace">`,
  )

const vanished: WriteResult = { ok: false, reason: "file-vanished" }

/** Serves one worktree's gate page and its API. */
export const gateHandler = (options: GateOptions): UiHandler => {
  const { root, host, endpoint } = options
  const page = withTrpcEndpoint(options.clientHtml ?? generatedClientHtml, endpoint)
  const writeDeps = {
    headSha: host.headSha,
    actorAt: actorVia(host.run),
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
