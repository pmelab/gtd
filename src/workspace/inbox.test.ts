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
      { key: "8", title: "Deploy", action: "start", priority: 0, blockedBy: ["7"] },
    ],
    0,
  )
  const inbox = setDispatch(polled, "board/7", dispatch)
  return inboxItems(inbox).find((item) => item.key === "8")?.state
}

describe("blockedBy", () => {
  it("lets an item go once the item it names has started", () => {
    expect(blockerIn({ state: "started", worktree: "/w/7" })).toBe("queued")
  })

  it.each<Dispatch>([
    { state: "approved" },
    { state: "starting" },
    { state: "failed", message: "boom" },
  ])("holds an item while the item it names is %j", (dispatch) => {
    expect(blockerIn(dispatch)).toBe("blocked")
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
