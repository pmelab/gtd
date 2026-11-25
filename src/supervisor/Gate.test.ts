import { describe, expect, it } from "vitest"
import type { Worktree, WorktreesAdapter } from "../workspace/index.js"
import { gateOf, gatePath } from "./Gate.js"

const worktree = (path: string, branch: string | undefined): Worktree => ({
  path,
  branch,
  head: "a".repeat(40),
  main: false,
  integrated: undefined,
})

const FEATURE = worktree("/code/acme/portal.feat-x", "feat/x")
const DETACHED = worktree("/code/acme/portal.bisect", undefined)

const adapter: WorktreesAdapter = {
  projects: async () => [{ id: "acme/portal", path: "/code/acme/portal" }],
  list: async () => [FEATURE, DETACHED],
}

describe("gate pages", () => {
  it("keep a project id with slashes in one path segment and name the worktree by its directory", async () => {
    const path = gatePath("acme/portal", FEATURE)
    expect(path).toBe("/acme%2Fportal/portal.feat-x/gate")
    expect(await gateOf(`${path}/trpc/step`, adapter)).toEqual({
      base: path,
      worktree: FEATURE,
    })
  })

  it("keep the path when the branch changes or the HEAD is detached", async () => {
    const path = gatePath("acme/portal", FEATURE)
    expect(gatePath("acme/portal", worktree(FEATURE.path, "gtd/plan/x"))).toBe(path)
    expect(gatePath("acme/portal", worktree(FEATURE.path, undefined))).toBe(path)
  })

  it("name a detached worktree by its directory", async () => {
    const path = gatePath("acme/portal", DETACHED)
    expect(path).toBe("/acme%2Fportal/portal.bisect/gate")
    expect((await gateOf(path, adapter))?.worktree).toBe(DETACHED)
  })

  it("belong to no worktree for an unknown project, a malformed segment or another path", async () => {
    expect(await gateOf("/acme%2Fother/portal.feat-x/gate", adapter)).toBeUndefined()
    expect(await gateOf("/acme%2Fportal/feat%2Fx/gate", adapter)).toBeUndefined()
    expect(await gateOf("/acme%2Fportal/%E0%A4%A/gate", adapter)).toBeUndefined()
    expect(await gateOf("/acme%2Fportal/portal.feat-x/gatehouse", adapter)).toBeUndefined()
  })
})
