// PROTOTYPE — throwaway (pmelab/gtd#593). Fake workspace data shared by the three variants.

export type Status = "gate" | "error" | "working" | "idle"

export interface Service {
  readonly name: string
  readonly url: string
  readonly running: boolean
}

export interface Field {
  readonly name: string
  readonly kind: "text" | "select" | "flag"
  readonly required?: boolean
  readonly choices?: readonly string[]
  readonly placeholder?: string
  readonly help?: string
}

/** One action (mise task `start:*`, `gate:*`, `error:*`, `any:*`). */
export interface Action {
  readonly id: string
  readonly label: string
  readonly statuses: readonly Status[]
  readonly fields: readonly Field[]
}

export interface Row {
  readonly project: string
  readonly worktree: string
  readonly branch: string
  readonly status: Status
  readonly label: string
  readonly age: string
  readonly services: readonly Service[]
  /** What the terminal adapter reports for the worktree's terminal. */
  readonly terminal: string
  readonly note?: string
  readonly errorKind?: "drive" | "ship" | "conflict"
}

export interface Project {
  readonly id: string
  readonly name: string
  readonly paused?: boolean
  readonly services: readonly Service[]
  readonly rows: readonly Row[]
}

export type InboxState = "proposed" | "queued" | "blocked" | "starting" | "started" | "shipped" | "failed"

export interface InboxItem {
  readonly key: string
  readonly title: string
  readonly project: string
  readonly source: string
  readonly workflow: string
  readonly state: InboxState
  readonly priority: number
  readonly worktree?: string
  readonly blockedBy?: string
  readonly url: string
}

export const marker: Record<Status, string> = { gate: "🙋", error: "❌", working: "⚙️", idle: "💤" }
export const statusText: Record<Status, string> = {
  gate: "needs you",
  error: "error",
  working: "working",
  idle: "idle",
}
export const statusColor: Record<Status, string> = {
  gate: "text-warning",
  error: "text-danger",
  working: "text-link",
  idle: "text-muted",
}
export const statusBar: Record<Status, string> = {
  gate: "bg-warning",
  error: "bg-danger",
  working: "bg-accent",
  idle: "bg-divider",
}

export const actions: readonly Action[] = [
  { id: "start:lean", label: "Lean: design, one pass, capped quality loop", statuses: ["idle"], fields: [{ name: "todo", kind: "text", required: true, placeholder: "What to do", help: "Written verbatim to .gtd/TODO.md" }] },
  { id: "start:feature", label: "Feature", statuses: ["idle"], fields: [{ name: "todo", kind: "text", required: true, placeholder: "What to build" }] },
  { id: "start:fix", label: "Fix", statuses: ["idle"], fields: [] },
  { id: "start:review", label: "Review", statuses: ["idle"], fields: [{ name: "base", kind: "text", placeholder: "main", help: "Empty: the default branch" }] },
  { id: "start:pr-review", label: "PR review", statuses: ["idle"], fields: [{ name: "pr", kind: "text", required: true, placeholder: "123 or URL" }, { name: "dry-run", kind: "flag" }] },
  { id: "error:triage", label: "Triage", statuses: ["error"], fields: [] },
  { id: "error:retry-ship", label: "Retry ship", statuses: ["error"], fields: [] },
  { id: "error:resolve", label: "Resolve conflict", statuses: ["error"], fields: [{ name: "strategy", kind: "select", choices: ["rebase", "merge"] }] },
  { id: "any:tests", label: "Run tests", statuses: ["gate", "error", "idle"], fields: [] },
]

export const actionsFor = (s: Status) => actions.filter((a) => a.statuses.includes(s))

const svc = (p: string, wt: string, names: Array<[string, boolean]>): Service[] =>
  names.map(([name, running]) => ({ name, running, url: `https://${name}.${wt}.${p}.internal` }))

export const projects: readonly Project[] = [
  {
    id: "portal",
    name: "Portal",
    services: svc("portal", "main", [["web", true], ["api", true]]),
    rows: [
      { project: "portal", worktree: "feat-PRT-412-rate-limit", branch: "feat/PRT-412-rate-limit", status: "gate", label: "Design: confirm acceptance criteria", age: "4m", services: svc("portal", "feat-prt-412", [["web", true], ["api", true], ["storybook", false]]), terminal: "driver blocked (question): design.confirm" },
      { project: "portal", worktree: "fix-login-redirect", branch: "fix/login-redirect", status: "error", errorKind: "ship", label: "Ship failed: push rejected", age: "12m", note: "Triage: remote has newer commits; rebase needed. REDRIVE", services: svc("portal", "fix-login", [["web", false]]), terminal: "driver error: ship · exit 1" },
      { project: "portal", worktree: "feat-PRT-398-export", branch: "feat/PRT-398-export", status: "working", label: "Build: implement export endpoint", age: "1m", services: svc("portal", "feat-prt-398", [["web", true], ["api", true]]), terminal: "driver working: agent turn" },
      { project: "portal", worktree: "spike-cache", branch: "spike/cache", status: "idle", label: "no process", age: "2d", services: [], terminal: "terminal idle" },
    ],
  },
  {
    id: "gtd",
    name: "gtd",
    services: [],
    rows: [
      { project: "gtd", worktree: "lean-workspace-adapters", branch: "lean/workspace-adapters", status: "working", label: "Quality: lens test-audit (lap 2/3)", age: "30s", services: [], terminal: "driver working: running check" },
      { project: "gtd", worktree: "review-main", branch: "review/main", status: "gate", label: "Review: sit with 7 chunks", age: "1h", services: [], terminal: "driver blocked (question): review.sitting" },
      { project: "gtd", worktree: "fix-repin", branch: "fix/repin", status: "error", errorKind: "drive", label: "Stalled: agent changed nothing", age: "25m", services: [], terminal: "driver error: stall" },
    ],
  },
  {
    id: "workbench",
    name: "workbench",
    paused: true,
    services: [],
    rows: [
      { project: "workbench", worktree: "feat-17-ntfy-seq", branch: "feat/17-ntfy-seq", status: "idle", label: "finished · shipped", age: "3h", services: [], terminal: "last: start:lean ✓" },
      { project: "workbench", worktree: "chore-deps", branch: "chore/deps", status: "idle", label: "no process", age: "6d", services: [], terminal: "terminal missing" },
    ],
  },
]

export const allRows = projects.flatMap((p) => p.rows)

export const inbox: readonly InboxItem[] = [
  { key: "PRT-420", title: "Add audit log to team settings", project: "portal", source: "jira", workflow: "feature", state: "queued", priority: 2, url: "#" },
  { key: "PRT-421", title: "Migrate invoices to new API", project: "portal", source: "jira", workflow: "lean", state: "blocked", priority: 1, blockedBy: "PRT-398", url: "#" },
  { key: "gtd#601", title: "gtd next should report the judge's file", project: "gtd", source: "github-issues", workflow: "lean", state: "proposed", priority: 3, url: "#" },
  { key: "portal#88", title: "Review: bump Next.js", project: "portal", source: "github-reviews", workflow: "pr-review", state: "queued", priority: 1, url: "#" },
  { key: "PRT-398", title: "CSV export for reports", project: "portal", source: "jira", workflow: "feature", state: "started", priority: 2, worktree: "feat-PRT-398-export", url: "#" },
  { key: "workbench#17", title: "Use ntfy sequence ids", project: "workbench", source: "github-project", workflow: "lean", state: "shipped", priority: 2, worktree: "feat-17-ntfy-seq", url: "#" },
  { key: "PRT-377", title: "Drop legacy SSO flag", project: "portal", source: "jira", workflow: "lean", state: "failed", priority: 3, url: "#" },
]

export const limits = { drives: 2, maxDrives: 3, paused: ["workbench"] }
