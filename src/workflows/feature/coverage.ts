import { answered, changes, changesSince, human, judge, mark, read } from "../../flows/index.js"
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

/** The implementation's health loop: fix turns until the suite is green, criteria untouched. */
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

/** The test files changed since `base`, as the judge reads them. */
const testsSince = (base: string): string =>
  changesSince(base)
    .filter((c) => c.after !== undefined && isCode(c.path) && isTestFile(c.path))
    .map((c) => `=== ${c.path} (${c.status})\n${c.after}`)
    .join("\n")

/**
 * The criterion IDs of `.gtd/REQUIREMENTS.md` — read afresh, never carried
 * over — no passing test since `base` covers, by the judge. Truncated evidence
 * covers nothing.
 */
const uncoveredSince = async (
  base: string,
): Promise<{ readonly covered: string[]; readonly uncovered: string[] }> => {
  const requirements = read(REQUIREMENTS) ?? ""
  const criteria = (criteriaOf(requirements) ?? []).filter((c) => c.id !== "")
  const { answers, truncated } = await judge("coverage", {
    questions: criteria.map(t.coverageQuestion),
    evidence: { requirements, tests: testsSince(base) },
    message: t.coverageMessage(),
    label: "Judging acceptance-criteria coverage",
  })
  const covers = (id: string): boolean =>
    truncated.length === 0 && answered(answers[id], "yes", COVERED_MIN_P)
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
export const requireCoverage = async (base: string): Promise<void> => {
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
      })
      frozen()
    } else {
      await human("uncovered", {
        message: t.uncoveredMessage(uncovered),
        label: "Acceptance criteria without a test",
        acceptClean: true,
      })
      if (changes().length === 0) return record(covered, uncovered)
      frozen()
      retries = 0
    }
    await green()
  }
}
