import { human, scope } from "../../flows/index.js"
import * as kit from "../../workflow-kit/index.js"
import * as t from "./text.js"

export {
  driftedScenarios,
  freezeScenarios,
  scenarioText,
  wordingDrift,
  type FrozenScenarios,
} from "../../workflow-kit/index.js"

/** After a turn: stop at `scenario-wording` while wording drifted; accept moves the snapshot. */
export const holdWording = (frozen: kit.FrozenScenarios | undefined): Promise<void> =>
  kit.holdWording(frozen, (at, drifted) =>
    human("scenario-wording", {
      message: t.scenarioWordingMessage(at, drifted),
      label: "Scenario wording changed",
      acceptClean: true,
      base: at,
    }),
  )

/** `turn`, then `holdWording`; `within` names the scope the gate rests in. */
export const guarded =
  (
    frozen: kit.FrozenScenarios | undefined,
    turn: () => Promise<void>,
    within?: string,
  ): (() => Promise<void>) =>
  async () => {
    await turn()
    if (within === undefined) await holdWording(frozen)
    else await scope(within, () => holdWording(frozen))
  }
