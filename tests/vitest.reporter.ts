import { relative } from "node:path"
import type { Reporter } from "vitest/reporters"

type TestCase = Parameters<NonNullable<Reporter["onTestCaseResult"]>>[0]
type RunEnd = Parameters<NonNullable<Reporter["onTestRunEnd"]>>

// scripts/test-states.ts parses this format: an unindented `FAIL <name>` line per failure.
// Message lines are indented so a message that starts with `FAIL` cannot pass for a name.
const indent = (text: string): string => `  ${text.replace(/\n/g, "\n  ")}\n`

export default class SilentReporter implements Reporter {
  private failures: TestCase[] = []

  onTestCaseResult(testCase: TestCase): void {
    if (testCase.result().state === "failed") {
      this.failures.push(testCase)
    }
  }

  // fallow-ignore-next-line complexity
  onTestRunEnd(testModules: RunEnd[0] = [], unhandledErrors: RunEnd[1] = []): void {
    // A file that fails to import has no test case; an unhandled error belongs to none.
    const suiteErrors = testModules.flatMap((m) =>
      m.errors().map((e) => ({ name: relative(process.cwd(), m.moduleId), error: e })),
    )
    const unhandled = unhandledErrors.map((e) => ({
      name: `unhandled error: ${(e.message ?? "").split("\n")[0]}`,
      error: e,
    }))
    const extra = [...suiteErrors, ...unhandled]
    const total = this.failures.length + extra.length
    if (total === 0) return

    for (const test of this.failures) {
      const result = test.result()
      if (result.state !== "failed") continue
      const file = relative(process.cwd(), test.module.moduleId)
      process.stderr.write(`\nFAIL ${file} > ${test.fullName}\n`)
      for (const err of result.errors) {
        if (err.message) process.stderr.write(indent(err.message))
        if (err.stack) {
          const firstLine = err.stack.split("\n")[0]
          if (firstLine && firstLine !== err.message) {
            process.stderr.write(indent(firstLine))
          }
        }
      }
    }
    for (const { name, error } of extra) {
      process.stderr.write(`\nFAIL ${name}\n`)
      if (error.message) process.stderr.write(indent(error.message))
    }

    process.stderr.write(`\n${total} test(s) failed\n`)
  }
}
