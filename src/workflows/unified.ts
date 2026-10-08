import {
  changes,
  head,
  human,
  refuse,
  requireRevert,
  restoreScript,
  revertScript,
  run,
  start,
  type EntryBase,
  type FlowArgs,
  type Summary,
} from "../flows/index.js"
import { baseline, gate } from "./health.js"
import { packages } from "./packages.js"
import { architecturePass, design } from "./planning.js"
import { buildTail, type ReviewOutcome } from "./review.js"
import { ARCHITECTURE, FEEDBACK, REQUIREMENTS, REVIEW } from "./steps.js"
import * as t from "./text.js"

// gtd's built-in default workflow. Any change to the tree starts a process:
// `idle` → `unwind` reverts the sketch (its intent survives in history) → a
// green-baseline gate → design, architecture and one package per concern →
// the quality lap → human review, which signs off (the episode ends back at
// `idle`) or sends a full re-plan lap. `--entry fix-precheck`, `--entry
// review-gate.check --var reviewBase=<commitish>` and `--entry
// start-gate.check` enter the same flow further in.
//
// Every part is exported for other workflows to compose; see the modules
// re-exported below.

export { threads, type ThreadInfo } from "../flows/index.js"
export { defaults, envDefaults } from "./vars.js"
export { skills } from "./skills.js"
export { access } from "./access.js"
export { agentWithSkills } from "./text.js"
export * from "./steps.js"
export * from "./health.js"
export * from "./planning.js"
export * from "./packages.js"
export * from "./review.js"

/** Revert the sketch that started the process out of the working tree; its intent survives in history. */
export const unwind = (): Promise<void> => {
  const commit = head()
  return run("unwind", revertScript(commit, FEEDBACK, t.unwindFailure(commit)), {
    label: "Unwinding your input",
  })
}

/**
 * Undo the human's review-round code edits. A path changed since the human
 * left it is not overwritten; requireRevert names it instead.
 */
export const reUnwind = async (
  feedback: Extract<ReviewOutcome, { verdict: "feedback" }>,
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

/** Plan, build and review until a review round signs off; feedback re-plans from scratch. */
export const planAndBuild = async (firstBase: string): Promise<void> => {
  let base = firstBase
  for (;;) {
    await design(base)
    await architecturePass()
    await packages()
    const outcome = await buildTail(false, base)
    if (outcome.verdict === "signoff") return
    await reUnwind(outcome)
    base = outcome.base
  }
}

/** After a tail that skipped planning: stop on sign-off, re-plan on feedback. */
export const afterTail = async (outcome: ReviewOutcome): Promise<void> => {
  if (outcome.verdict === "signoff") return
  await reUnwind(outcome)
  await planAndBuild(outcome.base)
}

/** An ordinary start: wait at `idle`, unwind the sketch, check the baseline, then plan and build. */
export const ordinaryStart = async (): Promise<void> => {
  await human("idle", { message: t.idleMessage(), label: "Idle", file: ".gtd/TODO.md" })
  await unwind()
  if (changes(FEEDBACK).some((c) => c.status !== "deleted")) {
    await human("unwind-failed", {
      message: t.unwindFailedMessage(),
      label: "Could not unwind your input",
      file: FEEDBACK,
    })
  }
  await gate("start-gate", t.startGateBlockedMessage())
  await planAndBuild(start())
}

const ENTRIES = ["fix-precheck", "review-gate.check", "start-gate.check"]

export default async function unified({ entry }: FlowArgs): Promise<void> {
  if (entry === undefined) return ordinaryStart()
  if (entry === "fix-precheck") {
    if (await baseline("fix-precheck")) return
    return afterTail(await buildTail(true, start()))
  }
  if (entry === "review-gate.check") {
    await gate("review-gate", t.reviewGateBlockedMessage())
    return afterTail(await buildTail(false, start()))
  }
  if (entry === "start-gate.check") {
    await gate("start-gate", t.startGateBlockedMessage())
    return planAndBuild(start())
  }
  refuse(
    `"${entry}" is not an enterable state — enterable states:\n${ENTRIES.map((name) => `  ${name}`).join("\n")}`,
  )
}

export const summary: Summary = t.summaryPrompt

export const steering = { [REQUIREMENTS]: "qa", [ARCHITECTURE]: "qa", [REVIEW]: "review" }

export const base: EntryBase = (entry, vars) =>
  entry === "review-gate.check" ? (vars.reviewBase ?? "") : undefined
