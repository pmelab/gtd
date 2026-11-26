import { describe, expect, it } from "vitest"
import type { StatusRecord } from "../workspace/index.js"
import { isOrphan, worktreeStatus, type DriverState } from "./Status.js"

const agentRest = {
  status: 0,
  stdout: JSON.stringify({
    kind: "prompt",
    actor: "agent",
    idle: false,
    label: "Build",
  }),
  stderr: "",
}

const quitWith = (code: number, record: StatusRecord): DriverState => ({
  kind: "pane",
  pane: { record, alive: false, busy: false, exit: { code } },
})

describe("worktreeStatus", () => {
  it.each([0, 130, 143])(
    "does not keep a quit driver (exit %i) working on its last record",
    (code) => {
      expect(worktreeStatus(agentRest, quitWith(code, { state: "working" }))).toEqual({
        status: "needsYou",
        label: "Build",
        message: "no driver runs",
      })
    },
  )

  it("does not keep a quit driver blocked on its last record", () => {
    expect(worktreeStatus(agentRest, quitWith(0, { state: "blocked", kind: "question" }))).toEqual({
      status: "needsYou",
      label: "Build",
      message: "no driver runs",
    })
  })

  it("flags a human rest only", () => {
    const humanRest = {
      status: 0,
      stdout: JSON.stringify({
        kind: "prompt",
        actor: "human",
        idle: false,
        label: "Plan",
      }),
      stderr: "",
    }
    const none: DriverState = { kind: "none" }
    expect(worktreeStatus(humanRest, none)).toMatchObject({
      status: "needsYou",
      humanRest: true,
    })
    expect(worktreeStatus(agentRest, none).humanRest).toBeUndefined()
    expect(
      worktreeStatus(humanRest, {
        kind: "pane",
        pane: {
          record: { state: "blocked", kind: "question" },
          alive: true,
          busy: true,
          exit: null,
        },
      }).humanRest,
    ).toBe(true)
    expect(
      worktreeStatus(agentRest, {
        kind: "pane",
        pane: {
          record: { state: "blocked", kind: "permission" },
          alive: true,
          busy: true,
          exit: null,
        },
      }).humanRest,
    ).toBeUndefined()
  })

  describe("a wait step", () => {
    const none: DriverState = { kind: "none" }
    const wait = (kind: string, path?: string) => ({
      status: 0,
      stdout: JSON.stringify({
        kind,
        actor: "signal",
        idle: false,
        label: "pr",
        changes: path === undefined ? [] : [{ status: "A", path }],
        signal: { kinds: ["review", "person"], timeout: "2d" },
      }),
      stderr: "",
    })

    it("shows waiting with the kinds it accepts, and needs no driver", () => {
      expect(worktreeStatus(wait("message"), none)).toEqual({
        status: "waiting",
        label: "pr",
        signal: { kinds: ["review", "person"], timeout: "2d" },
      })
      expect(isOrphan(wait("message"), none)).toBe(false)
    })

    it("keeps waiting when a stray edit, not a signal, is pending", () => {
      expect(worktreeStatus(wait("capture", "notes.md"), none).status).toBe("waiting")
      expect(isOrphan(wait("capture", "notes.md"), none)).toBe(false)
    })

    it("needs a driver once a signal is written, to land it", () => {
      expect(isOrphan(wait("capture", ".gtd/SIGNAL.json"), none)).toBe(true)
      expect(worktreeStatus(wait("capture", ".gtd/SIGNAL.json"), none)).toMatchObject({
        status: "needsYou",
        message: "no driver runs",
      })
    })
  })
})
