import {
  changes,
  head,
  human,
  judgeDiffShape,
  kept,
  removeScript,
  run,
  scope,
  slice,
  vars,
  type DiffShapeResult,
  type KeptTip,
} from "../../flows/index.js"
import { healthy } from "../shared/health.js"
import { coder, FEEDBACK, REQUIREMENTS } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults } from "../shared/vars.js"
import { requireCriteria, requireCriteriaFrozen } from "./criteria.js"
import { refactorStrays, reviewedRefactor } from "./refactor.js"
import { flagModeOn } from "../shared/options.js"
import type { RiskTier } from "./tier.js"

/** Naive-pass retries after a `reject`; the next `reject` rests at `seam.steer`. */
const NAIVE_RETRIES = 2

/** A change to an existing file outside the allowlist is a stray even when the task needs it: the judge decides. */
export const judgeSeam = (tip: KeptTip): Promise<DiffShapeResult> =>
  judgeDiffShape("judge", {
    changes: tip.changes,
    allow: (vars.seamAllow ?? defaults.seamAllow!)
      .split(",")
      .map((glob) => glob.trim())
      .filter((glob) => glob !== ""),
    exempt: tip.changes.filter((c) => c.status === "added").map((c) => c.path),
  })

export const naivePass = (rejection?: t.SeamRejection): Promise<void> =>
  t.agentWithSkills("naive", t.naivePassPrompt(rejection), {
    label: rejection === undefined ? "Writing the naive pass" : "Rewriting the naive pass",
    keep: true,
    model: coder(),
    system: t.builderSystem(),
  })

export interface ImplementOptions {
  readonly reference?: string | undefined
  readonly tier?: RiskTier | undefined
  readonly amend?: boolean | undefined
  /** After a refactor slice, which may already carry the feature: an empty turn completes the step. */
  readonly afterRefactor?: boolean | undefined
}

export function implement(options?: ImplementOptions): Promise<void>
/** @deprecated Pass `implement({ reference, tier, amend })`. */
export function implement(
  reference: string | undefined,
  tier?: RiskTier,
  amend?: boolean,
): Promise<void>
export function implement(
  first?: string | ImplementOptions,
  tier?: RiskTier,
  amend?: boolean,
): Promise<void> {
  const options: ImplementOptions =
    typeof first === "object" && first !== null ? first : { reference: first, tier, amend }
  return scope("implement", async () => {
    await t.agentWithSkills(
      "building",
      t.implementBuildingPrompt(
        options.reference,
        options.tier,
        options.amend,
        options.afterRefactor,
        flagModeOn(),
      ),
      {
        label: "Implementing",
        model: coder(),
        system: t.builderSystem(),
        ...(options.afterRefactor === true ? { allowEmpty: true } : {}),
      },
    )
    requireCriteriaFrozen(REQUIREMENTS)
    await healthy(
      () =>
        t.agentWithSkills("fix.suite.fixing", t.implementFixPrompt(), {
          label: "Fixing the check",
          file: FEEDBACK,
          model: coder(),
          system: t.builderSystem(),
        }),
      { guard: () => requireCriteriaFrozen(REQUIREMENTS), guardRests: false },
    )
    await run("closing", removeScript([REQUIREMENTS]), { label: "Closing out the implementation" })
  })
}

interface Decision {
  readonly reference: string
  /** Present only on `refactor-first`: the refactor runs before the implementation. */
  readonly shape?: DiffShapeResult
}

const decide = (): Promise<Decision> =>
  scope("seam", async () => {
    let rejection: t.SeamRejection | undefined
    let retries = 0
    for (;;) {
      await naivePass(rejection)
      const tip = kept("naive")!
      const shape = await judgeSeam(tip)
      if (shape.choice === "land") return { reference: tip.hash }
      if (shape.choice === "refactor-first") {
        return { reference: tip.hash, shape }
      }
      rejection = { strays: shape.strays, p: shape.judgment?.answers.shape?.p ?? 0 }
      if (retries < NAIVE_RETRIES) {
        retries++
        continue
      }
      await human("steer", {
        message: t.seamSteerMessage(rejection),
        label: "Steer or overrule the rejected naive pass",
        file: REQUIREMENTS,
        acceptClean: true,
      })
      // Any edit steers, with a fresh budget and no stale rejection; clean overrules.
      if (changes().length === 0) return { reference: tip.hash }
      requireCriteria(REQUIREMENTS)
      rejection = undefined
      retries = 0
    }
  })

export interface SeamOutcome {
  /** The naive pass's kept tip: the first implement turn's reading material. */
  readonly reference: string
  /** The feature review's base: HEAD after the refactor on refactor-first, else the caller's base. */
  readonly base: string
  readonly refactored?: boolean
}

export const seamBuild = async (base: string): Promise<SeamOutcome> => {
  const { reference, shape } = await decide()
  if (shape === undefined) return { reference, base }
  if (shape.unreadable.length > 0) {
    await scope("seam", () =>
      human("by-hand", {
        message: t.seamByHandMessage(shape.strays, shape.unreadable, reference),
        label: "Reviewing unreadable files by hand",
        acceptClean: true,
      }),
    )
    return { reference, base }
  }
  if (refactorStrays(shape).length === 0) return { reference, base }
  const refactored = await slice("refactor", () => reviewedRefactor(shape, { reference }))
  return { reference, base: head(), refactored }
}
