import { describe, it } from "vitest"
import { worktreesContract } from "../workspace-testkit/index.js"
import { inMemoryWorktreesHarness } from "./Worktrees.js"

describe("the in-memory worktrees twin passes the worktrees contract", () => {
  for (const contractCase of worktreesContract(inMemoryWorktreesHarness)) {
    it(contractCase.name, contractCase.run)
  }
})
