import { describe, expect, it } from "vitest"
import {
  applyPoll,
  dropGoneFeeds,
  emptyInbox,
  inboxItems,
  setDispatch,
  type Dispatch,
} from "./inbox.js"

const board = { feed: "board", project: "portal", mode: "queue" } as const

const blockerIn = (dispatch: Dispatch) => {
  const polled = applyPoll(
    emptyInbox(),
    board,
    [
      { key: "7", title: "Fix login", action: "start", priority: 1 },
      {
        key: "8",
        title: "Deploy",
        action: "start",
        priority: 0,
        blockedBy: ["7"],
      },
    ],
    0,
  )
  const inbox = setDispatch(polled, "board/7", dispatch)
  return inboxItems(inbox).find((item) => item.key === "8")?.state
}

describe("blockedBy", () => {
  it.each<Dispatch>([
    { state: "started", worktree: "/w/7" },
    { state: "approved" },
    { state: "starting" },
    { state: "failed", message: "boom" },
  ])("holds an item while the feed lists a blocker that is %j", (dispatch) => {
    expect(blockerIn(dispatch)).toBe("blocked")
  })

  it("holds an item whose blocker is not in the inbox", () => {
    const polled = applyPoll(
      emptyInbox(),
      board,
      [
        {
          key: "8",
          title: "Deploy",
          action: "start",
          priority: 0,
          blockedBy: ["OTHER-1"],
        },
      ],
      0,
    )
    expect(inboxItems(polled)[0]?.state).toBe("blocked")
  })

  it.each<{ blockedBy?: string[] }>([{}, { blockedBy: [] }])("queues an item with %j", (extra) => {
    const polled = applyPoll(
      emptyInbox(),
      board,
      [{ key: "8", title: "Deploy", action: "start", priority: 0, ...extra }],
      0,
    )
    expect(inboxItems(polled)[0]?.state).toBe("queued")
  })

  it("queues the item on the poll that drops the blocker", () => {
    const item = { key: "8", title: "Deploy", action: "start", priority: 0 }
    const held = applyPoll(emptyInbox(), board, [{ ...item, blockedBy: ["7"] }], 0)
    const freed = applyPoll(held, board, [{ ...item, blockedBy: [] }], 1)
    expect(inboxItems(freed)[0]?.state).toBe("queued")
  })
})

describe("dropGoneFeeds", () => {
  it("turns a Retry that has not started back into a failed item that keeps its worktree", () => {
    const polled = applyPoll(
      emptyInbox(),
      board,
      [{ key: "7", title: "Fix login", action: "start", priority: 0 }],
      0,
    )
    const retried = setDispatch(polled, "board/7", {
      state: "approved",
      retry: { worktree: "/w/7" },
    })
    expect(dropGoneFeeds(retried, new Set()).entries.get("board/7")?.dispatch).toEqual({
      state: "failed",
      message: "its feed board is not in the config",
      worktree: "/w/7",
    })
  })
})
