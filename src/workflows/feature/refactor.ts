import {
  changes,
  changesSince,
  head,
  quote,
  read,
  refuse,
  removeScript,
  run,
  scope,
  vars,
  type DiffShapeResult,
} from "../../flows/index.js"
import { healthy } from "../shared/health.js"
import { coder, FEEDBACK } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults } from "../shared/vars.js"

export const REFACTOR_PACKAGE = ".gtd/REFACTOR.md"

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
  "- Change only the paths above; a test file only when it is one of them",
  `- Introduce no flag read and add no second read of an existing one (\`${pattern}\`)`,
  "",
  "## Reference",
  "",
  reference === undefined
    ? "None."
    : `Reading material only, never applied: \`git show ${reference} -- ${strays.map(quote).join(" ")}\``,
  "",
]

const deriveScript = (lines: readonly string[]): string =>
  `mkdir -p .gtd
printf '%s\\n' ${lines.map(quote).join(" ")} > ${quote(REFACTOR_PACKAGE)}
`

export const refactorFirst = async (
  shape: DiffShapeResult,
  options: RefactorOptions = {},
): Promise<boolean> => {
  if (shape.choice !== "refactor-first" || shape.unreadable.length > 0) return false
  const pattern = vars.refactorFlagPattern ?? defaults.refactorFlagPattern!
  const expression = flagExpression(pattern)
  const { strays } = shape
  const zeroLength = strays.filter((path) => countFlags(read(path) ?? "", expression, new Map()))
  if (zeroLength.length > 0)
    throw new Error(
      `gtd: refactorFlagPattern (${pattern}) produces a zero-length match in:\n${listPaths(zeroLength)}`,
    )
  const reference = options.reference?.trim() ? options.reference : undefined
  return scope({ name: "refactor", access: { write: [...strays, ".gtd/**"] } }, async () => {
    await run("deriving", deriveScript(packageLines(strays, pattern, reference)), {
      label: "Deriving the refactor package",
      file: REFACTOR_PACKAGE,
    })
    const from = head()
    // The in-memory `strays`, never the package file: a hand edit of its list changes nothing.
    // Scope looks at the turn's own changes: a person's edit at an escalation rest must not
    // wedge every later fix turn. Flags look at the whole range.
    const guard = (): void => {
      requireWithin(strays)
      requireNoNewFlags(pattern, from)
    }
    await t.agentWithSkills(
      "building",
      t.refactorBuildingPrompt(REFACTOR_PACKAGE, strays, pattern, reference),
      { label: "Refactoring", model: coder(), system: t.builderSystem() },
    )
    guard()
    await healthy(async () => {
      await t.agentWithSkills("fix.suite.fixing", t.refactorFixPrompt(strays, pattern), {
        label: "Fixing the check",
        file: FEEDBACK,
        model: coder(),
        system: t.builderSystem(),
      })
      guard()
    })
    await run("closing", removeScript([REFACTOR_PACKAGE]), { label: "Closing out the refactor" })
    return true
  })
}
