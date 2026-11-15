import { describe, it } from "vitest"
import { terminalContract } from "../workspace-testkit/index.js"
import { inMemoryTerminalHarness } from "./Terminal.js"

describe("the in-memory terminal twin passes the terminal contract", () => {
  for (const contractCase of terminalContract(inMemoryTerminalHarness)) {
    it(contractCase.name, contractCase.run)
  }
})
