import {
  changes,
  changesSince,
  head,
  matches,
  quote,
  read,
  refuse,
  removeScript,
  run,
  scope,
  vars,
  type DiffShapeResult,
} from "../../flows/index.js"
import { lensesOf } from "../../workflow-kit/index.js"
import { markFenced } from "../shared/fences.js"
import { healthy, type Guard } from "../shared/health.js"
import { coder, FEEDBACK, REFACTOR } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults, testFileGlobs } from "../shared/vars.js"
import { buildTail, reUnwind, type FeedbackTarget } from "./review.js"
import { refactorCollecting } from "./steps.js"

export const REFACTOR_PACKAGE = REFACTOR

export interface RefactorOptions {
  /** Blank counts as absent: `kept()` reports `""` while the keeping turn is pending. */
  readonly reference?: string | undefined
}

const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

export const requireWithin = (allowed: readonly string[]): void => {
  const outside = changes()
    .map((c) => c.path)
    .filter((path) => isCode(path) && !allowed.includes(path))
  if (outside.length === 0) return
  refuse(
    `gtd land: refactor-scope: the refactor may change only its stray paths — revert these:\n${outside.map((path) => `  - ${path}`).join("\n")}`,
  )
}

// A fixed list, not `seamAllow`: narrowing that setting must not let a test file through.
export const isTestFile = (path: string): boolean =>
  testFileGlobs.some((glob) => matches(path, glob))

export const requireNoTestFiles = (): void => {
  const tests = changes()
    .map((c) => c.path)
    .filter((path) => isCode(path) && isTestFile(path))
  if (tests.length === 0) return
  refuse(
    `gtd land: refactor-tests: the refactor may not change a test file — revert these:\n${tests.map((path) => `  - ${path}`).join("\n")}`,
  )
}

const flagExpression = (pattern: string): RegExp => {
  if (pattern.trim() === "") throw new Error("gtd: refactorFlagPattern must not be blank")
  let expression: RegExp
  try {
    expression = new RegExp(pattern, "g")
  } catch (error) {
    throw new Error(`gtd: refactorFlagPattern is not a valid regular expression: ${String(error)}`)
  }
  // An empty match would count the name "" at every character.
  if (expression.test(""))
    throw new Error("gtd: refactorFlagPattern must not match the empty string")
  return expression
}

// A zero-length match is never counted: a lookahead-only pattern would count every read
// under "" and let a flag swap pass. Checked on the strays up front and again at landing.
const countFlags = (text: string, expression: RegExp, into: Map<string, number>): boolean => {
  let zeroLength = false
  for (const [name] of text.matchAll(expression)) {
    if (name === "") zeroLength = true
    else into.set(name, (into.get(name) ?? 0) + 1)
  }
  return zeroLength
}

const listPaths = (paths: readonly string[]): string =>
  paths.map((path) => `  - ${path}`).join("\n")

// Counts per name, so a read moved between files passes.
export const requireNoNewFlags = (pattern: string, since: string): void => {
  const expression = flagExpression(pattern)
  const before = new Map<string, number>()
  const after = new Map<string, number>()
  const unreadable: string[] = []
  const zeroLength: string[] = []
  for (const { path, status, before: was, after: now } of changesSince(since)) {
    if (!isCode(path)) continue
    // A side absent by status is empty; one absent otherwise could not be read.
    const oldSide = status === "added" ? "" : was
    const newSide = status === "deleted" ? "" : now
    if (oldSide === undefined || newSide === undefined) {
      unreadable.push(path)
      continue
    }
    countFlags(oldSide, expression, before)
    if (countFlags(newSide, expression, after)) zeroLength.push(path)
  }
  if (unreadable.length > 0)
    refuse(`gtd land: refactor-flags: cannot compare flag reads in:\n${listPaths(unreadable)}`)
  if (zeroLength.length > 0)
    refuse(
      `gtd land: refactor-flags: refactorFlagPattern (${pattern}) produced a zero-length match in:\n${listPaths(zeroLength)}`,
    )
  const raised = [...after].filter(([name, count]) => count > (before.get(name) ?? 0))
  if (raised.length === 0) return
  refuse(
    `gtd land: refactor-flags: the refactor may not introduce or add reads of a flag (${pattern}):\n${raised.map(([name, count]) => `  - ${name}: ${before.get(name) ?? 0} → ${count}`).join("\n")}`,
  )
}

/** A test-file stray is never refactored: the implement turn still reads it in the naive tip. */
export const refactorStrays = (shape: DiffShapeResult): readonly string[] =>
  shape.strays.filter((path) => !isTestFile(path))

const packageLines = (
  strays: readonly string[],
  pattern: string,
  reference: string | undefined,
): string[] => [
  "# Behaviour-neutral refactor",
  "",
  "## Scope (read-only)",
  "",
  ...strays.map((path) => `- \`${path}\``),
  "",
  "This list is fixed when the package is derived: editing it here widens or narrows nothing.",
  "",
  "## Rules",
  "",
  "- The suite's outcome must not change",
  "- Change only the paths above, and never a test file",
  `- Introduce no flag read and add no second read of an existing one (\`${pattern}\`)`,
  "",
  "## Reference",
  "",
  reference === undefined
    ? "None."
    : `Reading material only, never applied: \`git show ${reference} -- ${strays.map(quote).join(" ")}\``,
  "",
]

// Nested under `## Review feedback`, so every heading of the collected text drops a level.
const demoteHeadings = (text: string): string[] => {
  const marked = markFenced(text.trimEnd())
  const lines = marked.map((m) => m.line)
  const headings = marked.map((m) =>
    m.fenced ? undefined : /^(#{1,6}) /.exec(m.line)?.[1]?.length,
  )
  const shallowest = Math.min(...headings.filter((n): n is number => n !== undefined))
  // Collected headings nest under `## Review feedback`, so the shallowest lands at `###`.
  const shift = 3 - shallowest
  return lines.map((line, i) => {
    const depth = headings[i]
    if (depth === undefined) return line
    // Markdown has no heading past `######`.
    return "#".repeat(Math.min(6, depth + shift)) + line.slice(depth)
  })
}

const deriveScript = (lines: readonly string[]): string =>
  `mkdir -p .gtd
printf '%s\\n' ${lines.map(quote).join(" ")} > ${quote(REFACTOR_PACKAGE)}
`

interface Plan {
  readonly pattern: string
  readonly strays: readonly string[]
  readonly reference: string | undefined
}

/** Undefined for every shape that is not a readable `refactor-first`; throws on a bad flag pattern. */
const plan = (shape: DiffShapeResult, options: RefactorOptions): Plan | undefined => {
  if (shape.choice !== "refactor-first" || shape.unreadable.length > 0) return undefined
  const pattern = vars.refactorFlagPattern ?? defaults.refactorFlagPattern!
  const expression = flagExpression(pattern)
  const strays = refactorStrays(shape)
  if (strays.length === 0) return undefined
  const zeroLength = strays.filter((path) => countFlags(read(path) ?? "", expression, new Map()))
  if (zeroLength.length > 0)
    throw new Error(
      `gtd: refactorFlagPattern (${pattern}) produces a zero-length match in:\n${listPaths(zeroLength)}`,
    )
  const reference = options.reference?.trim() ? options.reference : undefined
  return { pattern, strays, reference }
}

// The in-memory `strays`, never the package file: a hand edit of its list changes nothing.
// Scope and tests look at the turn's own changes: a person's edit at an escalation rest must
// not wedge every later fix turn. Flags look at the whole range since `entry`.
const guardOf =
  ({ pattern, strays }: Plan, entry: string): Guard =>
  () => {
    // Tests first: a test file is never a stray here, so the scope refusal would mask it.
    requireNoTestFiles()
    requireWithin(strays)
    requireNoNewFlags(pattern, entry)
  }

/** Derive, build, check and close one refactor lap; `feedback` is the collected review text of the lap before. */
const refactorLap = async (p: Plan, guard: Guard, feedback?: string): Promise<void> => {
  const { pattern, strays, reference } = p
  await run(
    "deriving",
    deriveScript([
      ...packageLines(strays, pattern, reference),
      ...(feedback === undefined
        ? []
        : ["## Review feedback", "", ...demoteHeadings(feedback), ""]),
    ]),
    { label: "Deriving the refactor package", file: REFACTOR_PACKAGE },
  )
  await t.agentWithSkills(
    "building",
    t.refactorBuildingPrompt(REFACTOR_PACKAGE, strays, pattern, reference, feedback !== undefined),
    { label: "Refactoring", model: coder(), system: t.builderSystem() },
  )
  guard()
  await healthy(
    async () => {
      await t.agentWithSkills("fix.suite.fixing", t.refactorFixPrompt(strays, pattern), {
        label: "Fixing the check",
        file: FEEDBACK,
        model: coder(),
        system: t.builderSystem(),
      })
      guard()
    },
    { describeGuard: guard, rules: t.refactorRules(strays, pattern) },
  )
  await run("closing", removeScript([REFACTOR_PACKAGE]), { label: "Closing out the refactor" })
}

const strayAccess = (strays: readonly string[]) => ({ write: [...strays, ".gtd/**"] })

export const refactorFirst = async (
  shape: DiffShapeResult,
  options: RefactorOptions = {},
): Promise<boolean> => {
  const p = plan(shape, options)
  if (p === undefined) return false
  return scope({ name: "refactor", access: strayAccess(p.strays) }, async () => {
    await refactorLap(p, guardOf(p, head()))
    return true
  })
}

/**
 * `refactorFirst` plus its review, in the one `refactor` scope so the tail's
 * steps are `refactor.build.*`. A review edit re-runs the refactor, never a
 * re-plan: the collected notes ride the re-derived package. Every round
 * reviews the whole refactor since `entry`, since each lap rebuilds over it.
 */
export const reviewedRefactor = async (
  shape: DiffShapeResult,
  options: RefactorOptions = {},
): Promise<boolean> => {
  const p = plan(shape, options)
  if (p === undefined) return false
  return scope({ name: "refactor", access: strayAccess(p.strays) }, async () => {
    const entry = head()
    const guard = guardOf(p, entry)
    const feedback: FeedbackTarget = {
      file: REFACTOR_PACKAGE,
      collecting: (capture, round) => refactorCollecting(capture, round, p.strays),
      unmatched:
        "gtd land: refactor-feedback: the review feedback changed files but wrote no .gtd/REFACTOR.md — a refactor cannot act on it; revert the change, or `gtd abandon` and restart",
      dropped: t.refactorDroppedRefusal,
    }
    let collected: string | undefined
    for (;;) {
      await refactorLap(p, guard, collected)
      // A person's edit at an escalation rest is never refused, as in the lap.
      const outcome = await buildTail(false, entry, true, {
        guard,
        guardRests: false,
        lenses: lensesOf(vars.refactorQualityReviews ?? ""),
        feedback,
        fixAccess: strayAccess(p.strays),
        lensBase: entry,
        rules: t.refactorRules(p.strays, p.pattern),
        lap: "refactor",
      })
      if (outcome.verdict === "signoff") return true
      await reUnwind(outcome)
      // The kit returns `feedback` only once the collecting turn wrote the package.
      collected = read(REFACTOR_PACKAGE)
      if (collected === undefined)
        throw new Error(`gtd: review feedback left no ${REFACTOR_PACKAGE}`)
    }
  })
}
