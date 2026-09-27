import {
  answered,
  changes,
  glob,
  judge,
  numeric,
  read,
  refuse,
  removeScript,
  run,
  scope,
  sectionBodies,
  start,
  vars,
  wrote,
  type JudgeQuestion,
} from "../flows/index.js"
import { healthy } from "./health.js"
import { ARCHITECTURE, build, fixSpec, fixSuite, reviewPackage, SPEC_FEEDBACK } from "./steps.js"
import * as t from "./text.js"

const MAX_SECTIONS = 8

const sectionQuestion = (id: string, title: string): JudgeQuestion => ({
  id,
  primitive: "noul",
  instructions: `Is the requirement "${title}" already fully satisfied by the code on the range from ${start()} to the working tree?`,
  criteria:
    "Judge from the package markdown plus that range, read yourself. Only answer yes at a probability clearing the threshold below if genuinely confident nothing in this section is missing.",
})

/**
 * Review one freshly built package against its spec: a pre-judge per
 * section, then an agent review of the sections it did not confidently
 * clear. Resolves `true` when approved.
 */
export const specReview = async (pkg: string): Promise<boolean> => {
  const found = sectionBodies(read(pkg) ?? "")
  const titles = found.map((section) => section.title)
  const judged = titles.length > 0 && titles.length <= MAX_SECTIONS
  const evidence: Record<string, string> = {}
  const questions: JudgeQuestion[] = []
  if (judged) {
    found.forEach(({ title, body }, i) => {
      evidence[`section-${i + 1}`] = body
      questions.push(sectionQuestion(`section-${i + 1}`, title))
    })
  }
  const { answers, truncated } = await judge("spec.pre", {
    questions,
    evidence,
    message: t.packagesItemSpecPreMessage(),
    label: "Judging spec coverage",
  })
  // A section is cleared only by a confident yes on evidence that was not cut.
  const clearMinP = numeric(vars.specPreJudge, Infinity)
  const failing = titles.filter((_, i) => {
    const id = `section-${i + 1}`
    return !judged || truncated.includes(id) || !answered(answers[id], "yes", clearMinP)
  })
  if (titles.length > 0 && failing.length === 0) return true
  await reviewPackage(pkg, failing)
  if (wrote(SPEC_FEEDBACK)) return false
  if (changes(SPEC_FEEDBACK).length > 0 || changes().length === 0) return true
  return refuse(
    "gtd land: no declared pattern matches the pending changes — write .gtd/SPEC_FEEDBACK.md to request changes, or change nothing to approve",
  )
}

/** Build `pkg`, keep the suite green, review it against its spec, and close it out, which removes it. */
export const packageItem = async (pkg: string): Promise<void> => {
  await build(pkg)
  for (;;) {
    await healthy(fixSuite)
    if (await specReview(pkg)) break
    await fixSpec(pkg)
  }
  // The spent technical plan goes with the first package built from it.
  await run("closing", removeScript([pkg, SPEC_FEEDBACK, ".gtd/SATISFIED.md", ARCHITECTURE]), {
    label: "Closing out the package",
  })
}

/** The first queued package — the one a package step works on. */
export const nextPackage = (): string | undefined => [...glob(".gtd/packages/*.md")].sort()[0]

/** Build every package file under `.gtd/packages/`, in name order. */
export const packages = (): Promise<void> =>
  scope("packages", async () => {
    for (let pkg = nextPackage(); pkg !== undefined; pkg = nextPackage()) {
      await scope("item", () => packageItem(pkg))
    }
  })
