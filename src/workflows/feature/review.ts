import {
  answered,
  head,
  judge,
  numeric,
  requireRevert,
  restoreScript,
  run,
  vars,
  type JudgeQuestion,
  type Judgment,
  type ScopeAccess,
} from "../../flows/index.js"
import type { ReviewNote } from "../../steering/index.js"
import * as kit from "../../workflow-kit/index.js"
import { guarded, healthy, type EscalationCount, type Guard } from "../shared/health.js"
import {
  awaitReview,
  fixCheck,
  fixRisks,
  REQUIREMENTS,
  REVIEW,
  reviewing,
  reviewMissing,
} from "../shared/steps.js"
import { closeReview, tail } from "../shared/tail.js"
import * as t from "../shared/text.js"
import { answerReviewQuestions, collecting, deferNotes, fixNits } from "./steps.js"

export type { ReviewOutcome } from "../../workflow-kit/index.js"

const VERDICTS: readonly kit.Verdict[] = ["edit", "question", "nit", "praise"]

/** One four-way choice per note the human added to `.gtd/REVIEW.md`. */
const verdictQuestion = (note: ReviewNote): JudgeQuestion => ({
  id: note.id,
  primitive: "choice",
  instructions: `Classify the human's note on review item "${note.anchor}" (in .gtd/REVIEW.md). Its evidence holds the anchor, the reviewer's text and the human's text.`,
  criteria:
    "edit: a request to change behaviour, design or scope — anything needing a plan, or any note you are unsure about. question: asks something and wants an answer, with no change requested. nit: a small, local, unambiguous fix (naming, typo, formatting, comment wording) needing no re-plan. praise: an approving remark with nothing to do.",
})

type Tier = "critical" | "should" | "could"

const SEVERITY_ANSWERS: Readonly<Record<string, readonly string[]>> = {
  security: ["yes", "no"],
  reversibility: ["one-way", "two-way"],
  blastRadius: ["local", "module", "contract"],
  newConcept: ["yes", "no"],
}

interface Severity {
  readonly tier: Tier
  readonly reason: string
  /** Capture order: 0 one-way door, 1 new concept, 2 everything else. */
  readonly rank: 0 | 1 | 2
}

/**
 * Deferring is the risky direction: anything unanswered, unrecognised, cut or
 * below `minP` is `critical`, never `could`.
 */
export const severityOf = (note: ReviewNote, judgment: Judgment, minP: number): Severity => {
  const ans = (q: string) => judgment.answers[`${note.id}.${q}`]
  const a = (q: string): string | undefined => ans(q)?.answer
  const rank = (): 0 | 1 | 2 =>
    a("reversibility") === "one-way" ? 0 : a("newConcept") === "yes" ? 1 : 2
  if (note.forced) return { tier: "critical", reason: "critical: forced by `!`", rank: 2 }
  const unsure =
    judgment.truncated.includes(note.id) ||
    Object.entries(SEVERITY_ANSWERS).some(
      ([q, allowed]) => !allowed.includes(a(q) ?? "") || !((ans(q)?.p ?? NaN) >= minP),
    )
  if (unsure) return { tier: "critical", reason: "critical: judge unsure", rank: 2 }
  const critical = [
    ...(a("security") === "yes" ? ["security"] : []),
    ...(a("reversibility") === "one-way" ? ["one-way door"] : []),
  ]
  if (critical.length > 0)
    return { tier: "critical", reason: `critical: ${critical.join(", ")}`, rank: rank() }
  const should = [
    ...(a("blastRadius") === "contract" ? ["contract"] : []),
    ...(a("newConcept") === "yes" ? ["new concept"] : []),
  ]
  if (should.length > 0)
    return { tier: "should", reason: `should: ${should.join(", ")}`, rank: rank() }
  return { tier: "could", reason: "could", rank: 2 }
}

const severityQuestions = (note: ReviewNote): JudgeQuestion[] => [
  {
    id: `${note.id}.security`,
    primitive: "noul",
    instructions: `Does the change the human asks for in note "${note.id}" (on "${note.anchor}") touch security — authentication, authorisation, secrets, untrusted input or data exposure?`,
    criteria: "yes: it changes or could weaken a security property. no: it does not.",
  },
  {
    id: `${note.id}.reversibility`,
    primitive: "choice",
    instructions: `Once the change in note "${note.id}" ships, can it be undone without breaking anyone who already depends on it?`,
    criteria:
      "one-way: a published API, file format, persisted data, protocol or other contract that cannot be taken back. two-way: can be reverted freely.",
  },
  {
    id: `${note.id}.blastRadius`,
    primitive: "choice",
    instructions: `How far does the change in note "${note.id}" reach?`,
    criteria:
      "local: one function or file. module: a whole module or several files. contract: a public interface other code or users depend on.",
  },
  {
    id: `${note.id}.newConcept`,
    primitive: "noul",
    instructions: `Does the change in note "${note.id}" introduce a concept new to this codebase — a new abstraction, entity or term? Judge from the evidence, never a glossary; reusing or extending an existing concept is not new.`,
    criteria: "yes: a genuinely new concept. no: reuses or extends an existing one.",
  },
]

/**
 * One judge rest: a verdict per unforced note (a forced note is asked
 * nothing) plus four severity answers. Dismissing a note is the risky
 * direction, so only a confident non-`edit` verdict on uncut evidence counts;
 * a cut, unanswered or below-floor note is an `edit`. Severity answers on a
 * non-`edit` note are ignored. A confident `could` edit becomes `defer`.
 */
const triage =
  (severities: Map<string, Severity>) =>
  async (notes: readonly ReviewNote[]): Promise<ReadonlyMap<string, kit.Verdict>> => {
    const asked = notes.filter((n) => !n.forced)
    const judgment: Judgment =
      asked.length === 0
        ? { answers: {}, truncated: [] }
        : await judge("review.triage", {
            questions: asked.flatMap((n) => [verdictQuestion(n), ...severityQuestions(n)]),
            evidence: Object.fromEntries(
              asked.map((n) => [
                n.id,
                `Anchor: ${n.anchor}\nReviewer's text: ${n.before}\nHuman's text: ${n.text}`,
              ]),
            ),
            message: t.buildReviewTriageMessage(),
            label: "Judging each note",
          })
    const { answers, truncated } = judgment
    const minP = numeric(vars.reviewNoteActionable, Infinity)
    const severityMinP = numeric(vars.reviewSeverityMinP, Infinity)
    severities.clear()
    return new Map(
      notes.map((n): [string, kit.Verdict] => {
        const verdict = n.forced
          ? undefined
          : VERDICTS.find((v) => v !== "edit" && answered(answers[n.id], v, minP))
        if (verdict !== undefined && !truncated.includes(n.id)) return [n.id, verdict]
        const severity = severityOf(n, judgment, severityMinP)
        severities.set(n.id, severity)
        return [n.id, severity.tier === "could" ? "defer" : "edit"]
      }),
    )
  }

const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

/**
 * A reviewer writes `.gtd/REVIEW.md` over everything since `base`, a human
 * reviews and signs off or comments, and each note is judged: edits go to
 * another planning lap, questions are answered in place, nits fixed in one
 * batch, praise dropped.
 */
export const review = (
  base: string,
  escalations: EscalationCount = { rounds: 0 },
  options: BuildTailOptions = {},
): Promise<kit.ReviewOutcome> => {
  const { guard, guardRests, fixAccess, rules } = options
  const feedback: FeedbackTarget = options.feedback ?? {
    file: REQUIREMENTS,
    collecting,
    unmatched:
      "gtd land: no declared pattern matches the pending changes — write .gtd/REQUIREMENTS.md from the feedback, or change nothing when it asks for nothing",
  }
  const severities = new Map<string, Severity>()
  // Armed by a defer-only round to pick the next gate's message; a fresh
  // review (`reviewing`) disarms it.
  let deferred: readonly t.NoteInput[] = []
  return kit.review(base, {
    file: REVIEW,
    feedback: feedback.file,
    isCode,
    reviewing: (b, carry) => {
      deferred = []
      return reviewing(b, carry, options.lap)
    },
    fixRisks: guarded((notes) => fixRisks(notes, fixAccess, rules), guard),
    keepGreen: () => healthy(() => fixCheck(rules), { escalations, guard, guardRests, rules }),
    awaitReview: (b) => {
      const notes = deferred
      deferred = []
      return notes.length > 0
        ? awaitReview(b, t.buildReviewAwaitAfterDeferMessage(b, notes))
        : awaitReview(b)
    },
    reviewMissing,
    collecting: feedback.collecting,
    triage: triage(severities),
    defer: (notes) => {
      deferred = notes.map((n) => ({
        id: n.id,
        anchor: n.anchor,
        text: n.text,
        label: severities.get(n.id)!.reason,
      }))
      return deferNotes(deferred, head())
    },
    answerQuestions: answerReviewQuestions,
    fixNits: guarded((notes) => fixNits(notes, fixAccess, rules), guard),
    close: closeReview,
    captures: {
      edits: t.reviewEditsCapture,
      notes: t.reviewNotesCapture,
      editNotes: (round, edits, answeredAt) =>
        t.reviewEditNotesCapture(
          round,
          edits
            .map((n, i) => ({ n, i, s: severities.get(n.id) }))
            // critical before should, then one-way doors, then new concepts
            .sort(
              (x, y) =>
                Number(x.s?.tier === "should") - Number(y.s?.tier === "should") ||
                (x.s?.rank ?? 2) - (y.s?.rank ?? 2) ||
                x.i - y.i,
            )
            .map(({ n, s }) => ({
              id: n.id,
              anchor: n.anchor,
              text: n.forced ? n.text.replace(/^!\s*/, "") : n.text,
              ...(s === undefined ? {} : { label: s.reason }),
            })),
          answeredAt,
        ),
    },
    refusals: {
      deleted:
        "gtd land: review-doc: .gtd/REVIEW.md was deleted — restore it, or leave a note (or edit code) to request changes.",
      unmatched: feedback.unmatched,
      ...(feedback.dropped === undefined ? {} : { dropped: feedback.dropped }),
    },
  })
}

export interface FeedbackTarget {
  readonly file: string
  readonly collecting: (capture: string, round: kit.CollectRound) => Promise<void>
  /** Refusal when the collecting turn changed something but not `file`. */
  readonly unmatched: string
  readonly dropped?: (requested: kit.Requested) => string
}

export interface BuildTailOptions {
  /** Fix first when entered red; default `false`. */
  readonly fixFirst?: boolean
  /** Skip keeping green; default `false`. */
  readonly green?: boolean
  /** Runs after every code-changing turn: fix-check, quality fix, risk fix, nit fix, escalation describe. */
  readonly guard?: Guard
  /** `false`: `guard` skips the escalation's human rests. */
  readonly guardRests?: boolean
  /** Quality-lap lenses; default `lensesOf(vars.qualityReviews)`. */
  readonly lenses?: readonly string[]
  readonly feedback?: FeedbackTarget
  /** Write access for the nit and risk fix turns; absent: the bundled `access` export decides. */
  readonly fixAccess?: ScopeAccess
  /** The commit the quality lap reviews from; absent: `start()`. */
  readonly lensBase?: string
  /** Appended to every fix and describe prompt of the tail. */
  readonly rules?: string
  /** Absent: "first". */
  readonly lap?: t.ReviewRange
}

/** The build tail: fix (when entered red), keep green unless `green`, the quality lap, then human review since `base`. */
export function buildTail(base: string, options?: BuildTailOptions): Promise<kit.ReviewOutcome>
/** @deprecated Pass `buildTail(base, { fixFirst, green, ...options })`. */
export function buildTail(
  fixFirst: boolean,
  base: string,
  green?: boolean,
  options?: BuildTailOptions,
): Promise<kit.ReviewOutcome>
export function buildTail(
  first: boolean | string,
  second?: string | BuildTailOptions,
  third = false,
  fourth: BuildTailOptions = {},
): Promise<kit.ReviewOutcome> {
  const base = typeof first === "string" ? first : (second as string)
  const options: BuildTailOptions =
    typeof first === "string"
      ? ((second as BuildTailOptions | undefined) ?? {})
      : { ...fourth, fixFirst: first, green: third }
  return tail(
    options.fixFirst ?? false,
    (escalations) => review(base, escalations, options),
    options.green ?? false,
    options.guard,
    options.lenses,
    options.guardRests,
    options.lensBase,
    options.rules,
  )
}

/**
 * Undo the human's review-round code edits. A path changed since the human
 * left it is not overwritten; requireRevert names it instead.
 */
export const reUnwind = async (
  feedback: Extract<kit.ReviewOutcome, { verdict: "feedback" }>,
): Promise<void> => {
  const { base, restoreFrom, edited } = feedback
  const restore = edited.filter((c) => c.status !== "added").map((c) => c.path)
  const remove = edited.filter((c) => c.status === "added").map((c) => c.path)
  await run("re-unwind", restoreScript(base, { restore, remove }, restoreFrom), {
    label: "Re-unwinding your review edit",
    file: REVIEW,
    base,
  })
  requireRevert(edited, base)
}
