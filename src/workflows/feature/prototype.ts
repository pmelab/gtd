import { changes, human, read, refuse, scope, vars } from "../../flows/index.js"
import { HEADING, markFenced } from "../shared/fences.js"
import { coder, PROTOTYPE, REQUIREMENTS } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults } from "../shared/vars.js"
import type { Guard } from "../shared/health.js"
import { green } from "./coverage.js"
import { criterionIds, requireCriteriaFrozen, sliceIds, type CriteriaSlice } from "./criteria.js"

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
}

const CHUNK = /^(AC-\d+|Problem\b.*?)\s*:\s*(pass|fail|blocked)$/i
const UNGUIDED = /^no testing instructions$/i

/** The `## ` chunks of a prototype report; a heading in neither shape is prose, not an item. */
export const reportOf = (text: string): Report => {
  let unguided = false
  const items: Item[] = []
  for (const { line, fenced } of markFenced(text)) {
    const heading = fenced ? null : HEADING.exec(line)
    if (heading?.[1] !== "##") continue
    if (UNGUIDED.test(heading[2]!)) unguided = true
    const chunk = CHUNK.exec(heading[2]!)
    if (chunk !== null)
      items.push({
        subject: /^ac-/i.test(chunk[1]!) ? chunk[1]!.toUpperCase() : chunk[1]!,
        verdict: chunk[2]!.toLowerCase() as Verdict,
      })
  }
  return { unguided, items }
}

/**
 * The report the testing turn left, refused unless it is the only change and
 * names every criterion once, with its open items: another slice's criteria
 * are not this slice's to fix.
 */
const requireReport = (
  slice: CriteriaSlice | undefined,
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
  if (report.unguided) return { unguided: true, open: [] }
  const ids = criterionIds(read(REQUIREMENTS) ?? "", slice)
  const count = (id: string): number => report.items.filter((i) => i.subject === id).length
  const wrong = ids.filter((id) => count(id) !== 1)
  if (wrong.length > 0)
    refuse(
      `gtd land: prototype-report: ${PROTOTYPE} needs exactly one chunk headed \`## <ID>: pass|fail|blocked\` for ${wrong.join(", ")}`,
    )
  const open = report.items.filter(
    (i) => i.verdict !== "pass" && (ids.includes(i.subject) || !i.subject.startsWith("AC-")),
  )
  return { unguided: false, open }
}

const frozen = (): void => requireCriteriaFrozen(REQUIREMENTS)

const testing = async (
  slice: CriteriaSlice | undefined,
  retest: boolean,
): Promise<ReturnType<typeof requireReport>> => {
  await t.agentWithSkills("testing", t.prototypeTestingPrompt(sliceIds(slice), retest), {
    label: retest ? "Re-testing the slice by hand" : "Testing the slice by hand",
    file: PROTOTYPE,
    model: coder(),
    system: t.testerSystem(),
    // A re-test that saw exactly what the last round saw leaves the report as it was.
    allowEmpty: retest,
  })
  return requireReport(slice)
}

const fixing = async (slice: CriteriaSlice | undefined, guard?: Guard): Promise<void> => {
  await scope("fix", () =>
    t.agentWithSkills("fixing", t.prototypeFixingPrompt(sliceIds(slice)), {
      label: "Fixing what the hands-on test found",
      file: PROTOTYPE,
      model: coder(),
      system: t.builderSystem(),
    }),
  )
  // The re-test may land empty: a report the fixer edited would pass untested.
  if (changes().some((c) => c.path === PROTOTYPE))
    refuse(`gtd land: prototype-fix: leave ${PROTOTYPE} as it is — the next round re-tests from it`)
  frozen()
  guard?.()
}

/** A person's rest; resolves `true` when they changed something to test again, `false` on a clean overrule. */
const askPerson = async (name: string, message: string, label: string): Promise<boolean> => {
  await human(name, { message, label, file: PROTOTYPE, acceptClean: true })
  if (changes().length === 0) return false
  frozen()
  return true
}

/**
 * Use the slice by hand: a testing turn reports on every criterion, a fix turn
 * takes each failure, and the slice is tested again — until the report is
 * clean, or `prototypeRounds` fixes are spent and a person decides. `guard`
 * holds every fix turn, as it holds the implementation's.
 */
export const prototypeTest = async (
  slice: CriteriaSlice | undefined,
  guard?: Guard,
): Promise<void> => {
  const cap = prototypeRounds()
  if (cap === 0) return
  await scope("prototype", async () => {
    let fixes = 0
    let retest = false
    for (;;) {
      const { unguided, open } = await testing(slice, retest)
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
        await fixing(slice, guard)
      } else {
        const changed = await askPerson(
          "open",
          t.prototypeOpenMessage(open, fixes),
          "Hands-on test still failing",
        )
        if (!changed) return
        fixes = 0
      }
      await green(guard)
    }
  })
}
