import type { inferRouterOutputs } from "@trpc/server"
import type { WorkspaceRouter } from "../../supervisor/index.js"

/** The API's answers as they arrive: JSON, so a key that was `undefined` is absent. */
type Outputs = inferRouterOutputs<WorkspaceRouter>
export type ProjectView = Outputs["projects"][number]
export type WorktreeView = ProjectView["worktrees"][number]
export type Service = NonNullable<WorktreeView["services"]>[number]
export type Banner = Outputs["banners"][number]
export type TerminalView = Outputs["terminal"]
export type InboxItem = Outputs["inbox"]["items"][number]
export type FeedView = Outputs["inbox"]["feeds"][number]
export type DrivesView = Outputs["inbox"]["drives"]
export type Action = Outputs["actions"]["actions"][number]
export type ActionField = Action["fields"][number]

export type StatusName = WorktreeView["status"]

/** One worktree with the project it belongs to. */
export interface Entry {
  readonly project: ProjectView
  readonly worktree: WorktreeView
}

export interface NowView {
  /** Gates and errors across all projects: each has one primary button. */
  readonly attention: readonly Entry[]
  /** Collapsed: they need nobody now. */
  readonly working: readonly Entry[]
}

const entries = (projects: readonly ProjectView[]): Entry[] =>
  projects.flatMap((project) => project.worktrees.map((worktree) => ({ project, worktree })))

export const nowView = (projects: readonly ProjectView[]): NowView => {
  const all = entries(projects)
  return {
    attention: all.filter(
      ({ worktree }) => worktree.status === "needsYou" || worktree.status === "error",
    ),
    working: all.filter(({ worktree }) => worktree.status === "working"),
  }
}

export const worktreeName = (w: WorktreeView): string =>
  w.branch ?? w.path.split("/").at(-1) ?? w.path

const STATUS_TEXT: Readonly<Record<StatusName, string>> = {
  needsYou: "needs you",
  working: "working",
  error: "error",
  idle: "idle",
}

export const STATUS_COLOR: Readonly<Record<StatusName, string>> = {
  needsYou: "text-warning",
  working: "text-link",
  error: "text-danger",
  idle: "text-muted",
}

/** The status in words: `needs you (question)`, `error (crashed)`. */
export const statusText = (w: WorktreeView): string => {
  const kind = w.errorKind ?? w.kind
  return kind === undefined ? STATUS_TEXT[w.status] : `${STATUS_TEXT[w.status]} (${kind})`
}

/** What the worktree waits for, and why: its label, then its message. */
export const detailText = (w: WorktreeView): string =>
  [w.label, w.message].filter((s) => s !== undefined && s !== "").join(" — ")

/** The control a worktree's status offers, if any. */
export const pressFor = (w: WorktreeView): "proceed" | "retry" | undefined =>
  w.status === "needsYou" ? "proceed" : w.status === "error" ? "retry" : undefined
