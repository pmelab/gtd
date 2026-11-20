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
import { cleaner } from "./Clean.js"
import { findWorkspaceModule, loadWorkspace, reloadWorkspace } from "./Config.js"
import { controls, type Controls } from "./Controls.js"
import { dispatcher, type Dispatcher } from "./Dispatch.js"
import { driverPanes, drivers } from "./Drivers.js"
import { gateOf, isGatePath } from "./Gate.js"
import { acquireLock, stateDirectory } from "./Lock.js"
import { feedRunner } from "./Feeds.js"
import {
  SupervisorClock,
  SupervisorHost,
  UserlandTools,
  type DefaultNotifications,
} from "./Ports.js"
import { openStore } from "./Store.js"
import { workspaceRouter } from "./Router.js"
import type { ProjectView } from "./Scan.js"
import { liveSnapshot, type Banner } from "./Snapshot.js"
import { notes, type Notes } from "./Notes.js"
import { detailLink, notifier, type Notifier } from "./Notify.js"
import { pauses as pausesOf, whenNoDrive, type Pauses } from "./Pauses.js"
import { reactionRunner } from "./Reactions.js"
import {
  drainSpool,
  serveSocket,
  socketPath,
  type ControlReply,
  type ControlRequest,
  type SharedProject,
} from "./Socket.js"
import { worktreeChanges } from "./WorktreeChanges.js"
import { openedPanes } from "./Panes.js"
import { worktreeStatus } from "./Status.js"

// `gtd next` costs a process and a replay each: two at a time per workspace.
const NEXT_CAP = 2

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
  readonly noteChanged: () => void
  /** What the dashboard shows, each worktree with its driver pane. */
  readonly shared: () => readonly SharedProject[]
  readonly pauses: Pauses
  readonly dispatch: Dispatcher
  readonly after: (ms: number, run: () => void) => () => void
}

const reply = (refusal: string | undefined): ControlReply =>
  refusal === undefined ? { ok: true } : { ok: false, message: refusal }

type PauseRequest = Extract<ControlRequest, { readonly command: "pause" | "resume" }>

const isPause = (request: ControlRequest): request is PauseRequest =>
  request.command === "pause" || request.command === "resume"

type NoteRequest = Extract<ControlRequest, { readonly command: "note" }>

const noteRequest = (
  { noted, notify, projects, noteChanged }: ControlDeps,
  request: NoteRequest,
  endpoint: string,
): ControlReply => {
  const refusal = noted.note(request.worktree, request.note, endpoint)
  if (refusal !== undefined) return reply(refusal)
  noteChanged()
  if (request.note?.notify === true) notify.note(projects(), request.worktree, request.note)
  return reply(undefined)
}

const pauseRequest = async (
  { pauses, dispatch, after }: ControlDeps,
  { command, wait, ...scope }: PauseRequest,
  endpoint: string,
): Promise<ControlReply> => {
  const refusal = pauses.set(scope, command === "pause", { identity: "-", endpoint })
  if (refusal !== undefined) return reply(refusal)
  if (command === "resume") await dispatch.pass()
  if (wait === true) await whenNoDrive(() => dispatch.drivesIn(scope), after)
  return reply(undefined)
}

/** One dispatcher for the socket and the spool; `endpoint` goes into the audit log. */
const controlHandler =
  (deps: ControlDeps) =>
  (endpoint: string) =>
  async (request: ControlRequest): Promise<ControlReply> => {
    if (request.command === "projects") return { ok: true, projects: deps.shared() }
    if (request.command === "note") return noteRequest(deps, request, endpoint)
    if (isPause(request)) return pauseRequest(deps, request, endpoint)
    const { control } = deps
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
  byDefault: () => DefaultNotifications,
): { readonly adapter: NotificationsAdapter; readonly subscribe?: string } => {
  const configured = settings.adapters?.notifications
  return configured !== undefined ? { adapter: configured } : byDefault()
}

// The default topic is random: this line is the only way to learn it.
const subscribeLine = (url: string | undefined): string =>
  url === undefined ? "" : `notifications: subscribe to ${url}\n`

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
    let stopLogRuns = (): void => {}
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
      const opened = openedPanes(directory)
      const driverRuns = drivers(terminal, config, panes)
      const store = openStore(directory)
      const audit = auditLog(directory)
      const log = (line: string): void => {
        out.write(line)
        out.flush()
      }
      // One cap and one counter for every `gtd next` the supervisor starts.
      let nextActive = 0
      let nextRuns = 0
      const nextWaiting: (() => void)[] = []
      const next: typeof host.next = async (worktree) => {
        while (nextActive >= NEXT_CAP)
          await new Promise<void>((resolve) => nextWaiting.push(resolve))
        nextActive++
        nextRuns++
        try {
          return await host.next(worktree)
        } finally {
          nextActive--
          nextWaiting.shift()?.()
        }
      }
      const logRuns = (): void => {
        stopLogRuns = host.after(60_000, () => {
          log(`gtd next: ${nextRuns} runs in the last minute\n`)
          nextRuns = 0
          logRuns()
        })
      }
      logRuns()
      const notifications = notificationsOf(settings, () => host.defaultNotifications(directory))
      const notify = notifier({
        adapter: notifications.adapter,
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
        panes: opened,
        status: async (worktree) =>
          noted.withNote(
            worktree,
            worktreeStatus(await next(worktree), await driverRuns.state(worktree)),
          ),
      })
      const reactions = reactionRunner({
        reactions: loaded.reactions,
        store,
        exec: tools.exec,
        fetch: tools.fetch,
        action: (project, worktree, id, values) => actions.run(project, worktree, id, values),
        // Reactions run only once the supervisor serves, after `control` exists.
        press: (press) => control.press(press),
        notify: ({ worktree, ...message }) =>
          notify.message({ ...message, link: detailLink(worktree) }),
        now: clock.now,
        log,
      })
      const snapshot = liveSnapshot({
        worktrees,
        next,
        settings: config,
        configName: basename(file),
        drivers: driverRuns,
        fingerprint: host.fingerprint,
        services,
        lastAction: actions.last,
        after: host.after,
        changed: () => {
          // Notes notify only when sent with --notify: the raw statuses, without them.
          notify.worktrees(snapshot.projects())
          reactions.worktrees(noted.withNotes(snapshot.projects()))
        },
      })
      closeSnapshot = snapshot.close
      yield* Effect.tryPromise({ try: snapshot.start, catch: asUiError })
      const control = controls({
        worktrees,
        drivers: driverRuns,
        projects: () => noted.withNotes(snapshot.projects()),
        discover: snapshot.discover,
        oneShot: host.oneShot,
        after: host.after,
        refreshDriver: snapshot.refreshDriver,
        audit,
        now: clock.now,
      })
      const projects = () =>
        clean.withStale(noted.withNotes(control.withRefusals(snapshot.projects())))
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
        next,
        projects: snapshot.projects,
        driving: snapshot.driving,
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
        next,
        panes: opened,
        starting: dispatch.starting,
        refresh: snapshot.refresh,
        errorNote: noted.errorNote,
        cleaned: (project, worktree) => {
          const view = noted
            .withNotes(snapshot.projects())
            .flatMap((p) => p.worktrees)
            .find((w) => w.path === worktree.path)
          if (view !== undefined) reactions.cleaned(project, view)
        },
        audit,
        now: clock.now,
      })
      const clean = cleaner({
        settings: config,
        worktrees,
        projects: () => snapshot.projects().map((project) => project.id),
        changes,
        refreshed: notify.mainStale,
        after: host.after,
        log,
      })
      const handleControl = controlHandler({
        noted,
        control,
        notify,
        projects: snapshot.projects,
        noteChanged: () => reactions.worktrees(noted.withNotes(snapshot.projects())),
        shared: () =>
          projects().map((project) => ({
            ...project,
            worktrees: project.worktrees.map((worktree) => {
              const pane = driverRuns.pane(worktree.path)
              return pane === undefined ? worktree : { ...worktree, pane }
            }),
          })),
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
          reactions.replace(next.reactions)
          clean.schedule()
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
          ...clean.banners(),
          ...reactions.banners(),
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
        if (isGatePath(path)) return gatePage(request, afterResponse, peer)
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
      reactions.begin(noted.withNotes(snapshot.projects()))
      out.write(`${url}\n`)
      out.write(subscribeLine(notifications.subscribe))
      out.write(spoolRefusals.map((refusal) => `spool ${refusal}\n`).join(""))
      out.flush()
      yield* Effect.promise(dispatch.resume)
      feeds.start()
      clean.schedule()
      yield* Effect.never.pipe(
        Effect.ensuring(Effect.sync(feeds.stop)),
        Effect.ensuring(Effect.sync(clean.stop)),
        Effect.ensuring(Effect.sync(() => actions.stop())),
        Effect.ensuring(close),
      )
    }).pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          closeReload()
          stopLogRuns()
          closeSnapshot()
          await closeSocket()
          lock.release()
        }),
      ),
    )
  })
