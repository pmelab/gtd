import { dirname } from "node:path"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { Effect, type FileSystem } from "effect"
import {
  currentRest,
  exposeHandler,
  gateHandler,
  UiError,
  type ExposeOptions,
  type UiHandler,
  UiHost,
  type UiListener,
  type UiOut,
  type UiShell,
} from "../ui/index.js"
import { findWorkspaceModule, loadWorkspace } from "./Config.js"
import { gateOf } from "./Gate.js"
import { acquireLock, stateDirectory } from "./Lock.js"
import { feedRunner } from "./Feeds.js"
import { inboxPage, projectsPage } from "./Page.js"
import { SupervisorClock, SupervisorHost, UserlandTools } from "./Ports.js"
import { openStore } from "./Store.js"
import { workspaceRouter } from "./Router.js"
import { recheck, scan, type ProjectView } from "./Scan.js"
import { withServices } from "./Services.js"

export interface WorkspaceCommand {
  readonly flags: ExposeOptions & { readonly config?: string }
  readonly cwd: string
  readonly stateHome: string
  readonly loadModule: (path: string) => Promise<Readonly<Record<string, unknown>>>
}

const TRPC = "/trpc"

const asUiError = (error: unknown): UiError =>
  error instanceof UiError
    ? error
    : new UiError(error instanceof Error ? error.message : String(error))

/**
 * `gtd workspace`: the one supervisor of a workspace. It serves the Projects
 * view until a signal ends it, then closes the server and frees the lock.
 */
export const runWorkspaceCommand = (
  command: WorkspaceCommand,
  out: UiOut,
): Effect.Effect<
  void,
  UiError,
  | SupervisorHost
  | UserlandTools
  | SupervisorClock
  | UiShell
  | UiHost
  | UiListener
  | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const host = yield* SupervisorHost
    const uiHost = yield* UiHost
    const tools = yield* UserlandTools
    const clock = yield* SupervisorClock
    const file = yield* Effect.try({
      try: () => findWorkspaceModule(command.cwd, command.flags.config),
      catch: asUiError,
    })
    const root = dirname(file)
    const directory = stateDirectory(command.stateHome, root)
    const lock = yield* Effect.try({
      try: () => acquireLock(directory, root, host.isPidAlive),
      catch: asUiError,
    })
    yield* Effect.gen(function* () {
      const { settings, feeds: feedExports } = yield* Effect.tryPromise({
        try: () => loadWorkspace(file, command.loadModule),
        catch: asUiError,
      })
      const deps = {
        worktrees: settings.adapters?.worktrees ?? host.defaultWorktrees(root),
        next: host.next,
        settings,
      }
      const services = settings.adapters?.services ?? host.defaultServices()
      const projects = (): Promise<readonly ProjectView[]> =>
        scan(deps).then((views) => withServices(views, services))
      yield* Effect.tryPromise({ try: projects, catch: asUiError })
      const feeds = feedRunner({
        feeds: feedExports,
        root,
        worktrees: deps.worktrees,
        exec: tools.exec,
        fetch: tools.fetch,
        now: clock.now,
        every: clock.every,
        store: openStore(directory),
        log: (line) => {
          out.write(line)
          out.flush()
        },
      })

      const gatePage: UiHandler = async (request, afterResponse, peer) => {
        const gate = await gateOf(new URL(request.url).pathname, deps.worktrees)
        if (gate === undefined) return new Response("not found\n", { status: 404 })
        const worktree = gate.worktree.path
        return gateHandler({
          root: worktree,
          host: uiHost,
          endpoint: `${gate.base}${TRPC}`,
          ...currentRest(worktree, uiHost),
          // The status a person just changed must not wait for the next scan.
          onEdit: () => void recheck(deps, worktree),
        })(request, afterResponse, peer)
      }

      const handler: UiHandler = async (request, afterResponse, peer) => {
        const path = new URL(request.url).pathname
        if (path === TRPC || path.startsWith(`${TRPC}/`)) {
          return fetchRequestHandler({
            endpoint: TRPC,
            req: request,
            router: workspaceRouter,
            createContext: () => ({ projects, feeds }),
          })
        }
        const html = (body: string): Response =>
          new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } })
        if (path === "/inbox") return html(inboxPage(feeds.items(), feeds.feeds()))
        if (path !== "/") return gatePage(request, afterResponse, peer)
        return html(projectsPage(await projects()))
      }

      const { url, close } = yield* exposeHandler({
        options: command.flags,
        config: settings.ui,
        handler,
        label: root,
        out,
      })
      lock.serving(url)
      out.write(`${url}\n`)
      out.flush()
      feeds.start()
      yield* Effect.never.pipe(Effect.ensuring(Effect.sync(feeds.stop)), Effect.ensuring(close))
    }).pipe(Effect.ensuring(Effect.sync(() => lock.release())))
  })
