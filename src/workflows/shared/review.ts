import {
  answered,
  changesSince,
  head,
  judge,
  numeric,
  read,
  refuse,
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
import { reviewChunks, reviewRisks, type ReviewNote } from "../../steering/index.js"
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
  REQUIREMENTS,
  REVIEW,
  reviewing,
  reviewMissing,
} from "./steps.js"
import { learnStandards, settlesStandard, standardsAddedSince, standardsPending } from "./learn.js"
import { isConflictTitle, parseStandards, STANDARDS } from "./standards.js"
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
  readonly security?: true
}

/** Anything unanswered, unrecognised, cut or below `minP` is `critical`, never `could`. */
export const severityOf = (
  note: { readonly id: string; readonly forced?: boolean | undefined },
  judgment: Judgment,
  minP: number,
): Severity => {
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
    return {
      tier: "critical",
      reason: `critical: ${critical.join(", ")}`,
      rank: rank(),
      ...(a("security") === "yes" ? { security: true as const } : {}),
    }
  const should = [
    ...(a("blastRadius") === "contract" ? ["contract"] : []),
    ...(a("newConcept") === "yes" ? ["new concept"] : []),
  ]
  if (should.length > 0)
    return { tier: "should", reason: `should: ${should.join(", ")}`, rank: rank() }
  return { tier: "could", reason: "could", rank: 2 }
}

/** `asks` names the change in full, `change` refers back to it. */
const severityQuestions = (id: string, asks: string, change: string): JudgeQuestion[] => [
  {
    id: `${id}.security`,
    primitive: "noul",
    instructions: `Does ${asks} touch security — authentication, authorisation, secrets, untrusted input or data exposure?`,
    criteria: "yes: it changes or could weaken a security property. no: it does not.",
  },
  {
    id: `${id}.reversibility`,
    primitive: "choice",
    instructions: `Once ${change} ships, can it be undone without breaking anyone who already depends on it?`,
    criteria:
      "one-way: a published API, file format, persisted data, protocol or other contract that cannot be taken back. two-way: can be reverted freely.",
  },
  {
    id: `${id}.blastRadius`,
    primitive: "choice",
    instructions: `How far does ${change} reach?`,
    criteria:
      "local: one function or file. module: a whole module or several files. contract: a public interface other code or users depend on.",
  },
  {
    id: `${id}.newConcept`,
    primitive: "noul",
    instructions: `Does ${change} introduce a concept new to this codebase — a new abstraction, entity or term? Judge from the evidence, never a glossary; reusing or extending an existing concept is not new.`,
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
            questions: asked.flatMap((n) => [
              verdictQuestion(n),
              ...severityQuestions(
                n.id,
                `the change the human asks for in note "${n.id}" (on "${n.anchor}")`,
                `the change in note "${n.id}"`,
              ),
            ]),
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

/** Review order: security, one-way doors, the judge unsure, then should, then could. */
const chunkKey = (s: Severity): number =>
  s.tier === "could" ? 4 : s.tier === "should" ? 3 : s.security === true ? 0 : s.rank === 0 ? 1 : 2

// A pointer's `./path#start` or `./path#start-end`, at the head of a task item.
const POINTER_RE = /^\s*[-*+] \[[ xX]\] \.\/(\S+?)#(\d+)(?:-(\d+))?(?=\s|$)/gm

/** A chunk's text, then the code each of its pointers covers. */
const chunkEvidence = (text: string): string =>
  [
    text,
    ...[...text.matchAll(POINTER_RE)].flatMap(([, path, from, to]) => {
      const code = read(path!)
        ?.split("\n")
        .slice(Number(from) - 1, Number(to ?? from))
      return code === undefined
        ? []
        : [`./${path}#${from}${to === undefined ? "" : `-${to}`}:\n${code.join("\n")}`]
    }),
  ].join("\n\n")

const bytes = (text: string): number => new TextEncoder().encode(text).length

/** Fills each batch while the budget's even share still holds its widest evidence, so nothing is cut that fits alone. */
const batched = <T extends { readonly evidence: string }>(
  items: readonly T[],
  budget: number,
): T[][] => {
  const batches: T[][] = []
  let batch: T[] = []
  let widest = 0
  for (const item of items) {
    const wider = Math.max(widest, bytes(item.evidence))
    if (batch.length > 0 && Math.floor(budget / (batch.length + 1)) < wider) {
      batches.push(batch)
      batch = []
      widest = 0
    }
    batch.push(item)
    widest = Math.max(widest, bytes(item.evidence))
  }
  return batch.length === 0 ? batches : [...batches, batch]
}

/**
 * Rates every chunk the reviewer wrote — a walkthrough chunk or a carried
 * finding — and sorts \`full\` by it, each chunk led by its tier and reason.
 * gtd's summary chunks are not rated and stay last.
 */
const ranked = async (review: string, full: string): Promise<string> => {
  const texts = t.chunkTexts(full)
  const chunks = reviewChunks(review).map((c, i) => ({
    id: `C${i + 1}`,
    title: c.title,
    evidence: chunkEvidence(texts.get(c.title) ?? ""),
  }))
  if (chunks.length === 0) return full
  const minP = numeric(vars.reviewSeverityMinP, Infinity)
  const batches = batched(chunks, numeric(vars.judgeBudgetBytes, 32768))
  const severities = new Map<string, Severity>()
  for (const [i, batch] of batches.entries()) {
    const judgment = await judge("review.ranking", {
      questions: batch.flatMap((c) =>
        severityQuestions(
          c.id,
          `the change review chunk "${c.id}" ("${c.title}") walks through`,
          `the change in review chunk "${c.id}"`,
        ),
      ),
      evidence: Object.fromEntries(batch.map((c) => [c.id, c.evidence])),
      message: t.reviewRankingMessage(),
      label:
        batches.length === 1
          ? "Ranking the review"
          : `Ranking the review (${i + 1}/${batches.length})`,
    })
    for (const c of batch) severities.set(c.id, severityOf(c, judgment, minP))
  }
  return t.rankedReview(
    full,
    chunks
      .map((c, i) => ({ c, i, s: severities.get(c.id)! }))
      .sort((x, y) => chunkKey(x.s) - chunkKey(y.s) || x.i - y.i)
      .map(({ c, s }) => ({ title: c.title, label: s.reason })),
  )
}

export const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

const composedOf = (
  base: string,
  report: LensReport,
  nitFix: string | undefined,
  answered: ReadonlySet<string>,
): t.ComposedReview => ({
  ...report,
  nitFix,
  answered,
  standards: {
    added: standardsAddedSince(base),
    undecided: parseStandards(read(STANDARDS) ?? "").undecided,
  },
})

/**
 * gtd writes `.gtd/REVIEW.md` from the quality lap's `report` — no reviewer
 * turn. A re-review
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
            ...composedOf(base, report, nitFix, answered),
            weakened: kit.removedAssertions(changesSince(base)),
          }),
        )
      : showScript(carry, REVIEW, REVIEW),
    { label: "Composing the review", file: REVIEW, base },
  )

/**
 * Refuses a review with a chunk pointing at no code, or a lap note without a
 * chunk of its own. A range with no code change has nothing to point at, so
 * there only a note's chunk needs a pointer.
 */
const requirePointers = (
  review: string,
  notes: readonly { title: string }[],
  codeChanged: boolean,
): void => {
  const chunks = reviewChunks(review)
  const titles = new Set(chunks.map((c) => c.title))
  const noted = new Set(notes.map((n) => n.title))
  const problems = [
    ...chunks
      .filter((c) => c.pointers === 0 && (codeChanged || noted.has(c.title)))
      .map((c) => `  - ${REVIEW}:${c.line + 1}: ${c.title} — points at no code`),
    ...chunks
      .filter((c) => isConflictTitle(c.title))
      .map((c) => `  - ${REVIEW}:${c.line + 1}: ${c.title} — gtd writes conflicts; leave it out`),
    ...notes.filter((n) => !titles.has(n.title)).map((n) => `  - ${n.title} — no chunk of its own`),
    // Notes and answers are matched to their chunk by title.
    ...chunks
      .filter((c, i) => chunks.findIndex((d) => d.title === c.title) !== i)
      .map((c) => `  - ${REVIEW}:${c.line + 1}: ${c.title} — a second chunk with this title`),
    // A risk is fixed before the human sees it; a note is the human's to decide.
    ...reviewRisks(review)
      .filter((r) => [...noted].some((title) => r.anchor.startsWith(`${title} ./`)))
      .map((r) => `  - ${r.anchor} — no \`Risk:\` in a quality finding's chunk`),
  ]
  if (problems.length === 0) return
  refuse(
    `gtd land: review-pointers: ${problems.length} problem(s) in ${REVIEW} — every chunk needs a pointer to its code, and every quality finding its own chunk, headed exactly as the prompt gave it:\n${problems.join("\n")}`,
  )
}

/**
 * A reviewer walks the human through everything since `base`, every chunk
 * pointing at its code and each of the lap's notes a chunk of its own; gtd
 * then adds each note's text and answer boxes, and the summary chunks.
 */
const walkthrough = async (
  base: string,
  report: t.ComposedReview,
  lap: t.ReviewRange,
  carry: string | undefined,
): Promise<void> => {
  const notes = t.titledNotes(report)
  await reviewing(base, carry, lap, t.walkthroughBlock(notes, report.nitFix))
  const written = read(REVIEW)
  // A review the reviewer did not write is the round's own refusal or rest.
  if (written === undefined) return
  const review = t.unranked(written)
  requirePointers(
    review,
    notes,
    changesSince(base).some((c) => isCode(c.path)),
  )
  const full = await ranked(review, t.withWalkthrough(review, report))
  if (full !== written) {
    await run("review.carrying", writeScript(REVIEW, full), {
      label: "Adding the quality lap's findings",
      file: REVIEW,
      base,
    })
  }
}

/**
 * The quality lap's notes reach a human over everything since `base`, who
 * answers each one — fix as suggested, won't fix, or their own answer — and
 * may comment. A fix joins the nit batch, a won't-fix is dropped, and an own
 * answer or comment is judged: edits end the review as `feedback` for the
 * caller to build, questions are answered in place, nits fixed in one batch,
 * praise dropped.
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
      const report = options.report ?? NO_FINDINGS
      return options.walkthrough === true
        ? guarded(
            () =>
              walkthrough(
                b,
                composedOf(b, report, fixedAt, answered),
                options.lap ?? "first",
                carry,
              ),
            guard,
          )()
        : composing(b, report, carry, fixedAt, answered)
    },
    fixRisks: guarded((notes) => fixRisks(notes, fixAccess, rules), guard),
    keepGreen: () => healthy(() => fixCheck(rules), { escalations, guard, guardRests, rules }),
    // Kept until the human sees a review, so a re-review after a risk fix still names it.
    awaitReview: (b) => {
      nitFix = undefined
      return awaitReview(b)
    },
    reviewMissing,
    collecting: feedback.collecting,
    triage: triage(severities),
    decided: (decisions) => decisions.forEach((d) => answered.add(d.anchor)),
    settles: settlesStandard,
    learn: learnStandards,
    pending: standardsPending,
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
  /** Which round a `walkthrough` reviewer writes; absent: `first`. */
  readonly lap?: t.ReviewRange | undefined
  /** A reviewer turn writes the review as a walkthrough of the code, the lap's notes among its chunks; absent: gtd composes it from the notes alone. */
  readonly walkthrough?: boolean | undefined
  /** What the triaged quality lap left for the review; absent: nothing. */
  readonly report?: LensReport | undefined
}

/** The build tail: fix (when entered red), keep green unless `green`, the quality lap, then human review since `base`. */
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
  return tail((escalations, report) => humanReview(base, escalations, { ...form, report }), form)
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
