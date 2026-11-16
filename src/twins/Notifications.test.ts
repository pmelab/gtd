import { describe, it } from "vitest"
import { notificationsContract } from "../workspace-testkit/index.js"
import { inMemoryNotificationsHarness } from "./Notifications.js"

describe("the in-memory notifications twin passes the notifications contract", () => {
  for (const contractCase of notificationsContract(inMemoryNotificationsHarness)) {
    it(contractCase.name, contractCase.run)
  }
})
