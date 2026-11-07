import { describe, expect, test } from "vitest"

import { pushBranch } from "./git"
import type { GitIo, Ran } from "./git"

// A scripted repository: each argv (joined by spaces) answers from `script`,
// anything unscripted succeeds with no output.
type Scripted = Partial<Ran> & { crash?: boolean }
const repo = (script: Record<string, Scripted>) => {
  const io: GitIo = {
    run: async (argv) => {
      const hit = script[argv.join(" ")]
      // a child killed at the timeout rejects
      if (hit?.crash) throw new Error("timed out after 10 minutes")
      return { code: 0, out: "", err: "", ...hit }
    },
    log: () => {},
  }
  return { io }
}

describe("pushBranch", () => {
  const forced = {
    "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
    "git merge-base --is-ancestor HEAD origin/feat/x": { code: 1 },
  }
  test("a failed first push says so and appends stderr", async () => {
    const { io } = repo({
      "git rev-parse --verify --quiet origin/feat/x": { code: 1 },
      "git push --set-upstream origin feat/x": { code: 1, err: "denied\n" },
    })
    expect(await pushBranch(io, "feat/x")).toBe("git push failed.\ndenied")
  })
  test("a failed force push says moved and appends stderr", async () => {
    const { io } = repo({
      ...forced,
      "git push --force-with-lease origin feat/x": { code: 1, err: "stale info" },
    })
    expect(await pushBranch(io, "feat/x")).toBe(
      "git push failed: origin/feat/x moved. Fetch and reconcile first.\nstale info",
    )
  })
  test("a killed force push is never moved", async () => {
    const { io } = repo({ ...forced, "git push --force-with-lease origin feat/x": { crash: true } })
    const out = await pushBranch(io, "feat/x")
    expect(out).toBe(
      "git push of feat/x did not finish; nothing was lost. Retry without fetching.\ntimed out after 10 minutes",
    )
  })
  test("a killed first push is not failed", async () => {
    const { io } = repo({
      "git rev-parse --verify --quiet origin/feat/x": { code: 1 },
      "git push --set-upstream origin feat/x": { crash: true },
    })
    expect(await pushBranch(io, "feat/x")).toBe(
      "git push of feat/x did not finish; nothing was lost. Retry without fetching.\ntimed out after 10 minutes",
    )
  })
})
