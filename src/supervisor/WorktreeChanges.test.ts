import { describe, expect, it } from "vitest"
import { confirmations, protections, type RemovalFacts } from "./WorktreeChanges.js"

const free: RemovalFacts = {
  main: false,
  processEnded: true,
  driverRuns: false,
  paneBusy: false,
  starting: false,
  errorNote: false,
}

describe("protections", () => {
  it("lets a free worktree go", () => {
    expect(protections(free)).toEqual([])
  })

  it.each([
    [{ main: true }, "it is the main checkout"],
    [{ processEnded: false }, "its process has not ended"],
    [{ driverRuns: true }, "its driver runs"],
    [{ paneBusy: true }, "a pane runs a command"],
    [{ starting: true }, "an item is starting in it"],
    [{ errorNote: true }, "it has an error note"],
  ])("keeps a worktree when %j", (fact, reason) => {
    expect(protections({ ...free, ...fact })).toEqual([reason])
  })
})

describe("confirmations", () => {
  const worktree = { path: "/w", branch: "b", head: "h", main: false }

  it("asks nothing for a clean, integrated worktree", () => {
    expect(confirmations({ ...worktree, integrated: true, dirty: false })).toEqual([])
  })

  it("asks when the adapter cannot tell", () => {
    expect(confirmations({ ...worktree, integrated: undefined })).toEqual([
      "the tree has uncommitted changes",
      "the branch is not integrated",
    ])
  })
})
