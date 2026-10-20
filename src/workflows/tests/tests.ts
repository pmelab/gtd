import {
  changes,
  glob,
  read,
  refuse,
  removeScript,
  run,
  scope,
  sectionBodies,
  start,
  vars,
} from "../../flows/index.js"
import { gate, healthy } from "../shared/health.js"
import type { LensReport } from "../shared/lenses.js"
import { testsShipped } from "../shared/options.js"
import { fixFeedback, humanReview, isCode, reUnwind } from "../shared/review.js"
import { coder, fixCheck, REQUIREMENTS } from "../shared/steps.js"
import { refusePendingHandOff, tail } from "../shared/tail.js"
import * as t from "../shared/text.js"
import { testsDefaults } from "../shared/vars.js"

const TESTS = ".gtd/TESTS.md"
const RETIRE = ".gtd/RETIRE.md"

/** The first two answer boxes of a deletion proposal; the third stays the human's own answer. */
const RETIRE_ANSWERS: readonly [string, string] = ["delete it", "keep it skipped"]

export const DEFAULT_SKIP_PATTERN = testsDefaults.skipPattern!

interface Skip {
  readonly path: string
  /** 1-based. */
  readonly line: number
  readonly text: string
}

/** `skipPattern` as a per-line expression; refuses one that is blank, invalid, or matches every line. */
const skipExpression = (pattern: string): RegExp => {
  if (pattern.trim() === "") return refuse("gtd: skipPattern must not be blank")
  let expression: RegExp
  try {
    expression = new RegExp(pattern)
  } catch (error) {
    return refuse(`gtd: skipPattern is not a valid regular expression: ${String(error)}`)
  }
  if (expression.test("")) return refuse("gtd: skipPattern must not match the empty string")
  return expression
}

/** Every line of `files` the expression calls skipped, in file then line order. */
export const skipsIn = (
  files: readonly { readonly path: string; readonly text: string }[],
  expression: RegExp,
): readonly Skip[] =>
  files.flatMap(({ path, text }) =>
    text
      .split("\n")
      .flatMap((line, i) =>
        expression.test(line) ? [{ path, line: i + 1, text: line.trim() }] : [],
      ),
  )

const testPaths = (): readonly string[] => {
  const globs = (vars.testFiles ?? testsDefaults.testFiles!)
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g !== "")
  return [...new Set(globs.flatMap((g) => glob(g)))].filter(isCode).sort()
}

const scan = (paths: readonly string[], expression: RegExp): readonly Skip[] =>
  skipsIn(
    paths.map((path) => ({ path, text: read(path) ?? "" })),
    expression,
  )

/** A section title as a repository path: backticks and a leading `./` dropped. */
const pathOf = (title: string): string => title.replace(/`/g, "").trim().replace(/^\.\//, "")

const below = (section: string): string => section.split("\n").slice(1).join("\n").trim()

const sweepingPrompt = (skips: readonly Skip[]): string =>
  `Sweep this repository's tests for ones to revive.

Skipped tests gtd found:

${skips.length === 0 ? "- none" : skips.map((s) => `- ${s.path}:${s.line} — ${s.text}`).join("\n")}

- Audit every test in the repository with the test-audit skill — the whole
  suite, not a recent change
- Write \`${TESTS}\`: \`# Tests\`, then one \`## <path>\` section per test file
  that needs work — every file listed above, and each file the audit found
  worth rewriting — saying which tests are skipped and what the audit found
- Change nothing else; write nothing when there is nothing to do
- Leave everything uncommitted and finish your turn`

const rewritingPrompt = (path: string, found: string): string =>
  `Rewrite the tests in \`${path}\` until none is skipped and the suite is green.

What the sweep found:

${found || "_Nothing more than the skipped tests._"}

- Unskip every skipped test in the file and make it pass, rewriting it where
  it rotted, and fix what the audit found
- A test that is obsolete — what it tests is gone, or another test already
  covers it — stays skipped: never delete it. Propose its deletion in
  \`${RETIRE}\` instead: a \`## <title>\` section naming \`${path}\`, the test,
  and why it should go. A person decides
- Delete no test file
- Leave everything uncommitted and finish your turn`

const gateMessage = (): string =>
  `The test baseline is red — gtd will not revive skipped tests on a broken suite.
\`.gtd/FEEDBACK.md\` holds the failing output.

What each change does next (then run \`gtd land\`):
- **Retry check** — edit the code and/or \`.gtd/FEEDBACK.md\` to fix the failing tests (**tests-gate.check**).
`

const awaitMessage = (base: string): string =>
  `\`.gtd/REVIEW.md\` holds one chunk per test the sweep would delete. Each ends in
three boxes — tick exactly one: \`delete it\` (the test is deleted, then the
suite runs), \`keep it skipped\` (dropped, recorded in the commit), or write your
own answer over \`_your answer_\` and tick it (judged like a note). Every
landing here is refused until each proposal holds exactly one tick. gtd never
deletes a test you did not tick.

Review the revived tests yourself:

    git diff ${base}

Then run \`gtd land\`. A note or code edit of your own is read as feedback and
built before you review again.
`

/** A proposal's own text, made a request the nit fixer acts on once the human ticks `delete it`. */
const proposals = (text: string): LensReport["notes"] =>
  sectionBodies(text).map((s, i) => ({
    id: `R${i + 1}`,
    title: s.title,
    body: `Delete this skipped test.\n\n${below(s.body)}`,
    answers: RETIRE_ANSWERS,
  }))

/** Refuses a test file a turn deleted, and a skip left in `revised` that `.gtd/RETIRE.md` does not name. */
const guardFor =
  (known: ReadonlySet<string>, revised: ReadonlySet<string>, expression: RegExp) => (): void => {
    const deleted = changes()
      .filter((c) => c.status === "deleted" && known.has(c.path))
      .map((c) => c.path)
    if (deleted.length > 0)
      refuse(
        `gtd land: tests: ${deleted.join(", ")} deleted — a test goes only once a person ticks "delete it" at the review`,
      )
    const retire = read(RETIRE) ?? ""
    const left = scan([...revised], expression).filter((s) => !retire.includes(s.path))
    if (left.length > 0)
      refuse(
        `gtd land: tests: ${left.map((s) => `${s.path}:${s.line}`).join(", ")} still skipped — revive it, or propose its deletion in ${RETIRE}`,
      )
  }

/**
 * Revive or retire skipped tests: a sweep plans one package per test file, each
 * is rewritten until unskipped and green, and what an agent calls obsolete
 * reaches the human review as a deletion proposal only a person can tick.
 */
export const testsFlow = async (): Promise<void> => {
  refusePendingHandOff()
  for (const file of [REQUIREMENTS, TESTS, RETIRE]) {
    if (read(file) !== undefined) refuse(`gtd: ${file} is left over — finish or remove it first.`)
  }
  const expression = skipExpression(vars.skipPattern ?? testsDefaults.skipPattern!)
  await gate("tests-gate", gateMessage())
  const base = start()
  const known = new Set(testPaths())
  const revised = new Set<string>()
  // Sweep and rewrites only: the review's "delete it" fix is the one turn allowed to delete a test.
  const guard = guardFor(known, revised, expression)
  const report = await scope("tests", async (): Promise<LensReport | undefined> => {
    const skips = scan([...known], expression)
    await t.agentWithSkills("sweeping", sweepingPrompt(skips), {
      label: "Sweeping the tests",
      file: TESTS,
      model: coder(),
      system: t.finisherSystem(),
      allowEmpty: true,
    })
    const packages = sectionBodies(read(TESTS) ?? "").map((s) => ({
      path: pathOf(s.title),
      found: below(s.body),
    }))
    const tree = new Set(glob("**"))
    const missing = [
      ...packages.filter((p) => !tree.has(p.path)).map((p) => `"${p.path}" is no file`),
      ...[...new Set(skips.map((s) => s.path))]
        .filter((path) => !packages.some((p) => p.path === path))
        .map((path) => `${path} has no section`),
    ]
    if (missing.length > 0) refuse(`gtd land: tests: in ${TESTS}, ${missing.join("; ")}`)
    for (const { path, found } of packages) {
      revised.add(path)
      await t.agentWithSkills("rewriting", rewritingPrompt(path, found), {
        label: `Rewriting ${path}`,
        file: RETIRE,
        model: coder(),
        system: t.finisherSystem(),
      })
      guard()
      await healthy(() => fixCheck(), { guard })
    }
    const retired = proposals(read(RETIRE) ?? "")
    if (read(TESTS) !== undefined || read(RETIRE) !== undefined) {
      await run("closing", removeScript([TESTS, RETIRE]), { label: "Closing the sweep" })
    }
    return packages.length === 0 ? undefined : { notes: retired, fixed: [], noise: [] }
  })
  if (report === undefined) return
  let outcome = await tail(
    (escalations) => humanReview(base, escalations, { report, awaitMessage }),
    { lenses: [], green: true },
  )
  while (outcome.verdict === "feedback") {
    await reUnwind(outcome)
    await fixFeedback()
    outcome = await tail((escalations) => humanReview(base, escalations, { awaitMessage }), {
      lenses: [],
    })
  }
}

export const tests = testsShipped(testsFlow)
