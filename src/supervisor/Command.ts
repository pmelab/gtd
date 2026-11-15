import { basename, dirname } from "node:path"
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
import type { NotificationsAdapter, WorkspaceSettings } from "../workspace/index.js"
import { actionRuns } from "./Actions.js"
import { auditLog } from "./Audit.js"
import { findWorkspaceModule, loadWorkspace, reloadWorkspace } from "./Config.js"
import { controls, type Controls } from "./Controls.js"
import { dispatcher, type Dispatcher } from "./Dispatch.js"
import { driverPanes, drivers } from "./Drivers.js"
import { gateOf } from "./Gate.js"
import { acquireLock, stateDirectory } from "./Lock.js"
import { feedRunner } from "./Feeds.js"
import { SupervisorClock, SupervisorHost, UserlandTools } from "./Ports.js"
import { openStore } from "./Store.js"
import { workspaceRouter } from "./Router.js"
import type { ProjectView } from "./Scan.js"
import { liveSnapshot, type Banner } from "./Snapshot.js"
import { notes, type Notes } from "./Notes.js"
import { notifier, type Notifier } from "./Notify.js"
import { pauses as pausesOf, whenNoDrive, type Pauses } from "./Pauses.js"
import {
  drainSpool,
  serveSocket,
  socketPath,
  type ControlReply,
  type ControlRequest,
} from "./Socket.js"
import { worktreeChanges } from "./WorktreeChanges.js"
import { terminalTab } from "./Terminal.js"
import { worktreeStatus } from "./Status.js"

export interface WorkspaceCommand {
  readonly flags: ExposeOptions & { readonly config?: string }
  readonly cwd: string
  readonly stateHome: string
  readonly loadModule: (path: string) => Promise<Readonly<Record<string, unknown>>>
}

const TRPC = "/trpc"

interface ControlDeps {
  readonly noted: Notes
  readonly control: Controls
  readonly notify: Notifier
  readonly projects: () => readonly ProjectView[]
  readonly pauses: Pauses
  readonly dispatch: Dispatcher
  readonly after: (ms: number, run: () => void) => () => void
}

const reply = (refusal: string | undefined): ControlReply =>
  refusal === undefined ? { ok: true } : { ok: false, message: refusal }

type PauseRequest = Extract<ControlRequest, { readonly command: "pause" | "resume" }>

const isPause = (request: ControlRequest): request is PauseRequest =>
  request.command === "pause" || request.command === "resume"

/** One dispatcher for the socket and the spool; `endpoint` goes into the audit log. */
const controlHandler =
  ({ noted, control, notify, projects, pauses, dispatch, after }: ControlDeps) =>
  (endpoint: string) =>
  async (request: ControlRequest): Promise<ControlReply> => {
    if (request.command === "note") {
      const refusal = noted.note(request.worktree, request.note, endpoint)
      if (refusal !== undefined) return reply(refusal)
      if (request.note?.notify === true) notify.note(projects(), request.worktree, request.note)
      return reply(undefined)
    }
    if (isPause(request)) {
      const { command, wait, ...scope } = request
      const refusal = pauses.set(scope, command === "pause", { identity: "-", endpoint })
      if (refusal !== undefined) return reply(refusal)
      if (command === "resume") await dispatch.pass()
      if (wait === true) await whenNoDrive(() => dispatch.drivesIn(scope), after)
      return reply(undefined)
    }
    const outcome = await control.press({
      action: request.command,
      worktree: request.worktree,
      commit: request.commit,
      endpoint,
    })
    return outcome.outcome === "accepted" ? { ok: true } : { ok: false, message: outcome.message }
  }

const notificationsOf = (
  settings: WorkspaceSettings,
  byDefault: () => NotificationsAdapter,
): NotificationsAdapter => settings.adapters?.notifications ?? byDefault()

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
    let closeReload = (): void => {}
    let closeSocket = async (): Promise<void> => {}
    yield* Effect.gen(function* () {
      const loaded = yield* Effect.tryPromise({
        try: () => loadWorkspace(file, command.loadModule),
        catch: asUiError,
      })
      // Adapters and `ui` are built here once: a reload changes the rest.
      const { settings } = loaded
      let current = settings
      const config = () => current
      const worktrees = settings.adapters?.worktrees ?? host.defaultWorktrees(root)
      const terminal = settings.adapters?.terminal ?? host.defaultTerminal()
      const services = settings.adapters?.services ?? host.defaultServices()
      const panes = driverPanes(directory)
      const driverRuns = drivers(terminal, config, panes)
      const store = openStore(directory)
      const audit = auditLog(directory)
      const log = (line: string): void => {
        out.write(line)
        out.flush()
      }
      const notify = notifier({
        adapter: notificationsOf(settings, () => host.defaultNotifications(directory)),
        store,
        settings: config,
        now: clock.now,
        log,
      })
      const noted = notes({
        store,
        projects: () => snapshot.projects(),
        audit,
        now: clock.now,
      })
      const actions = actionRuns({
        worktrees,
        actions: settings.adapters?.actions ?? host.defaultActions(),
        terminal,
        drivers: driverRuns,
        status: async (worktree) =>
          noted.withNote(
            worktree,
            worktreeStatus(await host.next(worktree), await driverRuns.state(worktree)),
          ),
      })
      const snapshot = liveSnapshot({
        worktrees,
        next: host.next,
        settings: config,
        configName: basename(file),
        drivers: driverRuns,
        services,
        lastAction: actions.last,
        after: host.after,
        // Notes notify only when sent with --notify: the raw statuses, without them.
        changed: () => notify.worktrees(snapshot.projects()),
      })
      closeSnapshot = snapshot.close
      yield* Effect.tryPromise({ try: snapshot.start, catch: asUiError })
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
      const projects = () => noted.withNotes(control.withRefusals(snapshot.projects()))
      const terminalTabs = terminalTab({
        worktrees,
        terminal,
        panes,
        shell: host.loginShell,
        audit,
        now: clock.now,
      })
      const feeds = feedRunner({
        feeds: loaded.feeds,
        root,
        worktrees,
        exec: tools.exec,
        fetch: tools.fetch,
        now: clock.now,
        every: clock.every,
        store,
        log,
        afterPoll: (feed) => notify.polled(feed, feeds.items(), feeds.feeds()),
        ended: (inbox) => dispatch.endStarted(inbox),
        polled: () => dispatch.pass(),
      })
      const dispatch = dispatcher({
        feeds,
        worktrees,
        services,
        actions,
        drivers: driverRuns,
        next: host.next,
        projects: snapshot.projects,
        refresh: snapshot.refresh,
        settings: config,
        audit,
        now: clock.now,
        paused: (item) => paused.holds(item),
      })
      const paused = pausesOf({
        store,
        projects: () => snapshot.projects().map((project) => project.id),
        feeds: feeds.feeds,
        audit,
        now: clock.now,
      })
      const changes = worktreeChanges({
        worktrees,
        services,
        terminal,
        drivers: driverRuns,
        next: host.next,
        panes: actions.panes,
        starting: dispatch.starting,
        refresh: snapshot.refresh,
        errorNote: noted.errorNote,
        audit,
        now: clock.now,
      })
      const handleControl = controlHandler({
        noted,
        control,
        notify,
        projects: snapshot.projects,
        pauses: paused,
        dispatch,
        after: host.after,
      })
      // Before the socket opens: a spooled note is older than any sent to it.
      const spoolRefusals = yield* Effect.tryPromise({
        try: () => drainSpool(directory, handleControl("spool")),
        catch: asUiError,
      })
      const socket = yield* Effect.tryPromise({
        try: () => serveSocket(socketPath(directory), handleControl("cli")),
        catch: asUiError,
      })
      closeSocket = socket.close

      const reload = reloadWorkspace({
        file,
        load: () => loadWorkspace(file, command.loadModule),
        watchFile: host.watchFile,
        apply: (next) => {
          current = next.settings
          feeds.replace(next.feeds)
        },
        reloaded: (failure) => notify.reloaded(basename(file), failure),
      })
      closeReload = reload.close
      const banners = (): readonly Banner[] => {
        const failure = reload.failure()
        return [
          ...(failure !== undefined
            ? [
                {
                  kind: "configError" as const,
                  message: `${basename(file)} not reloaded: ${failure}`,
                },
              ]
            : []),
          ...snapshot.banners(),
        ]
      }

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
              banners,
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
              dispatch,
              pauses: paused,
              worktreeChanges: changes,
              caller: { identity: identity ?? "-", endpoint: path },
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
      notify.begin(url, snapshot.projects())
      out.write(`${url}\n`)
      out.write(spoolRefusals.map((refusal) => `spool ${refusal}\n`).join(""))
      out.flush()
      feeds.start()
      yield* Effect.never.pipe(
        Effect.ensuring(Effect.sync(feeds.stop)),
        Effect.ensuring(Effect.sync(() => actions.stop())),
        Effect.ensuring(close),
      )
    }).pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          closeReload()
          closeSnapshot()
          await closeSocket()
          lock.release()
        }),
      ),
    )
  })
