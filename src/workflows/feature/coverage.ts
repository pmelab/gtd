import {
  answered,
  changes,
  changesSince,
  human,
  judge,
  mark,
  read,
  start,
} from "../../flows/index.js"
import { healthy } from "../shared/health.js"
import { coder, FEEDBACK, REQUIREMENTS } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { criteriaOf, requireCriteriaFrozen } from "./criteria.js"
import { isTestFile } from "./refactor.js"
import { isCode } from "./review.js"

/** Below this the judge's `yes` is not trusted: a wrongly covered ID ends the feature without its test. */
const COVERED_MIN_P = 0.7

/** Covering turns before the process rests at `uncovered`; a human edit there refills them. */
const COVERING_RETRIES = 2

const frozen = (): void => requireCriteriaFrozen(REQUIREMENTS)

export const green = (): Promise<void> =>
  healthy(
    () =>
      t.agentWithSkills("fix.suite.fixing", t.implementFixPrompt(), {
        label: "Fixing the check",
        file: FEEDBACK,
        model: coder(),
        system: t.builderSystem(),
      }),
    { guard: frozen, guardRests: false },
  )

// A budget cut keeps the end, so the files naming a criterion ID go last.
const testsSince = (base: string): string =>
  changesSince(base)
    .filter((c) => c.after !== undefined && isCode(c.path) && isTestFile(c.path))
    .sort((a, b) => Number(/\bAC-\d/.test(a.after!)) - Number(/\bAC-\d/.test(b.after!)))
    .map((c) => `=== ${c.path} (${c.status})\n${c.after}`)
    .join("\n")

/**
 * The criterion IDs of `.gtd/REQUIREMENTS.md` — read afresh, never carried
 * over — no passing test since `base` covers, by the judge.
 */
const uncoveredSince = async (
  base: string,
): Promise<{ readonly covered: string[]; readonly uncovered: string[] }> => {
  const requirements = read(REQUIREMENTS) ?? ""
  const criteria = (criteriaOf(requirements) ?? []).filter((c) => c.id !== "")
  if (criteria.length === 0) return { covered: [], uncovered: [] }
  const { answers } = await judge("coverage", {
    questions: criteria.map(t.coverageQuestion),
    evidence: { tests: testsSince(base) },
    message: t.coverageMessage(),
    label: "Judging acceptance-criteria coverage",
  })
  // A budget cut keeps the evidence's end: a `no` may miss tests the judge never saw, a `yes` names one it did.
  const covers = (id: string): boolean => answered(answers[id], "yes", COVERED_MIN_P)
  const ids = criteria.map((c) => c.id)
  return { covered: ids.filter(covers), uncovered: ids.filter((id) => !covers(id)) }
}

const record = (covered: readonly string[], uncovered: readonly string[] = []): void => {
  for (const id of covered) mark("covers", id)
  for (const id of uncovered) mark("uncovered", id)
}

/**
 * Hold a green change until every acceptance criterion has a passing test,
 * sending uncovered IDs back to a covering turn; marks the IDs covered on the
 * landing that ends it. A human may overrule once the retries are spent.
 */
export const requireCoverage = async (base = start()): Promise<void> => {
  let retries = 0
  for (;;) {
    const { covered, uncovered } = await uncoveredSince(base)
    if (uncovered.length === 0) return record(covered)
    if (retries < COVERING_RETRIES) {
      retries++
      await t.agentWithSkills("covering", t.coveringPrompt(uncovered), {
        label: "Covering the acceptance criteria",
        model: coder(),
        system: t.builderSystem(),
        // The judge may have missed a test that exists: an empty turn asks it again.
        allowEmpty: true,
      })
      frozen()
    } else {
      await human("uncovered", {
        message: t.uncoveredMessage(uncovered),
        label: "Acceptance criteria without a test",
        file: REQUIREMENTS,
        acceptClean: true,
      })
      if (!changes().some((c) => isCode(c.path))) return record(covered, uncovered)
      frozen()
      retries = 0
    }
    await green()
  }
}
