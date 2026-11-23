import { GtdWordmark } from "../GtdWordmark.js"
import { Bell, FolderGit2, Inbox as InboxIcon, PanelRight, Zap } from "lucide-react"
import { useEffect, useState, useSyncExternalStore } from "react"
import { Button } from "../Button.js"
import { Notice } from "../Notice.js"
import { staleVersion } from "../push.js"
import { Skeleton } from "../ui/skeleton.js"
import { workspaceTrpc } from "./api.js"
import { Banners } from "./Banners.js"
import { Detail } from "./Detail.js"
import { Inbox, type PressFailure } from "./Inbox.js"
import { Notifications } from "./Notifications.js"
import { Now } from "./Now.js"
import { Projects } from "./Projects.js"
import { ProjectNav, ViewNav, type ViewTab } from "./TabBar.js"
import { useExpanded } from "./useExpanded.js"
import {
  decisionCount,
  nowView,
  parseScreen,
  screenUrl,
  type Banner,
  type Entry,
  type ProjectView,
  type Screen,
  type View,
} from "./view.js"

const DESKTOP = "(min-width: 1024px)"

/** From Tailwind's `lg` up there is room for a list and a detail side by side. */
const useDesktop = (): boolean =>
  useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(DESKTOP)
      query.addEventListener("change", notify)
      return () => {
        query.removeEventListener("change", notify)
      }
    },
    () => window.matchMedia(DESKTOP).matches,
  )

// The supervisor keeps a snapshot; reading it is cheap.
const REFRESH_MS = 2_000

/** The selected worktree as of the latest read, so its detail follows its status. */
const find = (projects: readonly ProjectView[], path: string | undefined): Entry | undefined => {
  for (const project of projects) {
    const worktree = project.worktrees.find((w) => w.path === path)
    if (worktree !== undefined) return { project, worktree }
  }
  return undefined
}

interface Sent<Input> {
  readonly error: { readonly message: string } | null
  readonly variables?: Input | undefined
}

const pressFailuresOf = (
  sent: readonly Sent<{ readonly feed: string; readonly key: string }>[],
): readonly PressFailure[] =>
  sent.flatMap(({ error, variables }) =>
    error !== null && variables !== undefined ? [{ ...variables, message: error.message }] : [],
  )

const NEXT_STEP = "Check that gtd workspace is running, then retry."

/** Placeholder cards while the first read is on its way. */
const Loading = ({ testId }: { readonly testId?: string }) => (
  <div className="flex flex-col gap-3" data-testid={testId} aria-busy="true">
    <span className="sr-only" role="status">
      Loading…
    </span>
    {[0, 1, 2].map((i) => (
      <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-9 w-full" />
      </div>
    ))}
  </div>
)

const Unread = ({ error }: { readonly error: { readonly message: string } | null }) =>
  error === null ? (
    <Loading />
  ) : (
    <Notice tone="error" className="w-full">
      <p data-testid="inbox-error">Could not read the inbox: {error.message}</p>
      <p className="text-muted-foreground">{NEXT_STEP}</p>
    </Notice>
  )

const useInbox = () =>
  workspaceTrpc.inbox.useQuery(undefined, {
    refetchInterval: REFRESH_MS,
  })

const InboxView = () => {
  const inbox = useInbox()
  const utils = workspaceTrpc.useUtils()
  const settled = { onSettled: () => utils.inbox.invalidate() }
  const mutations = {
    start: workspaceTrpc.startItem.useMutation(settled),
    retry: workspaceTrpc.retryItem.useMutation(settled),
    dismiss: workspaceTrpc.dismiss.useMutation(settled),
  }
  const pause = workspaceTrpc.pause.useMutation(settled)
  const resume = workspaceTrpc.resume.useMutation(settled)
  if (inbox.data === undefined) return <Unread error={inbox.error} />
  // The latest of Pause and Resume: a Resume that went through clears a failed Pause.
  const pausing = pause.submittedAt > resume.submittedAt ? pause : resume
  return (
    <Inbox
      items={inbox.data.items}
      feeds={inbox.data.feeds}
      drives={inbox.data.drives}
      paused={inbox.data.paused}
      onPress={(press, item) => {
        mutations[press].mutate({ feed: item.feed, key: item.key })
      }}
      onPause={(scope, paused) => {
        if (paused) pause.mutate(scope)
        else resume.mutate(scope)
      }}
      pressFailures={pressFailuresOf(Object.values(mutations))}
      pauseFailure={pausing.error?.message}
    />
  )
}

// fallow-ignore-next-line complexity
const Loaded = ({
  projects,
  banners,
}: {
  readonly projects: readonly ProjectView[]
  readonly banners: readonly Banner[]
}) => {
  const [screen, setScreen] = useState(() => parseScreen(window.location.search))
  useEffect(() => {
    const onPop = () => {
      setScreen(parseScreen(window.location.search))
    }
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener("popstate", onPop)
    }
  }, [])
  // Each in-page step is a history entry; `inPage` tells close there is one to go back to.
  const go = (next: Screen) => {
    window.history.pushState({ inPage: true }, "", screenUrl(next))
    setScreen(next)
  }
  const [notifying, setNotifying] = useState(false)
  const bell = (
    <Button
      variant="ghost"
      aria-label="Notifications"
      data-testid="open-notifications"
      onClick={() => {
        setNotifying(true)
      }}
    >
      <Bell aria-hidden="true" />
    </Button>
  )
  const [expanded, toggle] = useExpanded(projects)
  const [reveal, setReveal] = useState<string>()
  useEffect(() => {
    if (reveal === undefined) return
    document.querySelector(`[data-project-id="${CSS.escape(reveal)}"]`)?.scrollIntoView()
    setReveal(undefined)
  }, [reveal])
  const { view } = screen
  const entry = find(projects, screen.worktree)
  const vanished = screen.worktree !== undefined && entry === undefined
  useEffect(() => {
    if (!vanished) return
    window.history.replaceState(null, "", screenUrl({ view }))
    setScreen({ view })
  }, [vanished, view])
  const [opened, setOpened] = useState(0)
  const open = (e: Entry) => {
    setOpened((n) => n + 1)
    go({ view, worktree: e.worktree.path })
  }
  const close = () => {
    if ((window.history.state as { inPage?: boolean } | null)?.inPage === true) {
      window.history.back()
    } else {
      window.history.replaceState(null, "", screenUrl({ view: "now" }))
      setScreen({ view: "now" })
    }
  }
  const desktop = useDesktop()
  const attention = nowView(projects).attention.length
  const decisions = decisionCount(useInbox().data?.items ?? [])
  const tabs: readonly ViewTab<View>[] = [
    { id: "now", label: "Now", icon: Zap, count: attention, attention: true },
    { id: "projects", label: "Projects", icon: FolderGit2 },
    { id: "inbox", label: "Inbox", icon: InboxIcon, count: decisions },
  ]
  const title = tabs.find((t) => t.id === view)?.label
  const onSelect = (next: View) => {
    go({ view: next })
  }
  // One tree for both widths, so crossing 1024 px keeps Detail (and its tab) mounted.
  const split = desktop && view !== "inbox"
  const detailOnly = !desktop && entry !== undefined
  const selected = desktop ? entry?.worktree.path : undefined
  const list = (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 lg:mx-0">
      <Banners banners={banners} />
      {notifying && (
        <Notifications
          onClose={() => {
            setNotifying(false)
          }}
        />
      )}
      {!notifying && view === "now" && (
        <Now projects={projects} selected={selected} onOpen={open} />
      )}
      {!notifying && view === "projects" && (
        <Projects
          projects={projects}
          expanded={expanded}
          selected={selected}
          onToggle={toggle}
          onOpen={open}
        />
      )}
      {!notifying && view === "inbox" && <InboxView />}
    </div>
  )
  const nav = (
    <ViewNav
      vertical={desktop}
      tabs={tabs}
      current={view}
      onSelect={onSelect}
      className={
        desktop ? "px-3" : "fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card pb-safe"
      }
    />
  )
  return (
    <div
      className={
        desktop
          ? "flex h-dvh bg-background text-foreground"
          : "flex min-h-dvh flex-col bg-background text-foreground"
      }
    >
      {desktop && (
        <aside className="flex w-70 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-card pb-4">
          <div className="flex h-14 shrink-0 items-center px-6">
            <GtdWordmark className="h-7" />
          </div>
          {nav}
          <ProjectNav
            projects={projects}
            onSelect={(project) => {
              toggle(project, true)
              if (view !== "projects") go({ view: "projects" })
              setReveal(project)
            }}
          />
        </aside>
      )}
      {!desktop && !detailOnly && (
        <header className="sticky top-0 z-10 flex min-h-12 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 pt-safe backdrop-blur">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="flex items-center gap-1">
            {bell}
            <GtdWordmark className="h-5" />
          </div>
        </header>
      )}
      <main className="flex min-w-0 flex-1">
        {!detailOnly && (
          <div
            className={
              desktop
                ? `flex min-w-0 flex-col ${split ? "w-[28rem] shrink-0 border-r border-border xl:w-[32rem]" : "flex-1"}`
                : "flex min-w-0 flex-1 flex-col px-4 pt-4 pb-[calc(5rem+var(--safe-bottom,env(safe-area-inset-bottom)))]"
            }
          >
            {desktop ? (
              <>
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
                  <h1 className="text-lg font-semibold">{title}</h1>
                  {bell}
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-4 xl:p-6">{list}</div>
              </>
            ) : (
              list
            )}
          </div>
        )}
        {entry !== undefined ? (
          <Detail
            key={entry.worktree.path}
            entry={entry}
            onClose={close}
            embedded={desktop}
            opened={opened}
          />
        ) : (
          split && (
            <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
              <PanelRight aria-hidden="true" className="size-6" />
              <p data-testid="detail-placeholder">Select a worktree to see its gate and actions.</p>
            </div>
          )
        )}
      </main>
      {!desktop && !detailOnly && nav}
    </div>
  )
}

/**
 * The workspace dashboard: Now, Projects and Inbox, each a full
 * screen, and a worktree's detail as a screen of its own.
 */
export const Dashboard = () => {
  const projects = workspaceTrpc.projects.useQuery(undefined, {
    refetchInterval: REFRESH_MS,
  })
  const banners = workspaceTrpc.banners.useQuery(undefined, {
    refetchInterval: REFRESH_MS,
  })
  const supervisor = workspaceTrpc.version.useQuery(undefined, { refetchInterval: 10_000 })
  const own = document.querySelector<HTMLMetaElement>('meta[name="gtd-version"]')?.content
  const outdated = staleVersion(own, supervisor.data)
  useEffect(() => {
    if (outdated) window.location.reload()
  }, [outdated])
  if (projects.error !== null) {
    return (
      <div className="min-h-dvh bg-background p-4">
        <Notice tone="error">
          <p data-testid="dashboard-error">Cannot reach the workspace</p>
          <p className="text-muted-foreground">{NEXT_STEP}</p>
          <Button
            variant="secondary"
            data-testid="dashboard-retry"
            onClick={() => {
              void projects.refetch()
            }}
          >
            Retry
          </Button>
        </Notice>
      </div>
    )
  }
  if (projects.data === undefined) {
    return (
      <div className="mx-auto min-h-dvh max-w-2xl bg-background p-4">
        <Loading testId="dashboard-loading" />
      </div>
    )
  }
  return <Loaded projects={projects.data} banners={banners.data ?? []} />
}
