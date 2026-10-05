import {
  answered,
  changes,
  changesSince,
  hasThreadFor,
  head,
  judge,
  numeric,
  read,
  refuse,
  removeScript,
  requireReplies,
  requireThreadsClosed,
  run,
  scope,
  vars,
  type Change,
  type JudgeQuestion,
} from "../flows/index.js"
import { reviewNotes, reviewRisks, stripCodeThreads, type ReviewNote } from "../steering/index.js"
import { escalation, FIX_CAP, healthy, type EscalationCount } from "./health.js"
import {
  answerReviewQuestions,
  awaitReview,
  collecting,
  fix,
  fixNits,
  fixQuality,
  fixRisks,
  QUALITY,
  REQUIREMENTS,
  REVIEW,
  reviewing,
  reviewMissing,
  reviewQuality,
} from "./steps.js"
import * as t from "./text.js"

/** The lenses the quality lap reviews with, one turn each: the `qualityReviews` var, split on `,` and trimmed. Unlike a `skills:` entry, this fans out into one whole turn per entry rather than naming one step's skill list — see `build.quality.reviewing` in `./skills.ts` for the (separate) skills a lens turn itself loads. */
export const qualityLenses = (): readonly string[] =>
  (vars.qualityReviews ?? "")
    .split(",")
    .map((lens) => lens.trim())
    .filter((lens) => lens.length > 0)

/**
 * One review turn per lens over the whole change, each appending every
 * finding to `.gtd/QUALITY.md`. Resolves `"findings"` when that file
 * has any.
 */
export const qualityLap = async (): Promise<"clean" | "findings"> => {
  for (const lens of qualityLenses()) await reviewQuality(lens)
  return (read(QUALITY) ?? "").length > 0 ? "findings" : "clean"
}

/** Resolves `true` once `.gtd/QUALITY.md` is resolved, `false` when the fix cap escalated instead. */
export const fixQualityFindings = async (escalations: EscalationCount): Promise<boolean> => {
  for (let turns = 0; turns < FIX_CAP; turns++) {
    await fixQuality()
    if (changes(QUALITY).some((c) => c.status === "deleted")) return true
  }
  await escalation(escalations)
  return false
}

/** How a review round ended. `feedback` carries what the human edited, for the re-unwind to undo. */
export type ReviewOutcome =
  | { readonly verdict: "signoff" }
  | {
      readonly verdict: "feedback"
      /** The last round's commit, the re-plan base. */
      readonly base: string
      /** The commit `.gtd/REVIEW.md` was written at; edits are restored from it. */
      readonly restoreFrom: string
      /** The code paths the rounds changed, with their content before. */
      readonly edited: readonly Change[]
    }

type Verdict = "edit" | "question" | "nit" | "praise"

const VERDICTS: readonly Verdict[] = ["edit", "question", "nit", "praise"]

/** One four-way choice per note the human added to `.gtd/REVIEW.md`. */
const verdictQuestion = (note: ReviewNote): JudgeQuestion => ({
  id: note.id,
  primitive: "choice",
  instructions: `Classify the human's note on review item "${note.anchor}" (in .gtd/REVIEW.md). Its evidence holds the anchor, the reviewer's text and the human's text.`,
  criteria:
    "edit: a request to change behaviour, design or scope — anything needing a plan, or any note you are unsure about. question: asks something and wants an answer, with no change requested. nit: a small, local, unambiguous fix (naming, typo, formatting, comment wording) needing no re-plan. praise: an approving remark with nothing to do.",
})

/**
 * One judge rest, one verdict per note. Dismissing a note is the risky
 * direction, so only a confident non-`edit` verdict on uncut evidence counts;
 * a cut, unanswered or below-floor note is an `edit`, and a blank floor makes
 * every note one.
 */
const triage = async (notes: readonly ReviewNote[]): Promise<ReadonlyMap<string, Verdict>> => {
  const { answers, truncated } = await judge("review.triage", {
    questions: notes.map(verdictQuestion),
    evidence: Object.fromEntries(
      notes.map((n) => [
        n.id,
        `Anchor: ${n.anchor}\nReviewer's text: ${n.before}\nHuman's text: ${n.text}`,
      ]),
    ),
    message: t.buildReviewTriageMessage(),
    label: "Judging each note",
  })
  const minP = numeric(vars.reviewNoteActionable, Infinity)
  return new Map(
    notes.map((n): [string, Verdict] => {
      const verdict = VERDICTS.find((v) => v !== "edit" && answered(answers[n.id], v, minP))
      return [n.id, truncated.includes(n.id) || verdict === undefined ? "edit" : verdict]
    }),
  )
}

const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

/** A code edit, not a thread-only change: lines that only add, answer or remove code threads don't count. */
const isCodeEdit = (c: Change): boolean =>
  isCode(c.path) &&
  stripCodeThreads(c.path, c.before ?? "") !== stripCodeThreads(c.path, c.after ?? "")

const collect = async (capture: string): Promise<"signoff" | "feedback"> => {
  await collecting(capture)
  if (read(REQUIREMENTS) !== undefined) return "feedback"
  if (changes().length === 0) return "signoff"
  return refuse(
    "gtd land: no declared pattern matches the pending changes — write .gtd/REQUIREMENTS.md from the feedback, or change nothing when it asks for nothing",
  )
}

/** A review with ticks, footnote markers and thread definitions removed: what is left is line notes. */
const notesOf = (text: string): string =>
  text
    .replace(/^\[\^[^\]]+\]:[^\n]*(\n(?: {2,}|\t)[^\n]*|\n(?=\s*\n(?: {2,}|\t)))*/gm, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/\[x\]/gi, "[ ]")
    .replace(/\s+/g, " ")
    .trim()

/** Whether anything but thread edits and ticks landed in `.gtd/REVIEW.md` since `commit`. */
const notedSince = (commit: string): boolean =>
  changesSince(commit).some(
    (c) => c.path === REVIEW && notesOf(c.before ?? "") !== notesOf(read(REVIEW) ?? ""),
  )

/**
 * The human gate and its reply rounds: a question gets an answer inside
 * `.gtd/REVIEW.md` and rests at the gate again, without a lap. Resolves the
 * commit of the last `review.collecting` turn, `"missing"` when the round
 * left no review, or `undefined` when no such turn ran.
 */
const converse = async (base: string, collectedBefore?: string): Promise<string | undefined> => {
  let collectedAt = collectedBefore
  for (;;) {
    await awaitReview(base)
    if (changes(REVIEW).some((c) => c.status === "deleted")) {
      refuse(
        "gtd land: review-doc: .gtd/REVIEW.md was deleted — restore it, or leave a note (or edit code) to request changes.",
      )
    }
    if (read(REVIEW) === undefined) {
      await reviewMissing(head())
      return "missing"
    }
    requireThreadsClosed(REVIEW)
    if (!hasThreadFor("agent", REVIEW)) return collectedAt
    await collecting(t.reviewEditsCapture(head()))
    collectedAt = head()
    requireReplies(REVIEW)
    if (!hasThreadFor("human", REVIEW)) return collectedAt
  }
}

/**
 * What the in-loop `review.collecting` turn left: `folded` when it wrote
 * REQUIREMENTS.md (those folds need their lap whatever is judged later),
 * `settled` when only thread edits and ticks landed after it.
 */
const afterCollect = (collectedAt: string | undefined): { folded: boolean; settled: boolean } =>
  // While the collecting turn is still pending its commit has no hash, so no
  // range can start there; the flow rests at `review.closing` before it matters.
  collectedAt === "" ? { folded: false, settled: false } : settledAfter(collectedAt)

const settledAfter = (collectedAt: string | undefined): { folded: boolean; settled: boolean } => ({
  folded: collectedAt !== undefined && read(REQUIREMENTS) !== undefined,
  settled:
    collectedAt !== undefined &&
    changesSince(collectedAt).every((c) => !isCodeEdit(c)) &&
    !notedSince(collectedAt),
})

/** What `finish` hands back to `review`: an outcome, or another lap at the gate. */
type Finish =
  | ReviewOutcome
  | { readonly next: "await"; readonly reviewed: string }
  | { readonly next: "rereview"; readonly carry: string | undefined }

/** What a round's routing needs from `finish`: its closing step and the ways it ends. */
interface Round {
  readonly round: string
  readonly escalations: EscalationCount
  readonly close: () => Promise<void>
  readonly outcome: (verdict: "signoff" | "feedback") => ReviewOutcome
  readonly unfolded: () => Promise<Finish>
}

/** Judge every note, then run each verdict's route: answers, then nit fixes, then the edits' lap. */
const routeNotes = async (notes: readonly ReviewNote[], r: Round): Promise<Finish> => {
  const verdicts = await triage(notes)
  const of = (v: Verdict): ReviewNote[] => notes.filter((n) => verdicts.get(n.id) === v)
  const [edits, questions, nits] = [of("edit"), of("question"), of("nit")]
  if (edits.length + questions.length + nits.length === 0) return r.unfolded()

  let answeredAt: string | undefined
  if (questions.length > 0) {
    await answerReviewQuestions(questions)
    answeredAt = head()
  }
  if (nits.length > 0) {
    await fixNits(nits)
    await healthy(fix, { escalations: r.escalations })
  }
  if (edits.length > 0) {
    await r.close()
    return r.outcome(await collect(t.reviewEditNotesCapture(r.round, edits, answeredAt)))
  }
  if (nits.length > 0) {
    await r.close()
    return { next: "rereview", carry: answeredAt }
  }
  return { next: "await", reviewed: answeredAt! }
}

const finish = async (
  reviewed: string,
  collectedAt: string | undefined,
  escalations: EscalationCount,
): Promise<Finish> => {
  // Everything the human did is read before any agent turn runs, so a nit fix
  // is never counted as a hand-edit.
  const round = head()
  const since = changesSince(reviewed)
  const edited = since.filter(isCodeEdit)
  const baselineText = since.get(REVIEW)?.before ?? ""
  const record = read(REVIEW) ?? ""
  const { folded, settled } = afterCollect(collectedAt)
  // The review gate clears every tick before its commit, so a changed
  // REVIEW.md is a note, never a tick.
  const noted = since.some((c) => c.path === REVIEW)
  const close = (): Promise<void> =>
    run("review.closing", removeScript([REVIEW]), { label: "Closing the review", base: round })
  const outcome = (verdict: "signoff" | "feedback"): ReviewOutcome =>
    verdict === "signoff" ? { verdict } : { verdict, base: round, restoreFrom: reviewed, edited }
  const unfolded = async (): Promise<Finish> => {
    await close()
    return outcome(folded ? "feedback" : "signoff")
  }

  const collectWith = async (capture: string): Promise<Finish> => {
    await close()
    return outcome(await collect(capture))
  }
  if (settled || (edited.length === 0 && !noted)) return unfolded()
  if (edited.length > 0) return collectWith(t.reviewEditsCapture(round))
  const notes = reviewNotes(baselineText, record)
  if (notes.length === 0) return collectWith(t.reviewNotesCapture(round))
  return routeNotes(notes, { round, escalations, close, outcome, unfolded })
}

/** Write the review; if it marks risks, fix them, keep green, and write it again — once, so the re-review's own risks reach the human unfixed. */
const reviewOnce = async (
  base: string,
  carry: string | undefined,
  escalations: EscalationCount,
): Promise<void> => {
  await reviewing(base, carry)
  const risks = reviewRisks(read(REVIEW) ?? "")
  if (risks.length === 0) return
  await fixRisks(risks)
  await healthy(fix, { escalations })
  await reviewing(base, carry)
}

/**
 * A reviewer writes `.gtd/REVIEW.md` over everything since `base`, a human
 * reviews and signs off or comments, and each note is judged: edits go to
 * another planning lap, questions are answered in place, nits fixed in one
 * batch, praise dropped.
 */
export const review = async (
  base: string,
  escalations: EscalationCount = { rounds: 0 },
): Promise<ReviewOutcome> => {
  let carry: string | undefined
  for (;;) {
    await reviewOnce(base, carry, escalations)
    carry = undefined
    let reviewed = head()
    let collectedAt: string | undefined
    for (;;) {
      collectedAt = await converse(base, collectedAt)
      if (collectedAt === "missing") break
      const result = await finish(reviewed, collectedAt, escalations)
      if (!("next" in result)) return result
      if (result.next === "rereview") {
        carry = result.carry
        break
      }
      reviewed = result.reviewed
    }
  }
}

/** The build tail: fix (when entered red), keep green, the quality lap, then human review since `base`. */
export const buildTail = (fixFirst: boolean, base: string): Promise<ReviewOutcome> =>
  scope("build", async () => {
    const escalations: EscalationCount = { rounds: 0 }
    let redFirst = fixFirst
    // The lap runs once a tail: after its findings are fixed, review follows.
    let lapped = false
    for (;;) {
      if (redFirst) {
        await fix()
        await healthy(fix, { fixesSoFar: 1, escalations })
        redFirst = false
      }
      const lap = lapped ? "clean" : await qualityLap()
      lapped = true
      if (lap === "clean") return review(base, escalations)
      if (await fixQualityFindings(escalations)) await healthy(fix, { escalations })
      else redFirst = true
    }
  })
