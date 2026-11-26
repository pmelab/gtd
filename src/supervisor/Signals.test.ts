import { describe, expect, it } from "vitest"
import type { ExecResult } from "../workspace/index.js"
import type { Drivers } from "./Drivers.js"
import type { ProjectView, WorktreeView } from "./Scan.js"
import { signals, timeoutMs } from "./Signals.js"

const waiting = (over: Partial<WorktreeView> = {}): WorktreeView =>
  ({
    path: "/w/feat",
    branch: "feat",
    head: "abc",
    main: false,
    gate: "/g",
    status: "waiting",
    label: "pr",
    signal: { kinds: ["review", "person"], timeout: "1h" },
    ...over,
  }) as WorktreeView

const setup = (view: WorktreeView, held?: string, committedAt = 0, now = 0) => {
  const runs: string[][] = []
  const started: string[] = []
  const project: ProjectView = { id: "p", name: "p", worktrees: [view] }
  const deliver = signals({
    exec: async (argv): Promise<ExecResult> => {
      runs.push([...argv])
      if (argv[0] === "git") return { status: 0, stdout: `${committedAt / 1000}\n`, stderr: "" }
      return { status: 0, stdout: "gtd signal: written to .gtd/SIGNAL.json\n", stderr: "" }
    },
    drivers: { start: async (_p: string, w: string) => !!started.push(w) } as unknown as Drivers,
    projects: () => [project],
    refreshDriver: async () => {},
    holds: () => held,
    now: () => now,
    log: () => {},
  })
  return { deliver, runs, started }
}

describe("signals", () => {
  it("delivers a feed's signal to the waiting branch and starts its driver", async () => {
    const { deliver, runs, started } = setup(waiting())
    await deliver.fromFeed("reviews", "p", [{ kind: "review", branch: "feat", fingerprint: "r1" }])
    expect(runs[0]!.slice(0, 4)).toEqual(["gtd", "signal", "/w/feat", "review"])
    expect(runs[0]).toContain("--fingerprint")
    expect(started).toEqual(["/w/feat"])
  })

  it("drops a signal for another branch, or a kind the wait does not accept", async () => {
    const { deliver, runs } = setup(waiting())
    await deliver.fromFeed("f", "p", [
      { kind: "review", branch: "other", fingerprint: "1" },
      { kind: "merged", branch: "feat", fingerprint: "2" },
    ])
    expect(runs).toEqual([])
  })

  it("delivers nothing while a pause holds", async () => {
    const { deliver, runs } = setup(waiting(), "dispatch is paused in p")
    await deliver.fromFeed("f", "p", [{ kind: "review", branch: "feat", fingerprint: "1" }])
    await deliver.timeouts()
    expect(runs).toEqual([])
  })

  it("delivers timeout once the wait has rested as long as its timeout", async () => {
    const early = setup(waiting(), undefined, 0, 59 * 60_000)
    await early.deliver.timeouts()
    expect(early.runs.filter((r) => r[0] === "gtd")).toEqual([])
    const late = setup(
      waiting({ signal: { kinds: ["review", "timeout"], timeout: "1h" } }),
      undefined,
      0,
      60 * 60_000,
    )
    await late.deliver.timeouts()
    expect(late.runs.find((r) => r[0] === "gtd")?.slice(3, 4)).toEqual(["timeout"])
  })

  it("reads durations", () => {
    expect(timeoutMs("2d")).toBe(172_800_000)
    expect(timeoutMs("soon")).toBeUndefined()
  })
})
