import type { ProjectView, WorktreeView } from "./view.js"

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

/** A workspace with a worktree in each status, chips, a refusal and a greyed project. */
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
        refusal: "busy: still answering the last question",
      }),
      worktree("portal", "login", {
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
