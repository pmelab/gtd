import { describe, expect, it } from "vitest"
import {
  linkedWorktree,
  noteText,
  nowView,
  pressFor,
  statusText,
  worktreeName,
  type ProjectView,
  type WorktreeView,
} from "./view.js"

const worktree = (branch: string, over: Partial<WorktreeView>): WorktreeView => ({
  path: `/ws/${branch}`,
  branch,
  head: "abc",
  main: false,
  gate: `/p/${branch}/gate`,
  status: "idle",
  label: "Idle",
  ...over,
})

const projects: readonly ProjectView[] = [
  {
    id: "api",
    name: "api",
    worktrees: [
      worktree("main", { main: true }),
      worktree("broken", { status: "error", errorKind: "crashed", label: "Driver crashed" }),
      worktree("build", { status: "working", label: "Building" }),
    ],
  },
  {
    id: "portal",
    name: "Portal",
    worktrees: [
      worktree("plan", { status: "needsYou", kind: "question", label: "Answer the plan" }),
      worktree("tests", { status: "working", label: "Tests" }),
    ],
  },
]

const names = (entries: readonly { project: ProjectView; worktree: WorktreeView }[]) =>
  entries.map((e) => `${e.project.id}/${worktreeName(e.worktree)}`)

describe("nowView", () => {
  it("lists only the gates and errors across all projects as needing attention", () => {
    expect(names(nowView(projects).attention)).toEqual(["api/broken", "portal/plan"])
  })

  it("keeps the working worktrees apart, to show them collapsed", () => {
    expect(names(nowView(projects).working)).toEqual(["api/build", "portal/tests"])
  })

  it("has nothing for a workspace where nothing needs anyone", () => {
    expect(nowView([{ id: "api", name: "api", worktrees: [worktree("main", {})] }])).toEqual({
      attention: [],
      working: [],
    })
  })
})

describe("pressFor", () => {
  it("offers Proceed at a gate, Retry on an error and nothing otherwise", () => {
    expect(pressFor(worktree("a", { status: "needsYou" }))).toBe("proceed")
    expect(pressFor(worktree("a", { status: "error" }))).toBe("retry")
    expect(pressFor(worktree("a", { status: "working" }))).toBeUndefined()
    expect(pressFor(worktree("a", { status: "idle" }))).toBeUndefined()
  })
})

describe("statusText", () => {
  it("names what the driver waits for, or the kind of error", () => {
    expect(statusText(worktree("a", { status: "needsYou", kind: "permission" }))).toBe(
      "needs you (permission)",
    )
    expect(statusText(worktree("a", { status: "error", errorKind: "stalled" }))).toBe(
      "error (stalled)",
    )
    expect(statusText(worktree("a", { status: "working" }))).toBe("working")
  })
})

describe("worktreeName", () => {
  it("is the branch, else the directory of a detached worktree", () => {
    expect(worktreeName(worktree("plan", {}))).toBe("plan")
    const { branch: _, ...detached } = worktree("x", { path: "/ws/portal-detached" })
    expect(worktreeName(detached)).toBe("portal-detached")
  })
})

describe("noteText", () => {
  it("is the note, unless an error note already is the status message", () => {
    expect(noteText(worktree("a", {}))).toBeUndefined()
    expect(noteText(worktree("a", { note: { message: "merged", error: false } }))).toBe("merged")
    const stalled = { status: "error", errorKind: "stalled" } as const
    expect(
      noteText(worktree("a", { ...stalled, note: { message: "deploy failed", error: true } })),
    ).toBe("deploy failed")
    expect(
      noteText(
        worktree("a", {
          status: "error",
          errorKind: "note",
          message: "deploy failed",
          note: { message: "deploy failed", error: true },
        }),
      ),
    ).toBeUndefined()
  })
})

describe("linkedWorktree", () => {
  it("reads the worktree a notification links to", () => {
    expect(linkedWorktree("?worktree=%2Fws%2Fportal.wt%2Flogin")).toBe("/ws/portal.wt/login")
  })

  it("is undefined on the plain dashboard", () => {
    expect(linkedWorktree("")).toBeUndefined()
  })
})
