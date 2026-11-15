import { dirname } from "node:path"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { Effect, type FileSystem } from "effect"
import {
  exposeHandler,
  UiError,
  type ExposeOptions,
  type UiHandler,
  type UiHost,
  type UiListener,
  type UiOut,
  type UiShell,
} from "../ui/index.js"
import { findWorkspaceModule, loadWorkspace } from "./Config.js"
import { driverPanes, drivers } from "./Drivers.js"
import { acquireLock, stateDirectory } from "./Lock.js"
import { projectsPage } from "./Page.js"
import { SupervisorHost } from "./Ports.js"
import { workspaceRouter } from "./Router.js"
import { restartOrphans, scan, type ProjectView } from "./Scan.js"

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
  SupervisorHost | UiShell | UiHost | UiListener | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const host = yield* SupervisorHost
    const file = yield* Effect.try({
      try: () => findWorkspaceModule(command.cwd, command.flags.config),
      catch: asUiError,
    })
    const root = dirname(file)
    const state = stateDirectory(command.stateHome, root)
    const lock = yield* Effect.try({
      try: () => acquireLock(state, root, host.isPidAlive),
      catch: asUiError,
    })
    yield* Effect.gen(function* () {
      const { settings } = yield* Effect.tryPromise({
        try: () => loadWorkspace(file, command.loadModule),
        catch: asUiError,
      })
      const deps = {
        worktrees: settings.adapters?.worktrees ?? host.defaultWorktrees(root),
        next: host.next,
        settings,
        drivers: drivers(
          settings.adapters?.terminal ?? host.defaultTerminal(),
          settings,
          driverPanes(state),
        ),
      }
      const projects = (): Promise<readonly ProjectView[]> => scan(deps)
      // Drivers run in their own panes and outlive this process; only the
      // orphans are started here, and a crashed driver waits for Retry.
      yield* Effect.tryPromise({ try: () => restartOrphans(deps), catch: asUiError })

      const handler: UiHandler = async (request) => {
        const path = new URL(request.url).pathname
        if (path === TRPC || path.startsWith(`${TRPC}/`)) {
          return fetchRequestHandler({
            endpoint: TRPC,
            req: request,
            router: workspaceRouter,
            createContext: () => ({ projects }),
          })
        }
        if (path !== "/") return new Response("not found\n", { status: 404 })
        return new Response(projectsPage(await projects()), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
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
      yield* Effect.never.pipe(Effect.ensuring(close))
    }).pipe(Effect.ensuring(Effect.sync(() => lock.release())))
  })
