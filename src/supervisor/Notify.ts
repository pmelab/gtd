import { basename } from "node:path"
import type {
  InboxItem,
  NotificationPriority,
  NotificationsAdapter,
  NotifySettings,
  WorkspaceSettings,
} from "../workspace/index.js"
import type { FeedView } from "./Feeds.js"
import type { ProjectView, WorktreeView } from "./Scan.js"
import type { Store } from "./Store.js"

type Kind = Exclude<keyof NotifySettings, "mainStale">

export interface NotifierDeps {
  readonly adapter: NotificationsAdapter
  readonly store: Store
  readonly settings: () => WorkspaceSettings
  readonly now: () => number
  /** A publish that failed; it is not sent again. */
  readonly log: (line: string) => void
}

export interface Notifier {
  /**
   * Starts sending, with the workspace's URL. Without a store, what is true
   * now is the silent baseline; else what changed while gtd was down is sent.
   */
  readonly begin: (url: string, projects: readonly ProjectView[]) => void
  /** The worktree statuses as of now. */
  readonly worktrees: (projects: readonly ProjectView[]) => void
  /** A feed's poll ended, with the inbox and the feeds as of now. */
  readonly polled: (feed: string, items: readonly InboxItem[], feeds: readonly FeedView[]) => void
  /** The config reloaded: `failure` is why it was not, or `undefined`. */
  readonly reloaded: (file: string, failure: string | undefined) => void
  /** A note sent with `--notify`, on the worktree at `path`. */
  readonly note: (
    projects: readonly ProjectView[],
    path: string,
    note: { readonly message: string; readonly error: boolean },
  ) => void
  /** A notification a reaction sends; `link` is a path on the dashboard. */
  readonly message: (message: {
    readonly key: string
    readonly title: string
    readonly body: string
    readonly link: string
    readonly priority: NotificationPriority
  }) => void
}

// The sent keys are kept for restarts; the oldest go first.
const MAX_KEPT = 2_000

const nameOf = (w: WorktreeView): string => w.branch ?? basename(w.path)

// A driver reports what it waits for, or why it failed, on the commit it is at;
// gtd's own status is the same for as long as the commit is.
const reportedByDriver = (w: WorktreeView): boolean =>
  w.kind !== undefined || w.errorKind === "driver" || w.errorKind === "crashed"

const PRIORITY: Readonly<Record<Kind | "note", NotificationPriority>> = {
  needsYou: "high",
  error: "high",
  proposed: "default",
  feedFailing: "low",
  configError: "default",
  note: "default",
}

interface Pending {
  readonly kind: Kind
  readonly project: string | undefined
  readonly key: string
  readonly title: string
  readonly body: string
  /** A path on the dashboard. */
  readonly link: string
}

export const notifier = (deps: NotifierDeps): Notifier => {
  const stored = deps.store.notified()
  const sent = new Set(stored ?? [])
  // With no store, what is true at startup is the baseline: each feed's first poll too.
  const baseline = stored === undefined
  let url: string | undefined
  const polledOnce = new Set<string>()
  // Notes sent before the URL is known: the spool is read before the server listens.
  const waiting: (() => void)[] = []

  const save = (): void => {
    for (const key of [...sent].slice(0, Math.max(0, sent.size - MAX_KEPT))) sent.delete(key)
    deps.store.saveNotified([...sent])
  }

  const enabled = (kind: Kind, project: string | undefined): boolean => {
    const settings = deps.settings()
    const own = project === undefined ? undefined : settings.projects?.[project]?.notify?.[kind]
    return own ?? settings.notify?.[kind] ?? true
  }

  const publish = (
    key: string,
    title: string,
    body: string,
    link: string,
    priority: NotificationPriority,
  ): void => {
    deps.adapter
      .publish({ key, title, body, url: new URL(link, url).href, priority })
      .catch((error: unknown) => {
        const message =
          typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : String(error)
        deps.log(`notification ${key} not sent: ${message}\n`)
      })
  }

  /** Each key once: a switched-off kind counts as sent, so switching it on sends no old news. */
  const send = (found: readonly Pending[], quiet: boolean): void => {
    const fresh = found.filter((p) => !sent.has(p.key))
    if (fresh.length === 0) return
    for (const p of fresh) sent.add(p.key)
    save()
    if (quiet) return
    for (const p of fresh) {
      if (enabled(p.kind, p.project)) publish(p.key, p.title, p.body, p.link, PRIORITY[p.kind])
    }
  }

  /** A condition that ended may notify again when it comes back. */
  const forget = (keep: (key: string) => boolean): void => {
    const gone = [...sent].filter((key) => !keep(key))
    if (gone.length === 0) return
    for (const key of gone) sent.delete(key)
    save()
  }

  const worktreeNews = (projects: readonly ProjectView[]): Pending[] =>
    projects.flatMap((project) =>
      project.worktrees.flatMap((w): Pending[] => {
        if (w.status !== "needsYou" && w.status !== "error") return []
        const where = `${project.id}/${nameOf(w)}`
        const label = w.status === "error" ? (w.message ?? w.label) : w.label
        const key = `${w.status}:${where}:${w.head}${reportedByDriver(w) ? `:${label}` : ""}`
        return [
          w.status === "needsYou"
            ? {
                kind: "needsYou",
                project: project.id,
                key,
                title: `${where} needs you`,
                body: label,
                link: w.gate,
              }
            : {
                kind: "error",
                project: project.id,
                key,
                title: `${where}: error`,
                body: label,
                link: detailLink(w.path),
              },
        ]
      }),
    )

  return {
    begin: (base, projects) => {
      url = base
      send(worktreeNews(projects), baseline)
      if (baseline) save()
      for (const run of waiting.splice(0)) run()
    },
    worktrees: (projects) => {
      if (url !== undefined) send(worktreeNews(projects), false)
    },
    polled: (feed, items, feeds) => {
      if (url === undefined) return
      const quiet = baseline && !polledOnce.has(feed)
      polledOnce.add(feed)
      const view = feeds.find((f) => f.feed === feed)
      if (view?.failing === undefined) forget((key) => key !== `feedFailing:${feed}`)
      send(feedNews(feed, items, view), quiet)
    },
    reloaded: (file, failure) => {
      if (failure === undefined) {
        forget((key) => !key.startsWith("configError:"))
        return
      }
      if (url === undefined) return
      send(
        [
          {
            kind: "configError",
            project: undefined,
            key: `configError:${failure}`,
            title: `${file} not reloaded`,
            body: failure,
            link: "/",
          },
        ],
        false,
      )
    },
    note: (projects, path, note) => {
      for (const project of projects) {
        const w = project.worktrees.find((v) => v.path === path)
        if (w === undefined) continue
        const where = `${project.id}/${nameOf(w)}`
        const deliver = (): void =>
          publish(
            `note:${where}:${deps.now()}`,
            note.error ? `${where}: error note` : `${where}: note`,
            note.message,
            detailLink(path),
            note.error ? "high" : PRIORITY.note,
          )
        if (url === undefined) waiting.push(deliver)
        else deliver()
        return
      }
    },
    message: (m) => {
      const deliver = (): void => publish(m.key, m.title, m.body, m.link, m.priority)
      if (url === undefined) waiting.push(deliver)
      else deliver()
    },
  }
}

const feedNews = (
  feed: string,
  items: readonly InboxItem[],
  view: FeedView | undefined,
): Pending[] => [
  ...items
    .filter((item) => item.feed === feed && item.state === "proposed")
    .map(
      (item): Pending => ({
        kind: "proposed",
        project: item.project,
        key: `proposed:${item.feed}/${item.key}`,
        title: `Proposed: ${item.title}`,
        body: `${item.feed} · ${item.project}`,
        link: "/",
      }),
    ),
  ...(view?.failing === undefined
    ? []
    : [
        {
          kind: "feedFailing" as const,
          project: view.project,
          key: `feedFailing:${feed}`,
          title: `feed ${feed} failing`,
          body: view.failing,
          link: "/",
        },
      ]),
]

/** The dashboard, with the worktree's detail open. */
export const detailLink = (path: string): string => `/?worktree=${encodeURIComponent(path)}`
