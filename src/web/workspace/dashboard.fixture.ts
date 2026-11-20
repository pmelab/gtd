import type { InboxItem, ProjectView, WorktreeView } from "./view.js"

const worktree = (project: string, branch: string, over: Partial<WorktreeView>): WorktreeView => ({
  path: `/ws/${project}-${branch}`,
  branch,
  head: `${branch}-head`,
  main: branch === "main",
  // A real gate path would load the story host itself into the frame.
  gate: `data:text/html,gate of ${project}/${branch}`,
  status: "idle",
  label: "Idle",
  ...over,
})

/** A workspace with a worktree in each status, chips, a refusal, a note and a greyed project. */
export const workspace: readonly ProjectView[] = [
  {
    id: "api",
    name: "api",
    worktrees: [
      worktree("api", "main", {}),
      worktree("api", "broken", {
        status: "error",
        errorKind: "crashed",
        label: "Driver crashed",
        message: "the driver exited with 1",
      }),
      worktree("api", "build", { status: "working", label: "Building" }),
    ],
  },
  {
    id: "portal",
    name: "Portal",
    worktrees: [
      worktree("portal", "main", {
        services: [{ name: "web", url: "https://web.portal.example.ts.net", running: true }],
      }),
      worktree("portal", "plan", {
        status: "needsYou",
        kind: "question",
        label: "Answer the plan",
        gated: true,
        refusal: "busy: still answering the last question",
      }),
      worktree("portal", "login", {
        note: { message: "merged into main", error: false },
        services: [
          { name: "web", url: "https://web.login.portal.example.ts.net", running: false },
          { name: "jobs", running: false, error: "exit code 3" },
        ],
      }),
    ],
  },
]

/** The Portal project read while the worktrees adapter is down: last known statuses, greyed. */
export const outage: readonly ProjectView[] = [
  {
    id: "portal",
    name: "Portal",
    failure: { adapter: "worktrees", op: "list", message: "wt list failed" },
    worktrees: [
      worktree("portal", "main", {
        unavailable: { adapter: "worktrees", op: "list", message: "wt list failed" },
        servicesFailure: {
          adapter: "services",
          op: "list",
          message: "the pitchfork supervisor is not running",
        },
        services: [],
      }),
    ],
  },
]

export const nothingNeedsYou: readonly ProjectView[] = [
  { id: "api", name: "api", worktrees: [worktree("api", "main", {})] },
]

const statusCases = (project: string): Record<string, WorktreeView> => ({
  idle: worktree(project, "idle", {}),
  idleNote: worktree(project, "idle-note", {
    note: { message: "merged into main", error: false },
  }),
  gate: worktree(project, "gate", {
    status: "needsYou",
    label: "Answer the plan",
  }),
  permission: worktree(project, "permission", {
    status: "needsYou",
    kind: "permission",
    label: "Allow the edit",
  }),
  question: worktree(project, "question", {
    status: "needsYou",
    kind: "question",
    label: "Pick a store",
  }),
  noDriver: worktree(project, "no-driver", {
    status: "needsYou",
    label: "Build the change",
    message: "no driver runs",
  }),
  working: worktree(project, "working", { status: "working", label: "Building" }),
  stalled: worktree(project, "stalled", {
    status: "error",
    errorKind: "stalled",
    label: "Stalled",
    message: "the process cannot go on",
  }),
  crashed: worktree(project, "crashed", {
    status: "error",
    errorKind: "crashed",
    label: "Driver crashed",
    message: "the driver exited with 1",
  }),
  driver: worktree(project, "driver", {
    status: "error",
    errorKind: "driver",
    label: "Driver failed",
    message: "the model refused",
  }),
  note: worktree(project, "note", {
    status: "error",
    errorKind: "note",
    label: "Note failed",
    message: "gh: not logged in",
    note: { message: "gh: not logged in", error: true },
  }),
})

const cases = statusCases("shop")

export const statusWorktrees: Readonly<Record<string, WorktreeView>> = cases

const calm = (project: string, branches: readonly string[]): WorktreeView[] =>
  branches.map((b, i) =>
    worktree(project, b, i % 2 === 0 ? {} : { status: "working", label: "Building" }),
  )

export const fullWorkspace: readonly ProjectView[] = [
  { id: "shop", name: "shop", worktrees: Object.values(cases) },
  { id: "blog", name: "blog", worktrees: Object.values(statusCases("blog")) },
  { id: "docs", name: "docs", worktrees: calm("docs", ["main", "typos", "theme"]) },
  { id: "empty", name: "empty", worktrees: [] },
]

const feedItem = (
  project: string,
  key: string,
  state: InboxItem["state"],
  over: Partial<InboxItem> = {},
): InboxItem => ({
  feed: `${project}Feed`,
  project,
  key,
  title: `${state} item ${key}`,
  action: "start:work",
  priority: 0,
  blockedBy: [],
  data: null,
  state,
  firstSeen: "2026-01-01T00:00:00.000Z",
  ...over,
})

export const fullInbox = {
  items: [
    feedItem("shop", "1", "proposed"),
    feedItem("shop", "2", "queued", { message: "2 of 2 drives in use (limits.maxDrives)" }),
    feedItem("blog", "3", "blocked", { blockedBy: ["blog#1"] }),
    feedItem("blog", "4", "starting"),
    feedItem("docs", "5", "started"),
    feedItem("docs", "6", "failed", { message: "start:work exited 1" }),
  ],
  drives: { inUse: 2, max: 2 },
  paused: [],
  feeds: [
    { feed: "shopFeed", project: "shop", mode: "propose", every: "5m" },
    { feed: "blogFeed", project: "blog", mode: "propose", every: "5m" },
    { feed: "docsFeed", project: "docs", mode: "propose", every: "5m" },
  ],
}
