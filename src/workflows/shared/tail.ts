import {
  read,
  refuse,
  removeScript,
  run,
  scope,
  showScript,
  vars,
  writeScript,
} from "../../flows/index.js"
import { reviewRisks } from "../../steering/index.js"
import * as kit from "../../workflow-kit/index.js"
import { guarded, healthy, type EscalationCount, type Guard } from "./health.js"
import {
  awaitReview,
  fixCheck,
  fixRisks,
  QUALITY,
  REQUIREMENTS,
  REVIEW,
  reviewing,
  reviewMissing,
  reviewQuality,
} from "./steps.js"
import { findingsOf, NO_FINDINGS, triageFindings, type Finding, type LensReport } from "./lenses.js"
import * as t from "./text.js"

/** The reviewer's own `.gtd/REVIEW.md`, kept beside the human's notes so `fix` can tell them apart. */
export const REVIEW_ORIG = ".gtd/REVIEW.orig.md"

/**
 * One review turn per lens over the whole change, each appending every
 * finding to `.gtd/QUALITY.md`. Resolves `"findings"` when that file
 * has any.
 */
export const qualityLap = (
  guard?: Guard,
  lenses?: readonly string[],
  base?: string,
): Promise<"clean" | "findings"> => lensLap(guard, lenses, base, undefined, () => {})

const COVERAGE = "criteria-coverage"

// `seen` gets each lens and every finding in the file once its turn is done.
const lensLap = (
  guard: Guard | undefined,
  lenses: readonly string[] | undefined,
  base: string | undefined,
  given: string | undefined,
  seen: (lens: string, findings: readonly Finding[]) => void,
): Promise<"clean" | "findings"> => {
  const requirements = given ?? read(REQUIREMENTS)
  return kit.qualityLap(
    (lenses ?? kit.lensEntriesOf(vars.qualityReviews ?? "")).filter(
      (entry) => requirements !== undefined || kit.lensOf(entry).lens !== COVERAGE,
    ),
    guarded(async (entry: string) => {
      const { lens, model } = kit.lensOf(entry)
      await reviewQuality(lens, base, model, lens === COVERAGE ? requirements : undefined)
      seen(lens, findingsOf(read(QUALITY) ?? ""))
    }, guard),
    QUALITY,
  )
}

// What the fixer left is in the lap's report by now; the next lap must not append to it.
const closeQuality = async (): Promise<void> => {
  if (read(QUALITY) === undefined) return
  await run("quality.closing", removeScript([QUALITY]), { label: "Clearing quality findings" })
}

/** `.gtd/REVIEW.md` removed at the end of a round at commit `round`. */
export const closeReview = (round: string): Promise<void> =>
  run("review.closing", removeScript([REVIEW, REVIEW_ORIG]), {
    label: "Closing the review",
    base: round,
  })

/** Refuses while a reviewer's notes still await `gtd door fix`. */
export const refusePendingHandOff = (): void => {
  if (read(REVIEW_ORIG) !== undefined) {
    refuse(
      `gtd: ${REVIEW_ORIG} is a pending hand-off — run \`gtd door fix\`, or remove ${REVIEW} and ${REVIEW_ORIG}.`,
    )
  }
}

export interface TailOptions {
  /** Fix first when entered red; default `false`. */
  readonly fixFirst?: boolean | undefined
  /** Asserts the tree is already green, so the tail skips keep-green; default `false`. */
  readonly green?: boolean | undefined
  /** Runs after every code-changing turn: fix-check, quality fix, risk fix, nit fix, escalation describe. */
  readonly guard?: Guard | undefined
  /** Quality-lap lens entries, `<lens>` or `<lens>=<model>`; default `lensEntriesOf(vars.qualityReviews)`. */
  readonly lenses?: readonly string[] | undefined
  /** `false` leaves the escalation's human rests unguarded; default `true`. */
  readonly guardRests?: boolean | undefined
  /** The commit the quality lap reviews from; absent: `start()`. */
  readonly lensBase?: string | undefined
  /** Appended to every fix and describe prompt of the tail. */
  readonly rules?: string | undefined
  /**
   * The requirements the change was built to, for the `criteria-coverage`
   * lens; absent: `.gtd/REQUIREMENTS.md`, and with neither the lens is skipped.
   */
  readonly requirements?: string | undefined
}

/**
 * The build tail: fix (when entered red), keep green, the quality lap — a
 * judge sorts its findings and the mechanical ones are fixed — then the
 * finding gate over the rest, then `finish` with what became of them all.
 */
export function tail<T>(
  finish: (escalations: EscalationCount, report: LensReport) => Promise<T>,
  options?: TailOptions,
): Promise<T>
/** @deprecated Pass `tail(finish, { fixFirst, green, guard, lenses, guardRests, lensBase, rules })`. */
export function tail<T>(
  fixFirst: boolean,
  finish: (escalations: EscalationCount, report: LensReport) => Promise<T>,
  green?: boolean,
  guard?: Guard,
  lenses?: readonly string[],
  guardRests?: boolean,
  lensBase?: string,
  rules?: string,
): Promise<T>
export function tail<T>(first: unknown, second?: unknown, ...rest: unknown[]): Promise<T> {
  const form = tailForm<T>(first, second, rest)
  // Before any step runs, so a bad call never leaves a half-walked flow.
  if (form === undefined) {
    return Promise.reject(
      new Error(
        "tail takes tail(finish, options?) or the deprecated tail(fixFirst, finish, green?, guard?, lenses?, guardRests?, lensBase?, rules?); this call fits neither",
      ),
    )
  }
  const [finish, options] = form
  return runTail(finish, options)
}

type Finish<T> = (escalations: EscalationCount, report: LensReport) => Promise<T>

// null reads as absent; an un-awaited Promise is a mistake, not options.
export const isOptionalObject = (value: unknown): value is object | null | undefined =>
  value == null ||
  (typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { then?: unknown }).then !== "function")

// Picks the form by shape only: the deprecated form never validated its
// positionals, and still runs whatever it ran before.
const tailForm = <T>(
  first: unknown,
  second: unknown,
  rest: readonly unknown[],
): [Finish<T>, TailOptions] | undefined => {
  // A function first is a misplaced finish, never a fixFirst.
  if (typeof second === "function" && typeof first !== "function") {
    const [green, guard, lenses, guardRests, lensBase, rules] = rest
    const options = { fixFirst: first, green, guard, lenses, guardRests, lensBase, rules }
    return [second as Finish<T>, options as TailOptions]
  }
  if (typeof first === "function" && isOptionalObject(second) && rest.every((v) => v == null))
    return [first as Finish<T>, (second as TailOptions | null | undefined) ?? {}]
  return undefined
}

const runTail = <T>(finish: Finish<T>, options: TailOptions): Promise<T> =>
  scope("build", async () => {
    const { guard, lenses, lensBase, rules, requirements } = options
    // Only undefined defaults: a null reaches every escalation as falsy, as it reaches review's.
    const guardRests = options.guardRests === undefined ? true : options.guardRests
    const escalations: EscalationCount = { rounds: 0 }
    const fix = () => fixCheck(rules)
    // fixFirst's own fix + healthy below already is the full run.
    // Truthy, not `true`: an untyped config's flags read as they always did.
    if (options.fixFirst) {
      await guarded(fix, guard)()
      await healthy(fix, { fixesSoFar: 1, escalations, guard, guardRests, rules })
    } else if (!options.green) await healthy(fix, { escalations, guard, guardRests, rules })
    // The lap runs once a tail: after its findings are fixed, `finish` follows.
    // Lenses append, so a title the file did not hold before a lens's turn is that lens's.
    const byTitle: { title: string; lens: string }[] = []
    const lap = await lensLap(guard, lenses, lensBase, requirements, (lens, findings) => {
      const before = byTitle.map((f) => f.title)
      for (const { title } of findings) {
        const at = before.indexOf(title)
        if (at >= 0) before.splice(at, 1)
        else byTitle.push({ title, lens })
      }
    })
    // Asked once per finding in file order, so a title two lenses wrote goes to each in turn.
    const lensOf = (f: Finding): string | undefined => {
      const at = byTitle.findIndex((e) => e.title === f.title)
      return at < 0 ? undefined : byTitle.splice(at, 1)[0]!.lens
    }
    const report =
      lap === "findings"
        ? await triageFindings({ escalations, guard, guardRests, rules, lensOf })
        : NO_FINDINGS
    await closeQuality()
    return finish(escalations, report)
  })

/**
 * The fix workflow's human review since `base`: a sign-off closes
 * `.gtd/REVIEW.md`; a note leaves it, with the reviewer's own version as
 * `REVIEW_ORIG`, for the next `fix` to read — never a re-plan.
 */
export const handOffReview = (
  base: string,
  escalations: EscalationCount,
  guard?: Guard,
  report: LensReport = NO_FINDINGS,
): Promise<void> => {
  // Set by a risk fix, so the re-review written next is summarised whatever it marks.
  let riskFixed = false
  return kit.reviewToHandOff(base, {
    file: REVIEW,
    reviewing: guarded(async (b, carry) => {
      const afterRiskFix = riskFixed
      riskFixed = false
      await reviewing(b, carry)
      const review = read(REVIEW)
      // A risk-marked draft is fixed and written again first: the re-reviewer edits it, never gtd's summary.
      if (review === undefined || (!afterRiskFix && reviewRisks(review).length > 0)) return
      const full = t.withSummary(review, { report })
      if (full !== review) {
        await run("review.carrying", writeScript(REVIEW, full), {
          label: "Adding the quality lap's summary",
        })
      }
    }, guard),
    fixRisks: guarded((risks) => {
      riskFixed = true
      return fixRisks(risks)
    }, guard),
    keepGreen: () => healthy(fixCheck, { escalations, guard }),
    awaitReview: (b) => awaitReview(b, t.handOffAwaitReviewMessage(b)),
    reviewMissing,
    close: closeReview,
    handOff: (reviewed) =>
      // The committed blob, not the working copy: the human's notes already landed over it.
      run("review.handing-off", showScript(reviewed, REVIEW, REVIEW_ORIG), {
        label: "Handing your notes to fix",
      }),
    threadsPending:
      "gtd land: open-threads: a thread in .gtd/REVIEW.md or an `H:` code comment waits on the agent — nothing answers it here; delete it, or turn it into a note for fix.",
    unparsed:
      "gtd land: review-doc: your edit to .gtd/REVIEW.md contains no note fix can read — restore the deleted chunk, or write the note as a line under its entry.",
    deleted:
      "gtd land: review-doc: .gtd/REVIEW.md was deleted — restore it, or leave a note to hand to fix.",
  })
}

/** The tail the fix workflow runs: ends at the hand-off review since `base`, which gets what the lap left. */
export const handOffTail = (fixFirst: boolean, base: string, guard?: Guard): Promise<void> =>
  tail((escalations, report) => handOffReview(base, escalations, guard, report), {
    fixFirst,
    guard,
  })
