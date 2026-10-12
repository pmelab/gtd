import { read, refuse, removeScript, run, scope, start } from "../../flows/index.js"
import { reviewNotes, reviewRisks } from "../../steering/index.js"
import { baseline } from "../shared/health.js"
import { shipped } from "../shared/options.js"
import { coder, REVIEW } from "../shared/steps.js"
import { handOffTail, REVIEW_ORIG } from "../shared/tail.js"
import * as t from "../shared/text.js"

/**
 * Fix every note a human left in a handed-off `.gtd/REVIEW.md` and every
 * risk its reviewer marked, in one turn; the review files go once it is done.
 */
export const fixReviewNotes = (): Promise<void> =>
  scope("notes", async () => {
    const record = read(REVIEW) ?? ""
    const orig = read(REVIEW_ORIG)
    // Without the reviewer's copy no note can be told from the review's own text,
    // and closing would delete notes never read — also keeps a stray review out.
    if (orig === undefined) {
      return refuse(
        `gtd: ${REVIEW} has no ${REVIEW_ORIG}, so it was not handed off by a review — remove it, or restore ${REVIEW_ORIG}.`,
      )
    }
    const notes = reviewNotes(orig, record)
    await t.agentWithSkills("fixing", t.fixReviewNotesPrompt(notes, reviewRisks(record)), {
      label: "Fixing your review notes",
      file: REVIEW,
      model: coder(),
      system: t.finisherSystem(),
      // Praise and questions are answered without an edit; the hand-off review that follows catches an unaddressed note.
      allowEmpty: true,
    })
    await run("closing", removeScript([REVIEW, REVIEW_ORIG]), { label: "Closing the review" })
  })

/**
 * Fix what a review handed on, else repair a red baseline — then the
 * hand-off review of the result. A note there is handed to the next `fix`.
 */
export const fixFlow = async (): Promise<void> => {
  if (read(REVIEW) !== undefined) {
    await fixReviewNotes()
    return handOffTail(false, start())
  }
  if (read(REVIEW_ORIG) !== undefined) {
    return refuse(`gtd: ${REVIEW_ORIG} has no ${REVIEW} — remove it, or restore ${REVIEW}.`)
  }
  if (await baseline("fix-precheck")) return
  await handOffTail(true, start())
}

export const fix = shipped(fixFlow, { fix: {} })
