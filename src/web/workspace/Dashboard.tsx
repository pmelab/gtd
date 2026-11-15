import { useState } from "react"
import { cn } from "../cn.js"
import { Notice } from "../Notice.js"
import { workspaceTrpc } from "./api.js"
import { Banners } from "./Banners.js"
import { Detail } from "./Detail.js"
import { Inbox } from "./Inbox.js"
import { Now } from "./Now.js"
import { Projects } from "./Projects.js"
import { TabBar } from "./TabBar.js"
import { linkedWorktree, nowView, type Banner, type Entry, type ProjectView } from "./view.js"

type View = "now" | "projects" | "inbox"

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

const InboxView = () => {
  const inbox = workspaceTrpc.inbox.useQuery(undefined, { refetchInterval: REFRESH_MS })
  const utils = workspaceTrpc.useUtils()
  const settled = { onSettled: () => utils.inbox.invalidate() }
  const mutations = {
    start: workspaceTrpc.startItem.useMutation(settled),
    retry: workspaceTrpc.retryItem.useMutation(settled),
    dismiss: workspaceTrpc.dismiss.useMutation(settled),
  }
  if (inbox.data === undefined) return <p className="text-muted">Loading…</p>
  return (
    <Inbox
      items={inbox.data.items}
      feeds={inbox.data.feeds}
      onPress={(press, item) => {
        mutations[press].mutate({ feed: item.feed, key: item.key })
      }}
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
  const [view, setView] = useState<View>("now")
  const [selected, setSelected] = useState(() => linkedWorktree(window.location.search))
  const entry = find(projects, selected)
  const open = (e: Entry) => {
    setSelected(e.worktree.path)
  }
  const attention = nowView(projects).attention.length
  const views: readonly (readonly [View, string])[] = [
    ["now", attention > 0 ? `Now (${attention})` : "Now"],
    ["projects", "Projects"],
    ["inbox", "Inbox"],
  ]
  return (
    <div className="flex min-h-dvh bg-page text-text">
      <div
        className={cn(
          "flex w-full flex-col md:max-w-[480px] md:shrink-0",
          entry !== undefined && "hidden md:flex",
        )}
      >
        <main className="flex flex-1 flex-col gap-4 p-4 pb-24 md:pb-4">
          <Banners banners={banners} />
          {view === "now" && <Now projects={projects} onOpen={open} />}
          {view === "projects" && (
            <Projects projects={projects} selected={selected} onOpen={open} />
          )}
          {view === "inbox" && <InboxView />}
        </main>
        <TabBar
          label="Views"
          tabs={views}
          current={view}
          onSelect={setView}
          className="fixed bottom-0 w-full border-t md:sticky md:max-w-[480px]"
        />
      </div>
      {entry !== undefined && (
        <Detail
          key={entry.worktree.path}
          entry={entry}
          onClose={() => {
            setSelected(undefined)
          }}
        />
      )}
    </div>
  )
}

/**
 * The workspace dashboard: Now, Projects and Inbox, with the detail of a
 * worktree over the list on a phone and beside it on a wide screen.
 */
export const Dashboard = () => {
  const projects = workspaceTrpc.projects.useQuery(undefined, { refetchInterval: REFRESH_MS })
  const banners = workspaceTrpc.banners.useQuery(undefined, { refetchInterval: REFRESH_MS })
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
