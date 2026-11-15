import { describe, it } from "vitest"
import { servicesContract } from "../workspace-testkit/index.js"
import { inMemoryServicesHarness } from "./Services.js"

describe("the in-memory services twin passes the services contract", () => {
  for (const contractCase of servicesContract(inMemoryServicesHarness)) {
    it(contractCase.name, contractCase.run)
  }
})
