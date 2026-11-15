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
import { actionRuns } from "./Actions.js"
import { findWorkspaceModule, loadWorkspace } from "./Config.js"
import { gateOf } from "./Gate.js"
import { driverPanes, drivers } from "./Drivers.js"
import { acquireLock, stateDirectory } from "./Lock.js"
import { projectsPage } from "./Page.js"
import { SupervisorHost } from "./Ports.js"
import { workspaceRouter } from "./Router.js"
import { recheck, restartOrphans, scan, type ProjectView } from "./Scan.js"

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
    const uiHost = yield* UiHost
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
      const terminal = settings.adapters?.terminal ?? host.defaultTerminal()
      const deps = {
        worktrees: settings.adapters?.worktrees ?? host.defaultWorktrees(root),
        next: host.next,
        settings,
        drivers: drivers(terminal, settings, driverPanes(state)),
      }
      const actions = actionRuns({
        worktrees: deps.worktrees,
        actions: settings.adapters?.actions ?? host.defaultActions(),
        terminal,
        drivers: deps.drivers,
        status: (worktree) => recheck(deps, worktree),
      })
      const projects = async (): Promise<readonly ProjectView[]> =>
        (await scan(deps)).map((project) => ({
          ...project,
          worktrees: project.worktrees.map((w) => {
            const action = actions.last(w.path)
            return action === undefined ? w : { ...w, action }
          }),
        }))
      // Drivers run in their own panes and outlive this process; only the
      // orphans are started here, and a crashed driver waits for Retry.
      yield* Effect.tryPromise({ try: () => restartOrphans(deps), catch: asUiError })

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
            createContext: () => ({ projects, actions }),
          })
        }
        if (path !== "/") return gatePage(request, afterResponse, peer)
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
      yield* Effect.never.pipe(
        Effect.ensuring(close),
        Effect.ensuring(Effect.sync(() => actions.stop())),
      )
    }).pipe(Effect.ensuring(Effect.sync(() => lock.release())))
  })
