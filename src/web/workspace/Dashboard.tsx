import { useEffect, useState } from "react"
import { Notice } from "../Notice.js"
import { workspaceTrpc } from "./api.js"
import { Banners } from "./Banners.js"
import { Detail } from "./Detail.js"
import { Inbox, type PressFailure } from "./Inbox.js"
import { Now } from "./Now.js"
import { Projects } from "./Projects.js"
import { TabBar } from "./TabBar.js"
import { useExpanded } from "./useExpanded.js"
import {
  nowView,
  parseScreen,
  screenUrl,
  type Banner,
  type Entry,
  type ProjectView,
  type Screen,
  type View,
} from "./view.js"

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

const Unread = ({ error }: { readonly error: { readonly message: string } | null }) =>
  error === null ? (
    <p className="text-muted">Loading…</p>
  ) : (
    <Notice tone="error" data-testid="inbox-error">
      Could not read the inbox: {error.message}
    </Notice>
  )

const InboxView = () => {
  const inbox = workspaceTrpc.inbox.useQuery(undefined, {
    refetchInterval: REFRESH_MS,
  })
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
  const [expanded, toggle] = useExpanded(projects)
  const { view } = screen
  const entry = find(projects, screen.worktree)
  const vanished = screen.worktree !== undefined && entry === undefined
  useEffect(() => {
    if (!vanished) return
    window.history.replaceState(null, "", screenUrl({ view }))
    setScreen({ view })
  }, [vanished, view])
  const open = (e: Entry) => {
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
  const attention = nowView(projects).attention.length
  const views: readonly (readonly [View, string])[] = [
    ["now", attention > 0 ? `Now (${attention})` : "Now"],
    ["projects", "Projects"],
    ["inbox", "Inbox"],
  ]
  if (entry !== undefined) {
    return <Detail key={entry.worktree.path} entry={entry} onClose={close} />
  }
  return (
    <div className="flex min-h-dvh flex-col bg-page text-text">
      <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
        <Banners banners={banners} />
        {view === "now" && <Now projects={projects} onOpen={open} />}
        {view === "projects" && (
          <Projects projects={projects} expanded={expanded} onToggle={toggle} onOpen={open} />
        )}
        {view === "inbox" && <InboxView />}
      </main>
      <TabBar
        label="Views"
        tabs={views}
        current={view}
        onSelect={(next) => {
          go({ view: next })
        }}
        className="fixed bottom-0 w-full border-t"
      />
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
  if (projects.error !== null) {
    return (
      <Notice tone="error" data-testid="dashboard-error">
        Could not reach the supervisor: {projects.error.message}
      </Notice>
    )
  }
  if (projects.data === undefined) {
    return (
      <Notice data-testid="dashboard-loading" aria-busy="true">
        Loading…
      </Notice>
    )
  }
  return <Loaded projects={projects.data} banners={banners.data ?? []} />
}
