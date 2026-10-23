import { healthy } from "../shared/health.js"
import { coder, FEEDBACK, REQUIREMENTS } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { requireCriteriaFrozen } from "./criteria.js"

export const green = (): Promise<void> =>
  healthy(
    () =>
      t.agentWithSkills("fix.suite.fixing", t.implementFixPrompt(), {
        label: "Fixing the check",
        file: FEEDBACK,
        model: coder(),
        system: t.builderSystem(),
      }),
    {
      guard: () => requireCriteriaFrozen(REQUIREMENTS),
      guardRests: false,
    },
  )
