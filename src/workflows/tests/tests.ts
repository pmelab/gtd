import {
  changes,
  changesSince,
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
  and why it should go. A person decides. Propose a line gtd misread as
  skipped (fixture text, a comment) the same way, saying so
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
landing here is refused until each proposal holds exactly one tick. An agent
turn that deleted a test file was refused; check the diff for tests removed
inside a file.

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

/** Sections of `text` that name `path` as a whole token — a trailing full stop still counts. */
const naming = (text: string, path: string): number => {
  const token = new RegExp(`(?<![\\w./-])${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`)
  // `./path` names the same file.
  return sectionBodies(text).filter((s) => token.test(s.body.replace(/(^|[^\w.])\.\//g, "$1")))
    .length
}

/** Refuses a test file a turn deleted, and a skip left in the file being rewritten that `.gtd/RETIRE.md` does not name. */
const guardFor = (known: ReadonlySet<string>, expression: RegExp, path?: string) => (): void => {
  const deleted = changes()
    .filter((c) => c.status === "deleted" && known.has(c.path))
    .map((c) => c.path)
  if (deleted.length > 0)
    refuse(
      `gtd land: tests: ${deleted.join(", ")} deleted — a test goes only once a person ticks "delete it" at the review`,
    )
  // Only the file being rewritten: a skip a person kept at an earlier file's escalation stays theirs.
  if (path === undefined) return
  const skips = scan([path], expression)
  // One proposal per skip left: a section naming the file covers one skip in it, never all.
  const left = skips.slice(naming(read(RETIRE) ?? "", path))
  if (left.length > 0)
    refuse(
      `gtd land: tests: ${left.map((s) => `${s.path}:${s.line}`).join(", ")} still skipped — revive it, or propose its deletion in ${RETIRE}`,
    )
}

/** The sweep's packages, refused when it changed more than its plan or the plan misses a file. */
const planned = (
  skips: readonly Skip[],
  known: ReadonlySet<string>,
): readonly { path: string; found: string }[] => {
  const strays = changes().filter((c) => c.path !== TESTS)
  if (strays.length > 0)
    refuse(
      `gtd land: tests: the sweep changed ${strays.map((c) => c.path).join(", ")} — it writes only ${TESTS}`,
    )
  const packages = sectionBodies(read(TESTS) ?? "").map((s) => ({
    path: pathOf(s.title),
    found: below(s.body),
  }))
  const missing = [
    ...packages.filter((p) => !known.has(p.path)).map((p) => `"${p.path}" is no test file`),
    ...[...new Set(skips.map((s) => s.path))]
      .filter((path) => !packages.some((p) => p.path === path))
      .map((path) => `${path} has no section`),
  ]
  if (missing.length > 0) refuse(`gtd land: tests: in ${TESTS}, ${missing.join("; ")}`)
  return packages
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
  // Sweep and rewrites only: the review's "delete it" fix is the one turn allowed to delete a test.
  const guard = guardFor(known, expression)
  const report = await scope("tests", async (): Promise<LensReport | undefined> => {
    const skips = scan([...known], expression)
    await t.agentWithSkills("sweeping", sweepingPrompt(skips), {
      label: "Sweeping the tests",
      file: TESTS,
      model: coder(),
      system: t.finisherSystem(),
      allowEmpty: true,
    })
    guard()
    const packages = planned(skips, known)
    for (const { path, found } of packages) {
      const guarded = guardFor(known, expression, path)
      await t.agentWithSkills("rewriting", rewritingPrompt(path, found), {
        label: `Rewriting ${path}`,
        file: RETIRE,
        model: coder(),
        system: t.finisherSystem(),
        // A file the audit only flagged may already be fine.
        allowEmpty: true,
      })
      guarded()
      // No code changed: the suite is as green as the last loop left it.
      if (!changes().some((c) => isCode(c.path))) continue
      // Unguarded human rests: a person at the escalation may delete or keep what they like.
      await healthy(() => fixCheck(), { guard: guarded, guardRests: false })
    }
    const retired = proposals(read(RETIRE) ?? "")
    if (read(TESTS) !== undefined || read(RETIRE) !== undefined) {
      await run("closing", removeScript([TESTS, RETIRE]), { label: "Closing the sweep" })
    }
    // Nothing revived and nothing proposed: a review would hold no diff to sign off.
    const changed = changesSince(base).paths.some(isCode)
    return retired.length === 0 && !changed ? undefined : { notes: retired, fixed: [], noise: [] }
  })
  if (report === undefined) return
  let outcome = await tail(
    (escalations) =>
      humanReview(base, escalations, {
        report,
        awaitMessage: report.notes.length > 0 ? awaitMessage : undefined,
      }),
    { lenses: [], green: true },
  )
  while (outcome.verdict === "feedback") {
    await reUnwind(outcome)
    await fixFeedback()
    outcome = await tail((escalations) => humanReview(base, escalations), {
      lenses: [],
    })
  }
}

export const tests = testsShipped(testsFlow)
