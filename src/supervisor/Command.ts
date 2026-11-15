import { dirname } from "node:path"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { Effect, type FileSystem } from "effect"
import {
  currentRest,
  dashboardPage,
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
import { auditLog } from "./Audit.js"
import { controls } from "./Controls.js"
import { driverPanes, drivers } from "./Drivers.js"
import { gateOf } from "./Gate.js"
import { acquireLock, stateDirectory } from "./Lock.js"
import { feedRunner } from "./Feeds.js"
import { SupervisorClock, SupervisorHost, UserlandTools } from "./Ports.js"
import { openStore } from "./Store.js"
import { workspaceRouter } from "./Router.js"
import { liveSnapshot } from "./Snapshot.js"
import { terminalTab } from "./Terminal.js"
import { worktreeStatus } from "./Status.js"

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
    let closeSnapshot = (): void => {}
    yield* Effect.gen(function* () {
      const { settings, feeds: feedExports } = yield* Effect.tryPromise({
        try: () => loadWorkspace(file, command.loadModule),
        catch: asUiError,
      })
      const worktrees = settings.adapters?.worktrees ?? host.defaultWorktrees(root)
      const terminal = settings.adapters?.terminal ?? host.defaultTerminal()
      const panes = driverPanes(directory)
      const driverRuns = drivers(terminal, settings, panes)
      const actions = actionRuns({
        worktrees,
        actions: settings.adapters?.actions ?? host.defaultActions(),
        terminal,
        drivers: driverRuns,
        status: async (worktree) =>
          worktreeStatus(await host.next(worktree), await driverRuns.state(worktree)),
      })
      const snapshot = liveSnapshot({
        worktrees,
        next: host.next,
        settings,
        drivers: driverRuns,
        services: settings.adapters?.services ?? host.defaultServices(),
        lastAction: actions.last,
        after: host.after,
      })
      closeSnapshot = snapshot.close
      yield* Effect.tryPromise({ try: snapshot.start, catch: asUiError })
      const audit = auditLog(directory)
      const control = controls({
        worktrees,
        drivers: driverRuns,
        projects: snapshot.projects,
        oneShot: host.oneShot,
        after: host.after,
        refreshDriver: snapshot.refreshDriver,
        audit,
        now: clock.now,
      })
      const projects = () => control.withRefusals(snapshot.projects())
      const terminalTabs = terminalTab({
        worktrees,
        terminal,
        panes,
        shell: host.loginShell,
        audit,
        now: clock.now,
      })
      const feeds = feedRunner({
        feeds: feedExports,
        root,
        worktrees,
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
        const gate = await gateOf(new URL(request.url).pathname, worktrees)
        if (gate === undefined) return new Response("not found\n", { status: 404 })
        const worktree = gate.worktree.path
        return gateHandler({
          root: worktree,
          host: uiHost,
          endpoint: `${gate.base}${TRPC}`,
          ...currentRest(worktree, uiHost),
          // The status a person just changed must not wait for a hint.
          onEdit: () => snapshot.recheckWorktree(worktree),
        })(request, afterResponse, peer)
      }

      const handler: UiHandler = async (request, afterResponse, peer, identity) => {
        const path = new URL(request.url).pathname
        if (path === TRPC || path.startsWith(`${TRPC}/`)) {
          return fetchRequestHandler({
            endpoint: TRPC,
            req: request,
            router: workspaceRouter,
            createContext: () => ({
              projects,
              banners: snapshot.banners,
              actions,
              feeds: {
                ...feeds,
                dismiss: (feed: string, key: string) => {
                  const item = feeds.items().find((i) => i.feed === feed && i.key === key)
                  const dismissed = feeds.dismiss(feed, key)
                  audit.write({
                    time: new Date(clock.now()).toISOString(),
                    identity: identity ?? "-",
                    endpoint: path,
                    ...(item !== undefined ? { project: item.project } : {}),
                    action: "dismiss",
                    outcome: dismissed ? "accepted" : "unknown",
                  })
                  return dismissed
                },
              },
              terminal: terminalTabs.driver,
              openShell: (project, worktree) =>
                terminalTabs.openShell(project, worktree, {
                  ...(identity !== undefined ? { identity } : {}),
                  endpoint: path,
                }),
              press: (action, input) =>
                control.press({
                  action,
                  ...input,
                  ...(identity !== undefined ? { identity } : {}),
                  endpoint: path,
                }),
            }),
          })
        }
        const html = (body: string): Response =>
          new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } })
        if (path !== "/") return gatePage(request, afterResponse, peer)
        return html(dashboardPage(TRPC))
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
      yield* Effect.never.pipe(
        Effect.ensuring(Effect.sync(feeds.stop)),
        Effect.ensuring(Effect.sync(() => actions.stop())),
        Effect.ensuring(close),
      )
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          closeSnapshot()
          lock.release()
        }),
      ),
    )
  })
