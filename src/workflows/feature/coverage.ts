import {
  answered,
  type Change,
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
import {
  criteriaOf,
  criterionIds,
  requireCriteriaFrozen,
  sliceIds,
  type CriteriaSlice,
} from "./criteria.js"
import { isTestFile } from "./refactor.js"
import { isCode } from "../shared/review.js"

/** Below this the judge's `yes` is not trusted: a wrongly covered ID ends the feature without its test. */
const COVERED_MIN_P = 0.7

/** Covering turns before the process rests at `uncovered`; a human edit there refills them. */
const COVERING_RETRIES = 2

const frozen = (): void => requireCriteriaFrozen(REQUIREMENTS)

export const green = (guard?: () => void): Promise<void> =>
  healthy(
    () =>
      t.agentWithSkills("fix.suite.fixing", t.implementFixPrompt(), {
        label: "Fixing the check",
        file: FEEDBACK,
        model: coder(),
        system: t.builderSystem(),
      }),
    {
      guard: () => {
        frozen()
        guard?.()
      },
      guardRests: false,
    },
  )

const CONTEXT_LINES = 3

// A line the base never had counts as changed: no diff, but a fixture's untouched `[AC-1]` tag stays unchanged.
const changedLines = (c: Change, lines: readonly string[]): Set<number> => {
  const before = new Set(c.before?.split("\n"))
  return new Set(lines.flatMap((line, i) => (before.has(line) ? [] : [i])))
}

const windows = (changed: ReadonlySet<number>, last: number): [number, number][] => {
  const ranges: [number, number][] = []
  for (const n of changed) {
    const from = Math.max(0, n - CONTEXT_LINES)
    const to = Math.min(last, n + CONTEXT_LINES)
    const prev = ranges.at(-1)
    if (prev !== undefined && from <= prev[1] + 1) prev[1] = to
    else ranges.push([from, to])
  }
  return ranges
}

const naming = (ids: readonly string[]): ((line: string) => boolean) => {
  const pattern = new RegExp(`\\b(?:${ids.join("|")})(?!\\d)`)
  return (line) => ids.length > 0 && pattern.test(line)
}

interface Hunk {
  readonly rank: number
  readonly text: string
}

const hunksOf = (c: Change, names: (line: string) => boolean): Hunk[] => {
  if (c.after === undefined) return []
  const lines = c.after.split("\n")
  const changed = changedLines(c, lines)
  return windows(changed, lines.length - 1).map(([from, to]) => {
    const body = lines.slice(from, to + 1)
    // A changed test body keeps its name in view: the closest line above naming an ID.
    const above = body.some(names) ? -1 : lines.slice(0, from).findLastIndex(names)
    const heading = above < 0 ? "" : `@@ line ${above + 1}\n${lines[above]}\n`
    const rank = body.some((line, k) => changed.has(from + k) && names(line))
      ? 2
      : Number(above >= 0 || body.some(names))
    return {
      rank,
      text: `=== ${c.path} (${c.status})\n${heading}@@ line ${from + 1}\n${body.join("\n")}`,
    }
  })
}

/**
 * The changed test files' hunks, the ones naming one of `ids` on a changed
 * line last: a budget cut keeps the end, and a fixture's unchanged `[AC-1]`
 * tag must not crowd out the test this change added.
 */
export const testEvidence = (changed: readonly Change[], ids: readonly string[]): string => {
  const names = naming(ids)
  return changed
    .flatMap((c) => hunksOf(c, names))
    .map((h, i) => ({ ...h, i }))
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map((h) => h.text)
    .join("\n")
}

const testsSince = (base: string, ids: readonly string[]): string =>
  testEvidence(
    changesSince(base).filter((c) => isCode(c.path) && isTestFile(c.path)),
    ids,
  )

/**
 * The criterion IDs of `.gtd/REQUIREMENTS.md` — read afresh, never carried
 * over, only `slice`'s when given — no passing test since `base` covers, by the judge.
 */
const uncoveredSince = async (
  base: string,
  slice: CriteriaSlice | undefined,
): Promise<{ readonly covered: string[]; readonly uncovered: string[] }> => {
  const requirements = read(REQUIREMENTS) ?? ""
  const own = criterionIds(requirements, slice)
  const criteria = (criteriaOf(requirements) ?? []).filter((c) => own.includes(c.id))
  if (criteria.length === 0) return { covered: [], uncovered: [] }
  const { answers } = await judge("coverage", {
    questions: criteria.map(t.coverageQuestion),
    evidence: { tests: testsSince(base, own) },
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
export const requireCoverage = async (base = start(), slice?: CriteriaSlice): Promise<void> => {
  let retries = 0
  for (;;) {
    const { covered, uncovered } = await uncoveredSince(base, slice)
    if (uncovered.length === 0) return record(covered)
    if (retries < COVERING_RETRIES) {
      retries++
      await t.agentWithSkills("covering", t.coveringPrompt(uncovered, sliceIds(slice)), {
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
