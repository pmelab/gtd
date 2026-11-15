import { describe, expect, it } from "vitest"
import { defineWorkspace, durationMs, workspaceProblems } from "./config.js"

const worktrees = { projects: async () => [], list: async () => [] }
const terminal = { run: async () => "h", status: async () => undefined, close: async () => {} }

describe("workspaceProblems", () => {
  it("accepts every documented key", () => {
    expect(
      workspaceProblems({
        driver: ["my-driver"],
        adapters: { worktrees, terminal, services: {}, actions: {}, notifications: {} },
        limits: { maxDrives: 3, wip: 2 },
        pollEvery: "30s",
        projects: {
          portal: { name: "Portal", driver: ["d"], wip: 4, notify: { error: false }, clean: false },
        },
        notify: {
          needsYou: true,
          error: true,
          proposed: false,
          feedFailing: true,
          configError: true,
          mainStale: true,
        },
        clean: { every: "30m" },
        ui: { port: 8443, host: "127.0.0.1", cert: "c", key: "k", users: ["me@example.com"] },
      }),
    ).toEqual([])
  })

  it("rejects an unknown key at every depth", () => {
    expect(
      workspaceProblems({
        drivr: [],
        limits: { maxDrive: 1 },
        projects: { portal: { notify: { needYou: true } } },
        ui: { user: [] },
      }).map((p) => p.path.join(".")),
    ).toEqual(["drivr", "limits.maxDrive", "projects.portal.notify.needYou", "ui.user"])
  })

  it("names the path and the rule of a wrong value", () => {
    expect(
      workspaceProblems({
        driver: [],
        pollEvery: "soon",
        clean: {},
        adapters: { worktrees: { projects: async () => [] }, terminal: { run: async () => "h" } },
        projects: { portal: { clean: true, wip: 0 } },
      }),
    ).toEqual([
      { path: ["driver"], message: "must be a non-empty array of strings (an argv)" },
      { path: ["adapters", "worktrees", "list"], message: "must be a function" },
      { path: ["adapters", "terminal", "status"], message: "must be a function" },
      { path: ["adapters", "terminal", "close"], message: "must be a function" },
      { path: ["pollEvery"], message: 'must be a duration like "30s", "5m" or "1h"' },
      { path: ["projects", "portal", "wip"], message: "must be a positive integer" },
      {
        path: ["projects", "portal", "clean"],
        message: "must be false (auto-clean is on for every project)",
      },
      { path: ["clean", "every"], message: "is required" },
    ])
  })

  it("leaves an adapter object's own extra members alone", () => {
    expect(workspaceProblems({ adapters: { worktrees: { ...worktrees, cache: 1 } } })).toEqual([])
  })
})

describe("defineWorkspace", () => {
  it("returns a valid workspace as given", () => {
    const workspace = { driver: ["d"] }
    expect(defineWorkspace(workspace)).toBe(workspace)
  })

  it("throws every problem in the config format", () => {
    expect(() => defineWorkspace({ limits: { maxDrives: -1 }, x: 1 } as never)).toThrow(
      "workspace.x: is not a known key; workspace.limits.maxDrives: must be a positive integer",
    )
  })
})

describe("durationMs", () => {
  it("reads each unit", () => {
    expect([durationMs("250ms"), durationMs("30s"), durationMs("5m"), durationMs("1h")]).toEqual([
      250, 30_000, 300_000, 3_600_000,
    ])
  })
})
