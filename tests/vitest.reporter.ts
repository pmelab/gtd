import type { Reporter } from "vitest/reporters"

type TestCase = Parameters<NonNullable<Reporter["onTestCaseResult"]>>[0]

export default class SilentReporter implements Reporter {
  private failures: TestCase[] = []

  onTestCaseResult(testCase: TestCase): void {
    if (testCase.result().state === "failed") {
      this.failures.push(testCase)
    }
  }

  // fallow-ignore-next-line complexity
  onTestRunEnd(): void {
    if (this.failures.length === 0) return

    for (const test of this.failures) {
      const result = test.result()
      if (result.state !== "failed") continue
      process.stderr.write(`\nFAIL ${test.fullName}\n`)
      for (const err of result.errors) {
        if (err.message) process.stderr.write(`  ${err.message}\n`)
        if (err.stack) {
          const firstLine = err.stack.split("\n")[0]
          if (firstLine && firstLine !== err.message) {
            process.stderr.write(`  ${firstLine}\n`)
          }
        }
      }
    }

    process.stderr.write(`\n${this.failures.length} test(s) failed\n`)
  }
}
