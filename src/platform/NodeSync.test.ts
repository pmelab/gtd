import { describe, it } from "vitest"
import { nodeSyncIo } from "./NodeSync.js"
import { withStaleIndex } from "./ReadLocks.fixture.js"

describe("read-only git calls", () => {
  it("nodeSyncIo.git leaves a stale index alone", () =>
    withStaleIndex((root) => {
      nodeSyncIo.git(root, ["status", "--porcelain"])
    }))
})
