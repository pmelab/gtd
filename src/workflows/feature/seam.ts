import {
  changes,
  human,
  judgeDiffShape,
  kept,
  removeScript,
  run,
  scope,
  seamGate,
  vars,
  type DiffShapeResult,
  type KeptTip,
} from "../../flows/index.js"
import { healthy } from "../shared/health.js"
import { coder, FEEDBACK, REQUIREMENTS } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults } from "../shared/vars.js"
import { refactorFirst } from "./refactor.js"

/** Naive-pass retries after a `reject`; the next `reject` rests at `seam.steer`. */
const NAIVE_RETRIES = 2

/**
 * `seamAllow` plus every file the tip adds. A change to an existing file
 * outside it is a stray even when the task needs it: the judge decides.
 */
export const seamAllowlist = (tip: KeptTip): string[] => [
  ...(vars.seamAllow ?? defaults.seamAllow!)
    .split(",")
    .map((glob) => glob.trim())
    .filter((glob) => glob !== ""),
  ...tip.changes.filter((c) => c.status === "added").map((c) => c.path),
]

export const naivePass = (rejection?: t.SeamRejection): Promise<void> =>
  t.agentWithSkills("naive", t.naivePassPrompt(rejection), {
    label: rejection === undefined ? "Writing the naive pass" : "Rewriting the naive pass",
    keep: true,
    model: coder(),
    system: t.builderSystem(),
  })

export const implement = (reference: string): Promise<void> =>
  scope("implement", async () => {
    await t.agentWithSkills("building", t.implementBuildingPrompt(reference), {
      label: "Implementing",
      model: coder(),
      system: t.builderSystem(),
    })
    await healthy(() =>
      t.agentWithSkills("fix.suite.fixing", t.implementFixPrompt(), {
        label: "Fixing the check",
        file: FEEDBACK,
        model: coder(),
        system: t.builderSystem(),
      }),
    )
    await run("closing", removeScript([REQUIREMENTS]), { label: "Closing out the implementation" })
  })

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
      const shape = await judgeDiffShape("judge", {
        changes: tip.changes,
        allow: seamAllowlist(tip),
      })
      if (shape.choice === "land") return { reference: tip.hash }
      if (shape.choice === "refactor-first") {
        await seamGate("approve", shape)
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
      rejection = undefined
      retries = 0
    }
  })

export const seamBuild = async (): Promise<void> => {
  const { reference, shape } = await decide()
  if (shape !== undefined && !(await refactorFirst(shape, { reference }))) {
    // Unreadable strays were never judged, and no refactor runs: a person reads the diff.
    await scope("seam", () =>
      human("by-hand", {
        message: t.seamByHandMessage(shape.strays, shape.unreadable, reference),
        label: "Reviewing unreadable files by hand",
        acceptClean: true,
      }),
    )
  }
  await implement(reference)
}
