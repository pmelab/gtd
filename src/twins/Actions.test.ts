import { describe, it } from "vitest"
import { actionsContract } from "../workspace-testkit/index.js"
import { inMemoryActionsHarness } from "./Actions.js"

describe("the in-memory actions twin passes the actions contract", () => {
  for (const contractCase of actionsContract(inMemoryActionsHarness)) {
    it(contractCase.name, contractCase.run)
  }
})
