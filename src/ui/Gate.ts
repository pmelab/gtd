import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import generatedClientHtml from "./client.generated.html"
import { readStep, type BeatDeps, type StepRead } from "./Beat.js"
import { resolveDiff } from "./Diff.js"
import type { UiHandler, UiHostOps } from "./Ports.js"
import { shellQuote } from "./Quote.js"
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
  /** Presses Proceed for this worktree. */
  readonly proceed?: RouterContext["proceed"]
}

const beatDepsOf = (host: UiHostOps): BeatDeps => ({
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

export const MANIFEST_PATH = "/manifest.webmanifest"
export const SERVICE_WORKER_PATH = "/sw.js"

/**
 * The workspace dashboard: the same client, which the `gtd-page` meta tag tells
 * to open the dashboard. `gtd-version` is the supervisor's version, which the
 * dashboard compares with the one it asks for later.
 */
export const dashboardPage = (
  endpoint: string,
  version: string,
  clientHtml = generatedClientHtml,
): string =>
  withTrpcEndpoint(clientHtml, endpoint).replace(
    /<head[^>]*>/,
    (head) =>
      `${head}<meta name="gtd-page" content="workspace"><meta name="gtd-version" content="${escapeAttribute(version)}"><link rel="manifest" href="${MANIFEST_PATH}">`,
  )

/** The dashboard's web app manifest; icons are the data URIs the client page already carries. */
export const dashboardManifest = (workspace: string, clientHtml = generatedClientHtml): string => {
  const icon = (match: RegExp): string | undefined => match.exec(clientHtml)?.[1]
  const png = icon(/<link rel="icon" type="image\/png" sizes="192x192" href="([^"]+)"/)
  const svg = icon(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)"/)
  return JSON.stringify({
    name: `gtd · ${workspace}`,
    short_name: "gtd",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#f4f4f1",
    background_color: "#f4f4f1",
    icons: [
      ...(png !== undefined ? [{ src: png, sizes: "192x192", type: "image/png" }] : []),
      ...(svg !== undefined ? [{ src: svg, sizes: "any", type: "image/svg+xml" }] : []),
    ],
  })
}

/**
 * The dashboard's service worker. It caches the app shell only (the page, whose
 * script, styles and icons are inline, and the manifest), never a worktree's
 * data, which comes from the API. The version names the cache.
 */
export const dashboardServiceWorker = (version: string): string => `
const CACHE = ${JSON.stringify(`gtd-shell-${version}`)}
const SHELL = ["/", ${JSON.stringify(MANIFEST_PATH)}]
self.addEventListener("install", (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
})
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return
  if (!SHELL.includes(url.pathname)) return
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(url.pathname, copy))
        }
        return response
      })
      .catch(() => caches.match(url.pathname).then((hit) => hit ?? Response.error())),
  )
})
self.addEventListener("push", (event) => {
  const message = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(message.title ?? "gtd", {
      body: message.body,
      tag: message.tag,
      data: { url: message.url ?? "/" },
    }),
  )
})
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data.url
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      return open ? open.focus().then((w) => w.navigate(url)) : self.clients.openWindow(url)
    }),
  )
})
`

const vanished: WriteResult = { ok: false, reason: "file-vanished" }

/** Serves one worktree's gate page and its API. */
// Tools may not import core's commit codec, so read just the subject and the
// two trailers a landing walk needs.
const readLandingMessage = (
  message: string,
):
  | {
      readonly actor: string
      readonly transition: boolean
      readonly step: boolean
      readonly branch: boolean
    }
  | undefined => {
  const subject = /^gtd\(([^()]+)\): (.+)$/.exec((message.split("\n")[0] ?? "").trim())
  if (subject === null) return undefined
  return {
    actor: subject[1]!,
    transition: subject[2]!.includes(" → "),
    step: /^Gtd-Step:/m.test(message),
    branch: /^Gtd-Branch:/m.test(message),
  }
}

type LandingEntry = { readonly hash: string; readonly message: string } | undefined

const splitLogEntry = (entry: string): LandingEntry => {
  const nl = entry.indexOf("\n")
  return nl === -1 ? undefined : { hash: entry.slice(0, nl).trim(), message: entry.slice(nl + 1) }
}

const STOP = Symbol("stop")

// One log entry: the file it left (a landing), STOP (the walk ends here) or
// undefined (look further back).
const readEntry = async (
  host: UiHostOps,
  cwd: string,
  filePath: string,
  entry: { readonly hash: string; readonly message: string },
): Promise<string | typeof STOP | undefined> => {
  const message = readLandingMessage(entry.message)
  if (message === undefined || message.branch) return STOP
  if (message.actor !== "human") return undefined
  const shown = await host.run(cwd, `git show ${entry.hash}:${shellQuote(filePath)} 2>/dev/null`)
  if (shown.status === 0) return shown.stdout
  return message.transition || message.step ? undefined : STOP
}

// A landing is a `gtd(human)` commit of the current process (first-parent,
// back to its opening or the last non-step / branch-finishing commit); the
// file as the newest one holding it left it.
const lastLanding = async (
  host: UiHostOps,
  cwd: string,
  filePath: string,
): Promise<string | undefined> => {
  const log = await host.run(cwd, "git log --first-parent -z --format=%H%n%B")
  if (log.status !== 0) return undefined
  for (const raw of log.stdout.split("\0")) {
    const entry = splitLogEntry(raw)
    const found = entry === undefined ? undefined : await readEntry(host, cwd, filePath, entry)
    if (found === STOP) return undefined
    if (found !== undefined) return found
  }
  return undefined
}

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
        ? readSteeringFile(
            { ...request, worktreePath: root },
            { ...host, lastLanding: (cwd, filePath) => lastLanding(host, cwd, filePath) },
          )
        : { ok: false, reason: "file-vanished" },
  }
  return (request) => {
    const path = new URL(request.url).pathname
    if (path !== endpoint && !path.startsWith(`${endpoint}/`)) {
      return Promise.resolve(
        new Response(page, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
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
