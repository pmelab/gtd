import { answered, changes, human, judge, read, refuse, scope, vars } from "../../flows/index.js"
import { HEADING, markFenced } from "../shared/fences.js"
import { coder, PROTOTYPE, REQUIREMENTS } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults } from "../shared/vars.js"
import { green } from "./green.js"
import { criteriaOf, criterionIds, handsOnIds, requireCriteriaFrozen } from "./criteria.js"

/** Only a `no` at this or above skips a criterion: no verdict, or an unsure one, sends it to the hands-on test. */
const UNOBSERVABLE_MIN_P = 0.5

/** The `prototypeRounds` setting. Anything but a non-negative integer fails rather than guess a cap. */
export const prototypeRounds = (): number => {
  const value = vars.prototypeRounds ?? defaults.prototypeRounds!
  if (!/^(0|[1-9]\d*)$/.test(value))
    refuse(`gtd: prototypeRounds must be a non-negative integer, got ${JSON.stringify(value)}`)
  return Number(value)
}

export type Verdict = "pass" | "fail" | "blocked"

export interface Item {
  /** A criterion ID, or `Problem <title>`. */
  readonly subject: string
  readonly verdict: Verdict
}

export interface Report {
  readonly unguided: boolean
  readonly items: readonly Item[]
  /** Headings that read as an item but miss the shape: a failure there would go unseen. */
  readonly malformed: readonly string[]
}

const CHUNK = /^(AC-\d+|Problem\b.*?)\s*:\s*(pass|fail|blocked)$/i
const UNGUIDED = /^no testing instructions$/i

/** The `## ` chunks of a prototype report; a heading in neither shape is prose, not an item. */
export const reportOf = (text: string): Report => {
  let unguided = false
  const items: Item[] = []
  const malformed: string[] = []
  for (const { line, fenced } of markFenced(text)) {
    const heading = fenced ? null : HEADING.exec(line)
    if (heading?.[1] !== "##") continue
    if (UNGUIDED.test(heading[2]!)) unguided = true
    const chunk = CHUNK.exec(heading[2]!)
    if (chunk === null && /^(ac-\d|problem)/i.test(heading[2]!)) malformed.push(heading[2]!)
    if (chunk !== null)
      items.push({
        subject: /^ac-/i.test(chunk[1]!) ? chunk[1]!.toUpperCase() : chunk[1]!,
        verdict: chunk[2]!.toLowerCase() as Verdict,
      })
  }
  return { unguided, items, malformed }
}

/**
 * The report the testing turn left, refused unless it is the only change and
 * names each of `ids` once, with its open items: any other criterion is not
 * this test's to fix.
 */
const requireReport = (
  ids: readonly string[],
  retest: boolean,
): { readonly unguided: boolean; readonly open: readonly Item[] } => {
  const others = changes()
    .map((c) => c.path)
    .filter((path) => path !== PROTOTYPE)
  if (others.length > 0)
    refuse(
      `gtd land: prototype-report: test in a disposable place and change nothing but ${PROTOTYPE} — revert these:\n${others.map((path) => `  - ${path}`).join("\n")}`,
    )
  const text = read(PROTOTYPE)
  if (text === undefined) return refuse(`gtd land: prototype-report: write ${PROTOTYPE}`)
  const report = reportOf(text)
  if (report.malformed.length > 0)
    refuse(
      `gtd land: prototype-report: head each chunk \`## <ID>: pass|fail|blocked\` or \`## Problem <title>: pass|fail|blocked\` — these miss it:\n${report.malformed.map((h) => `  - ${h}`).join("\n")}`,
    )
  // Only a first test with nothing else in it: a chunk beside it was tested after all, and a
  // re-test's open items must reach a person, not slip past as untested.
  if (report.unguided && report.items.length === 0 && !retest) return { unguided: true, open: [] }
  const elsewhere = criterionIds(read(REQUIREMENTS) ?? "").filter((id) => !ids.includes(id))
  const count = (id: string): number => report.items.filter((i) => i.subject === id).length
  const wrong = ids.filter((id) => count(id) !== 1)
  if (wrong.length > 0)
    refuse(
      `gtd land: prototype-report: ${PROTOTYPE} needs exactly one chunk headed \`## <ID>: pass|fail|blocked\` for ${wrong.join(", ")}`,
    )
  // A mistyped ID stays open: only a known criterion outside `ids` is not this test's to fix.
  const open = report.items.filter((i) => i.verdict !== "pass" && !elsewhere.includes(i.subject))
  return { unguided: false, open }
}

/**
 * The criteria a person can observe by using the change, by the judge: those
 * tagged `(no hands-on)` are never asked about.
 */
const observable = async (): Promise<string[]> => {
  const requirements = read(REQUIREMENTS) ?? ""
  const own = handsOnIds(requirements)
  const criteria = (criteriaOf(requirements) ?? []).filter((c) => own.includes(c.id))
  if (criteria.length === 0) return []
  const { answers } = await judge("observable", {
    questions: criteria.map(t.observableQuestion),
    evidence: { requirements },
    message: t.observableMessage(),
    label: "Judging which criteria to test by hand",
  })
  return own.filter((id) => !answered(answers[id], "no", UNOBSERVABLE_MIN_P))
}

const frozen = (): void => requireCriteriaFrozen(REQUIREMENTS)

const testing = async (
  ids: readonly string[],
  retest: boolean,
): Promise<ReturnType<typeof requireReport>> => {
  const skipped = criterionIds(read(REQUIREMENTS) ?? "").filter((id) => !ids.includes(id))
  await t.agentWithSkills("testing", t.prototypeTestingPrompt(skipped, retest), {
    label: retest ? "Re-testing the change by hand" : "Testing the change by hand",
    file: PROTOTYPE,
    model: coder(),
    system: t.testerSystem(),
    // A test that saw exactly what the last round saw leaves the report as it was.
    allowEmpty: true,
  })
  return requireReport(ids, retest)
}

const fixing = async (): Promise<void> => {
  await scope("fix", () =>
    t.agentWithSkills("fixing", t.prototypeFixingPrompt(), {
      label: "Fixing what the hands-on test found",
      file: PROTOTYPE,
      model: coder(),
      system: t.builderSystem(),
      // A `fail` the tester got wrong has nothing to fix: the re-test says so, or the cap ends it.
      allowEmpty: true,
    }),
  )
  // The re-test may land empty: a report the fixer edited would pass untested.
  if (changes().some((c) => c.path === PROTOTYPE))
    refuse(`gtd land: prototype-fix: leave ${PROTOTYPE} as it is — the next round re-tests from it`)
  frozen()
}

/** A person's rest; resolves `true` when they changed something to test again, `false` on a clean overrule. */
const askPerson = async (name: string, message: string, label: string): Promise<boolean> => {
  await human(name, { message, label, file: PROTOTYPE, acceptClean: true })
  // A note in the report alone tests nothing new.
  if (!changes().some((c) => c.path !== PROTOTYPE)) return false
  frozen()
  return true
}

/**
 * Use the change by hand: a testing turn reports on every criterion a person
 * can observe, a fix turn takes each failure, and the change is tested again —
 * until the report is clean, or `prototypeRounds` fixes are spent and a person
 * decides. A change with no such criterion is not tested by hand.
 */
export const prototypeTest = async (): Promise<void> => {
  const cap = prototypeRounds()
  if (cap === 0) return
  await scope("prototype", async () => {
    const ids = await observable()
    if (ids.length === 0) return
    let fixes = 0
    let retest = false
    for (;;) {
      const { unguided, open } = await testing(ids, retest)
      retest = !unguided
      if (unguided) {
        const instructed = await askPerson(
          "unguided",
          t.prototypeUnguidedMessage(),
          "No way to test by hand",
        )
        if (!instructed) return
      } else if (open.length === 0) return
      else if (fixes < cap && open.some((i) => i.verdict === "fail")) {
        fixes++
        await fixing()
      } else {
        const changed = await askPerson(
          "open",
          t.prototypeOpenMessage(open, fixes),
          "Hands-on test still failing",
        )
        if (!changed) return
        fixes = 0
      }
      await green()
    }
  })
}
