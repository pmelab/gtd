import {
  answered,
  changesSince,
  head,
  judge,
  numeric,
  requireRevert,
  restoreScript,
  run,
  showScript,
  vars,
  writeScript,
  type JudgeQuestion,
  type Judgment,
  type ScopeAccess,
} from "../../flows/index.js"
import type { ReviewNote } from "../../steering/index.js"
import * as kit from "../../workflow-kit/index.js"
import { guarded, healthy, type EscalationCount } from "./health.js"
import { NO_FINDINGS, type LensReport } from "./lenses.js"
import {
  answerReviewQuestions,
  awaitReview,
  collecting,
  fixCheck,
  fixNits,
  fixRisks,
  QUALITY,
  REQUIREMENTS,
  REVIEW,
  reviewMissing,
} from "./steps.js"
import { closeReview, isOptionalObject, tail, type TailOptions } from "./tail.js"
import * as t from "./text.js"

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

const TIER_ORDER: Readonly<Record<Tier, number>> = { critical: 0, should: 1, could: 2 }

/** Capture order: critical, should, could; within a tier one-way doors, then new concepts. */
const captureKey = (s: Severity | undefined): number =>
  s === undefined ? 2 : TIER_ORDER[s.tier] * 3 + s.rank

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

/** Anything unanswered, unrecognised, cut or below `minP` is `critical`, never `could`. */
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
 * non-`edit` note are ignored; on an `edit` they order the collecting turn.
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
        severities.set(n.id, severityOf(n, judgment, severityMinP))
        return [n.id, "edit"]
      }),
    )
  }

export const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

/**
 * gtd writes `.gtd/REVIEW.md` from the quality lap's `report` — no reviewer
 * turn — and removes what the fixer left in `.gtd/QUALITY.md`. A re-review
 * after fixed nits restores the doc as committed at `carry`, answers kept;
 * a fresh one leaves out the notes the human already answered.
 */
const composing = (
  base: string,
  report: LensReport,
  carry?: string,
  nitFix?: string,
  answered: ReadonlySet<string> = new Set(),
): Promise<void> =>
  run(
    "review.composing",
    carry === undefined
      ? writeScript(
          REVIEW,
          t.composedReview(base, {
            ...report,
            weakened: kit.removedAssertions(changesSince(base)),
            nitFix,
            answered,
          }),
          [QUALITY],
        )
      : showScript(carry, REVIEW, REVIEW),
    { label: "Composing the review", file: REVIEW, base },
  )

/**
 * The quality lap's notes reach a human over everything since `base`, who
 * answers each one — fix as suggested, won't fix, or their own answer — and
 * may comment. A fix joins the nit batch, a won't-fix is dropped, and an own
 * answer or comment is judged: edits go to another planning lap, questions
 * are answered in place, nits fixed in one batch, praise dropped.
 */
export const humanReview = (
  base: string,
  escalations: EscalationCount = { rounds: 0 },
  options: Omit<BuildTailOptions, "fixFirst" | "green"> = {},
): Promise<kit.ReviewOutcome> => {
  const { guard, guardRests, fixAccess, rules } = options
  const feedback: FeedbackTarget = options.feedback ?? {
    file: REQUIREMENTS,
    collecting,
    unmatched:
      "gtd land: no declared pattern matches the pending changes — write .gtd/REQUIREMENTS.md from the feedback, or change nothing when it asks for nothing",
  }
  const severities = new Map<string, Severity>()
  // Set by a nit fix, so the fresh review that follows names its commit.
  let nitFix: string | undefined
  // Every note the human answered in this review, left out of a fresh one.
  const answered = new Set<string>()
  return kit.review(base, {
    file: REVIEW,
    feedback: feedback.file,
    isCode,
    reviewing: (b, carry) => {
      const fixedAt = nitFix
      nitFix = undefined
      return composing(b, options.report ?? NO_FINDINGS, carry, fixedAt, answered)
    },
    fixRisks: guarded((notes) => fixRisks(notes, fixAccess, rules), guard),
    keepGreen: () => healthy(() => fixCheck(rules), { escalations, guard, guardRests, rules }),
    awaitReview: (b) => awaitReview(b),
    reviewMissing,
    collecting: feedback.collecting,
    triage: triage(severities),
    decided: (decisions) => decisions.forEach((d) => answered.add(d.anchor)),
    answerQuestions: answerReviewQuestions,
    fixNits: async (notes) => {
      await guarded((n: typeof notes) => fixNits(n, fixAccess, rules), guard)(notes)
      nitFix = head()
    },
    close: closeReview,
    captures: {
      edits: t.reviewEditsCapture,
      notes: t.reviewNotesCapture,
      editNotes: (round, edits, answeredAt) =>
        t.reviewEditNotesCapture(
          round,
          edits
            .map((n, i) => ({
              n,
              i,
              s: severities.get(n.id),
              key: captureKey(severities.get(n.id)),
            }))
            .sort((x, y) => x.key - y.key || x.i - y.i)
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

export interface BuildTailOptions extends TailOptions {
  readonly feedback?: FeedbackTarget | undefined
  /** Write access for the nit and risk fix turns; absent: the bundled `access` export decides. */
  readonly fixAccess?: ScopeAccess | undefined
  /** @deprecated No reviewer turn reads it since the review is composed. */
  readonly lap?: t.ReviewRange | undefined
  /** What the triaged quality lap left for the review; absent: nothing. */
  readonly report?: LensReport | undefined
}

/** The build tail: fix (when entered red), keep green unless `green`, the triaged quality lap, then human review since `base`. */
export function buildTail(base: string, options?: BuildTailOptions): Promise<kit.ReviewOutcome>
/** @deprecated Pass `buildTail(base, { fixFirst, green, ...options })`. */
export function buildTail(
  fixFirst: boolean,
  base: string,
  green?: boolean,
  options?: Omit<BuildTailOptions, "fixFirst" | "green">,
): Promise<kit.ReviewOutcome>
export function buildTail(
  first: boolean | string,
  second?: string | BuildTailOptions,
  ...rest: unknown[]
): Promise<kit.ReviewOutcome> {
  const options = callForm(first, second, rest)
  // Before any step runs, so a bad call never leaves a half-walked flow.
  if (options === undefined) {
    return Promise.reject(
      new Error(
        "buildTail takes buildTail(base, options?) or the deprecated buildTail(fixFirst, base, green?, options?); this call fits neither",
      ),
    )
  }
  const [base, form] = options
  return tail((escalations, report) => humanReview(base, escalations, { ...form, report }), {
    ...form,
    triage: true,
  })
}

const isOptionalBoolean = (value: unknown): value is boolean | null | undefined =>
  value == null || typeof value === "boolean"

const legacyForm = (
  fixFirst: unknown,
  base: string,
  green: unknown,
  options: unknown,
): [string, BuildTailOptions] | undefined =>
  isOptionalBoolean(fixFirst) && isOptionalBoolean(green) && isOptionalObject(options)
    ? [base, { ...options, fixFirst: fixFirst ?? undefined, green: green ?? undefined }]
    : undefined

const currentForm = (
  base: string,
  options: unknown,
  third: unknown,
  fourth: unknown,
): [string, BuildTailOptions] | undefined =>
  isOptionalObject(options) && third == null && fourth == null ? [base, options ?? {}] : undefined

// gtd.config.ts is untyped at runtime, so every argument is checked against the form chosen.
const callForm = (
  first: unknown,
  second: unknown,
  [third, fourth, ...extra]: readonly unknown[],
): [string, BuildTailOptions] | undefined => {
  if (extra.some((value) => value != null)) return undefined
  if (typeof second === "string") return legacyForm(first, second, third, fourth)
  if (typeof first === "string") return currentForm(first, second, third, fourth)
  return undefined
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
