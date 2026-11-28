import { describe, expect, it } from "vitest"
import {
  decisionCount,
  noteText,
  parseScreen,
  nowView,
  pressFor,
  projectCounts,
  reasonText,
  screenUrl,
  waitingText,
  waitText,
  statusText,
  worktreeName,
  type InboxItem,
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
      waiting: [],
    })
  })

  it("lists a worktree at a wait step as waiting, and not as working or needing anyone", () => {
    const waiting = worktree("ci", { status: "waiting", signal: { kinds: ["checks"] } })
    const view = nowView([{ id: "api", name: "api", worktrees: [waiting] }])
    expect(names(view.waiting)).toEqual(["api/ci"])
    expect(view.working).toEqual([])
    expect(view.attention).toEqual([])
  })
})

describe("waitingText", () => {
  const now = 10_000_000
  it("shows the label, the kinds and how long it has waited", () => {
    const w = worktree("ci", {
      status: "waiting",
      label: "Waiting for CI",
      signal: { kinds: ["checks", "timeout"] },
      waitingSince: now - 90 * 60_000,
    })
    expect(waitingText(w, now)).toBe("Waiting for CI — checks, timeout — waiting 1h 30m")
  })

  it("adds when the timeout fires", () => {
    const w = worktree("ci", {
      status: "waiting",
      label: "Waiting for a review",
      signal: { kinds: ["review"], timeout: "2h" },
      waitingSince: now - 30 * 60_000,
    })
    expect(waitingText(w, now)).toBe(
      "Waiting for a review — review — waiting 30m — times out in 1h 30m",
    )
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

describe("decisionCount", () => {
  it("counts the proposed and failed items, which wait for Start or Retry", () => {
    const item = (state: InboxItem["state"]): InboxItem => ({
      feed: "f",
      project: "p",
      key: state,
      title: state,
      action: "start:work",
      priority: 0,
      blockedBy: [],
      data: null,
      state,
      firstSeen: "2026-01-01T00:00:00.000Z",
    })
    const states = ["proposed", "queued", "blocked", "starting", "started", "failed"] as const
    expect(decisionCount(states.map(item))).toBe(2)
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

describe("reasonText", () => {
  it("drops a detail that only repeats the status", () => {
    expect(reasonText(worktree("a", {}))).toBe("")
    expect(reasonText(worktree("a", { status: "working", label: "Working" }))).toBe("")
    expect(reasonText(worktree("a", { status: "working", label: "Building" }))).toBe("Building")
    expect(reasonText(worktree("a", { label: "Idle", message: "merged" }))).toBe("Idle — merged")
  })
})

describe("projectCounts", () => {
  it("counts the worktrees that need you and those in error", () => {
    expect(projectCounts(projects[0]!)).toEqual({ needsYou: 0, error: 1 })
    expect(projectCounts(projects[1]!)).toEqual({ needsYou: 1, error: 0 })
  })
})

describe("waitText", () => {
  it("says a drive limit in words, and nothing for any other reason", () => {
    expect(waitText("2 of 2 drives in use (limits.maxDrives)")).toBe(
      "2 of 2 drives in use — the workspace limit",
    )
    expect(waitText("shop: 1 of 1 drives in use (projects.shop.wip)")).toBe(
      "1 of 1 drives in use — the project limit",
    )
    expect(waitText("shop: 1 of 1 drives in use (limits.wip)")).toBe(
      "1 of 1 drives in use — the project limit",
    )
    expect(waitText("paused")).toBeUndefined()
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

describe("screens", () => {
  it("reads the worktree a notification links to", () => {
    expect(parseScreen("?worktree=%2Fws%2Fportal.wt%2Flogin").worktree).toBe("/ws/portal.wt/login")
  })

  it("opens Now on the plain dashboard, Projects and Inbox by view", () => {
    expect(parseScreen("")).toEqual({ view: "now" })
    expect(parseScreen("?view=projects").view).toBe("projects")
    expect(parseScreen("?view=inbox").view).toBe("inbox")
  })

  it("builds the address a screen is read back from", () => {
    for (const screen of [
      { view: "now" },
      { view: "projects" },
      { view: "inbox" },
      { view: "now", worktree: "/ws/a b" },
      { view: "projects", worktree: "/ws/a" },
    ] as const) {
      const url = screenUrl(screen)
      expect(parseScreen(url.slice(url.indexOf("?") + 1 || url.length))).toEqual(screen)
    }
  })
})
