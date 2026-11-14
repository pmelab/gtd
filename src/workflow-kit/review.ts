import {
  annotations,
  changesSince,
  head,
  read,
  refuse,
  widgets,
  type Change,
} from "../flows/index.js"

/** How a review round ended. `feedback`: the person annotated the review; `edited` are the code paths they changed at the gate. */
export type ReviewOutcome =
  | { readonly verdict: "signoff" }
  | {
      readonly verdict: "feedback"
      /** The commit the round reviewed from. */
      readonly base: string
      /** The commit the reviewer's own review was written at. */
      readonly restoreFrom: string
      readonly edited: readonly Change[]
    }

/** Everything a review round runs or says, passed in: its file, steps and refusal. */
export interface ReviewPolicy {
  /** The review steering file: 🔍 widgets the reviewer writes, which the person ticks or annotates. */
  readonly file: string
  /** Whether a path is code, as opposed to steering state. */
  readonly isCode: (path: string) => boolean
  /** A steering step that writes `file` over everything since `base`. */
  readonly reviewing: (base: string) => Promise<void>
  /** The person's gate on `file`. */
  readonly awaitReview: (base: string) => Promise<void>
  /** Runs when the person signed off after editing code at the gate. */
  readonly keepGreen: () => Promise<void>
  /** Remove `file` at the end of a round at commit `round`. */
  readonly close: (round: string) => Promise<void>
  /** The refusal when the person deleted `file` at the gate. */
  readonly deleted: string
}

type Round = {
  readonly reviewed: string
  readonly annotated: boolean
  readonly edited: readonly Change[]
}

const reviewRound = async (base: string, p: ReviewPolicy): Promise<Round> => {
  await p.reviewing(base)
  const reviewed = head()
  await p.awaitReview(base)
  if (read(p.file) === undefined) refuse(p.deleted)
  return {
    reviewed,
    annotated: annotations(widgets(p.file)).length > 0,
    edited: changesSince(reviewed).filter((c) => p.isCode(c.path)),
  }
}

const signOff = async (p: ReviewPolicy, round: Round): Promise<void> => {
  if (round.edited.length > 0) await p.keepGreen()
  await p.close(head())
}

/**
 * A reviewer writes the review over everything since `base` and a person
 * reviews it: ticking every hunk signs off, an annotation is feedback for the
 * caller to act on.
 */
export const review = async (base: string, p: ReviewPolicy): Promise<ReviewOutcome> => {
  const round = await reviewRound(base, p)
  if (!round.annotated) {
    await signOff(p, round)
    return { verdict: "signoff" }
  }
  return { verdict: "feedback", base, restoreFrom: round.reviewed, edited: round.edited }
}

/** A review round whose feedback another workflow acts on. */
export interface HandOffPolicy extends ReviewPolicy {
  /** Keep `file` with the person's annotations for another workflow; `reviewed` holds the reviewer's own version. */
  readonly handOff: (reviewed: string) => Promise<void>
}

/** The same round as `review`: a sign-off closes, an annotation hands the review on through `handOff`. */
export const reviewToHandOff = async (base: string, p: HandOffPolicy): Promise<void> => {
  const round = await reviewRound(base, p)
  if (round.annotated) return p.handOff(round.reviewed)
  return signOff(p, round)
}
