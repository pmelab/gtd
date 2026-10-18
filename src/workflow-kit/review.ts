import {
  changes,
  changesSince,
  hasThreadFor,
  head,
  read,
  refuse,
  requireReplies,
  requireThreadsClosed,
  type Change,
} from "../flows/index.js"
import {
  parseThreads,
  reviewNotes,
  reviewRisks,
  stripCodeThreads,
  type ReviewNote,
} from "../steering/index.js"

/** How a review round ended. `feedback` carries what the human edited, for the re-unwind to undo. */
export type ReviewOutcome =
  | { readonly verdict: "signoff" }
  | {
      readonly verdict: "feedback"
      /** The last round's commit, the re-plan base. */
      readonly base: string
      /** The commit the review file was written at; edits are restored from it. */
      readonly restoreFrom: string
      /** The code paths the rounds changed, with their content before. */
      readonly edited: readonly Change[]
    }

export type CollectRound = "reply" | "edits" | "notes" | "triaged"

/** What a round asked to change: the notes judged `edit` and the code paths the human hand-edited. */
export interface Requested {
  /** Empty on a hand-edit round: that path runs no triage. */
  readonly notes: readonly ReviewNote[]
  readonly paths: readonly string[]
}

export type Verdict = "edit" | "question" | "nit" | "praise" | "defer"

export type ReviewRisk = ReturnType<typeof reviewRisks>[number]

/** Everything a review round decides or says, passed in: its files, steps, judge and texts. */
export interface ReviewPolicy {
  /** The review steering file the reviewer writes and the human annotates. */
  readonly file: string
  /** The file a collecting turn folds feedback into; its presence means feedback. */
  readonly feedback: string
  /** Whether a path is code, as opposed to steering state. */
  readonly isCode: (path: string) => boolean
  /** Write `file` over everything since `base`, carrying the answers of commit `carry` when given. */
  readonly reviewing: (base: string, carry?: string) => Promise<void>
  readonly fixRisks: (risks: readonly ReviewRisk[]) => Promise<void>
  readonly keepGreen: () => Promise<void>
  readonly awaitReview: (base: string) => Promise<void>
  /** The round at commit `round` left no `file`. */
  readonly reviewMissing: (round: string) => Promise<void>
  /** Turn the round `capture` describes into `feedback`, or change nothing. */
  readonly collecting: (capture: string, round: CollectRound) => Promise<void>
  /** One verdict per note, keyed by note id; a note without one is an edit. */
  readonly triage: (notes: readonly ReviewNote[]) => Promise<ReadonlyMap<string, Verdict>>
  readonly answerQuestions: (notes: readonly ReviewNote[]) => Promise<void>
  readonly fixNits: (notes: readonly ReviewNote[]) => Promise<void>
  /** Leave `defer` notes out of the round. */
  readonly defer: (notes: readonly ReviewNote[]) => Promise<void>
  /** Remove `file` at the end of a round at commit `round`. */
  readonly close: (round: string) => Promise<void>
  /** What a collecting turn reads. */
  readonly captures: {
    /** `from` set: the hand-edits landed in an earlier commit than `round`, so name the range. */
    readonly edits: (round: string, from?: string) => string
    readonly notes: (round: string) => string
    readonly editNotes: (
      round: string,
      edits: readonly ReviewNote[],
      answeredAt: string | undefined,
    ) => string
  }
  readonly refusals: {
    /** `file` was deleted at the gate. */
    readonly deleted: string
    /** The collecting turn changed something without writing `feedback`. */
    readonly unmatched: string
    /**
     * The collecting turn changed nothing though the round carried an `edit`
     * note or a code hand-edit. Absent: that round signs off.
     */
    readonly dropped?: (requested: Requested) => string
  }
}

const collect = async (
  p: ReviewPolicy,
  capture: string,
  round: CollectRound,
  requested?: Requested,
): Promise<"signoff" | "feedback"> => {
  await p.collecting(capture, round)
  if (read(p.feedback) !== undefined) return "feedback"
  if (changes().length === 0) {
    if (
      p.refusals.dropped !== undefined &&
      requested !== undefined &&
      requested.notes.length + requested.paths.length > 0
    )
      return refuse(p.refusals.dropped(requested))
    return "signoff"
  }
  return refuse(p.refusals.unmatched)
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A review with ticks and THREAD footnotes (definition plus markers) removed:
 * what is left is line notes and one-shot footnotes, which the triage judges.
 */
const notesOf = (text: string): string => {
  let out = text
  for (const { name } of parseThreads(text)) {
    const n = escapeRe(name)
    out = out
      .replace(
        new RegExp(
          `^\\[\\^${n}\\]:[^\\n]*(\\n(?: {2,}|\\t)[^\\n]*|\\n(?=\\s*\\n(?: {2,}|\\t)))*`,
          "gim",
        ),
        "",
      )
      .replace(new RegExp(`\\[\\^${n}\\]`, "gi"), "")
  }
  return out.replace(/\[x\]/gi, "[ ]").replace(/\s+/g, " ").trim()
}

/**
 * The human gate and its reply rounds: a question gets an answer inside
 * the review file and rests at the gate again, without a lap. Resolves the
 * commit of the last collecting turn, `"missing"` when the round left no
 * review, or `undefined` when no such turn ran.
 */
const converse = async (
  p: ReviewPolicy,
  base: string,
  collectedBefore?: string,
): Promise<string | undefined> => {
  let collectedAt = collectedBefore
  for (;;) {
    await p.awaitReview(base)
    if (changes(p.file).some((c) => c.status === "deleted")) refuse(p.refusals.deleted)
    if (read(p.file) === undefined) {
      await p.reviewMissing(head())
      return "missing"
    }
    requireThreadsClosed(p.file)
    if (!hasThreadFor("agent", p.file)) return collectedAt
    await p.collecting(p.captures.edits(head()), "reply")
    collectedAt = head()
    requireReplies(p.file)
    if (!hasThreadFor("human", p.file)) return collectedAt
  }
}

/** What `finish` hands back to `review`: an outcome, or another lap at the gate. */
type Finish =
  | ReviewOutcome
  | { readonly next: "await"; readonly reviewed: string }
  | { readonly next: "rereview"; readonly carry: string | undefined }

/** What a round's routing needs from `finish`: its closing step and the ways it ends. */
interface Round {
  readonly round: string
  readonly close: () => Promise<void>
  readonly outcome: (verdict: "signoff" | "feedback") => ReviewOutcome
  readonly unfolded: () => Promise<Finish>
}

/** Judge every note, then run each verdict's route: answers, then nit fixes, then deferrals, then the edits' lap. */
export const routeNotes = async (
  p: ReviewPolicy,
  notes: readonly ReviewNote[],
  r: Round,
): Promise<Finish> => {
  const verdicts = await p.triage(notes)
  const of = (v: Verdict): ReviewNote[] => notes.filter((n) => (verdicts.get(n.id) ?? "edit") === v)
  const [edits, questions, nits, deferred] = [of("edit"), of("question"), of("nit"), of("defer")]
  if (edits.length + questions.length + nits.length + deferred.length === 0) return r.unfolded()

  let answeredAt: string | undefined
  if (questions.length > 0) {
    await p.answerQuestions(questions)
    answeredAt = head()
  }
  if (nits.length > 0) {
    await p.fixNits(nits)
    await p.keepGreen()
  }
  if (deferred.length > 0) await p.defer(deferred)
  if (edits.length > 0) {
    await r.close()
    return r.outcome(
      await collect(p, p.captures.editNotes(r.round, edits, answeredAt), "triaged", {
        notes: edits,
        paths: [],
      }),
    )
  }
  if (nits.length > 0) {
    await r.close()
    return { next: "rereview", carry: answeredAt }
  }
  return { next: "await", reviewed: answeredAt ?? r.round }
}

/** A code edit, not a thread-only change: lines that only add, answer or remove code threads don't count. */
const isCodeEdit = (p: ReviewPolicy, c: Change): boolean =>
  p.isCode(c.path) &&
  stripCodeThreads(c.path, c.before ?? "") !== stripCodeThreads(c.path, c.after ?? "")

/** Whether anything but thread edits and ticks landed in the review file since `commit`. */
const notedSince = (p: ReviewPolicy, commit: string): boolean =>
  changesSince(commit).some(
    (c) => c.path === p.file && notesOf(c.before ?? "") !== notesOf(read(p.file) ?? ""),
  )

/**
 * What the in-loop collecting turn left: `folded` when it wrote `feedback`
 * (those folds need their lap whatever is judged later), `settled` when only
 * thread edits and ticks landed after it.
 */
const afterCollect = (
  p: ReviewPolicy,
  collectedAt: string | undefined,
): { folded: boolean; settled: boolean } =>
  // While the collecting turn is still pending its commit has no hash, so no
  // range can start there; the flow rests at the close before it matters.
  collectedAt === "" ? { folded: false, settled: false } : settledAfter(p, collectedAt)

const settledAfter = (
  p: ReviewPolicy,
  collectedAt: string | undefined,
): { folded: boolean; settled: boolean } => ({
  folded: collectedAt !== undefined && read(p.feedback) !== undefined,
  settled:
    collectedAt !== undefined &&
    changesSince(collectedAt).every((c) => !isCodeEdit(p, c)) &&
    !notedSince(p, collectedAt),
})

const finish = async (
  p: ReviewPolicy,
  reviewed: string,
  collectedAt: string | undefined,
): Promise<Finish> => {
  // Everything the human did is read before any agent turn runs, so a nit fix
  // is never counted as a hand-edit.
  const round = head()
  const since = changesSince(reviewed)
  const edited = since.filter((c) => isCodeEdit(p, c))
  const { folded, settled } = afterCollect(p, collectedAt)
  // The review gate clears every tick before its commit, so a changed
  // review file is a note, never a tick.
  const noted = since.some((c) => c.path === p.file)
  const close = (): Promise<void> => p.close(round)
  const outcome = (verdict: "signoff" | "feedback"): ReviewOutcome =>
    verdict === "signoff" ? { verdict } : { verdict, base: round, restoreFrom: reviewed, edited }
  const unfolded = async (): Promise<Finish> => {
    await close()
    return outcome(folded ? "feedback" : "signoff")
  }

  // Thread-only edits settled the round, but a change note or hand-edit since
  // `reviewed` must still reach a collecting turn when a dropped edit is refused.
  const reopened = settled && !folded && p.refusals.dropped !== undefined
  if ((settled && !reopened) || (edited.length === 0 && !noted)) return unfolded()
  if (edited.length > 0) {
    await close()
    return outcome(
      await collect(p, p.captures.edits(round, reopened ? reviewed : undefined), "edits", {
        notes: [],
        paths: edited.map((c) => c.path),
      }),
    )
  }
  // An unchanged review file has no baseline entry, which would read as all-new.
  const notes = reviewNotes(since.get(p.file)?.before ?? "", read(p.file) ?? "")
  if (notes.length === 0) {
    if (reopened) return unfolded()
    await close()
    return outcome(await collect(p, p.captures.notes(round), "notes"))
  }
  return routeNotes(p, notes, { round, close, outcome, unfolded })
}

/** Write the review; if it marks risks, fix them, keep green, and write it again — once, so the re-review's own risks reach the human unfixed. */
const reviewOnce = async (
  p: Pick<ReviewPolicy, "file" | "reviewing" | "fixRisks" | "keepGreen">,
  base: string,
  carry: string | undefined,
) => {
  await p.reviewing(base, carry)
  const risks = reviewRisks(read(p.file) ?? "")
  if (risks.length === 0) return
  await p.fixRisks(risks)
  await p.keepGreen()
  await p.reviewing(base, carry)
}

/**
 * A reviewer writes the review over everything since `base`, a human
 * reviews and signs off or comments, and each note is judged: edits go to
 * another lap, questions are answered in place, nits fixed in one batch,
 * praise dropped.
 */
export const review = async (base: string, p: ReviewPolicy): Promise<ReviewOutcome> => {
  let carry: string | undefined
  for (;;) {
    await reviewOnce(p, base, carry)
    carry = undefined
    let reviewed = head()
    let collectedAt: string | undefined
    for (;;) {
      collectedAt = await converse(p, base, collectedAt)
      if (collectedAt === "missing") break
      const result = await finish(p, reviewed, collectedAt)
      if (!("next" in result)) return result
      if (result.next === "rereview") {
        carry = result.carry
        break
      }
      reviewed = result.reviewed
    }
  }
}

/** What a review round that hands its notes on decides or says, passed in. */
export interface HandOffPolicy extends Pick<
  ReviewPolicy,
  "file" | "reviewing" | "fixRisks" | "keepGreen" | "awaitReview" | "reviewMissing" | "close"
> {
  /** Keep `file` with the human's notes for another workflow; `reviewed` holds the reviewer's own version. */
  readonly handOff: (reviewed: string) => Promise<void>
  /** `file` was deleted at the gate. */
  readonly deleted: string
  /** A thread waits on the agent at the gate, and no turn here answers it. */
  readonly threadsPending: string
  /** The review was edited but the edit parses to no note, so `fix` would have nothing to act on. */
  readonly unparsed: string
}

/**
 * A reviewer writes the review over everything since `base` and a human
 * reviews it. No note signs off and closes; any note ends the round with the
 * review left in place, for another workflow to read its notes — nothing is
 * judged or re-planned here.
 */
export const reviewToHandOff = async (base: string, p: HandOffPolicy): Promise<void> => {
  for (;;) {
    await reviewOnce(p, base, undefined)
    const reviewed = head()
    await p.awaitReview(base)
    if (changes(p.file).some((c) => c.status === "deleted")) refuse(p.deleted)
    const record = read(p.file)
    if (record === undefined) {
      await p.reviewMissing(head())
      continue
    }
    // `fix` runs in a new process, where a code thread is no longer "changed"
    // and nothing answers it — so none may be left waiting on the agent.
    requireThreadsClosed(p.file)
    if (hasThreadFor("agent", p.file)) refuse(p.threadsPending)
    const since = changesSince(reviewed)
    const before = since.get(p.file)?.before ?? record
    if (notesOf(before) === notesOf(record)) {
      // A hand edit in a sign-off round was never checked or reviewed.
      if (since.paths.some((f) => !f.startsWith(".gtd/"))) {
        await p.keepGreen()
      }
      await p.close(head())
      return
    }
    // `fix` acts only on parsed notes: an edit with none (a deleted chunk,
    // stray prose) would be closed away unread, so it is refused here.
    if (reviewNotes(before, record).length === 0) refuse(p.unparsed)
    await p.handOff(reviewed)
    return
  }
}
