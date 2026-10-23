import type { Reporter } from "vitest/reporters"

type TestCase = Parameters<NonNullable<Reporter["onTestCaseResult"]>>[0]
type RunEnd = Parameters<NonNullable<Reporter["onTestRunEnd"]>>
type ReportedError = { message?: string; stack?: string }

const errorLines = (err: ReportedError): string[] => {
  const firstLine = err.stack?.split("\n")[0]
  return [err.message, firstLine !== err.message ? firstLine : undefined].filter(
    (line): line is string => !!line,
  )
}

const writeFailure = (title: string, errors: ReadonlyArray<ReportedError>): void => {
  if (errors.length === 0) return
  process.stderr.write(`\n${title}\n`)
  for (const line of errors.flatMap(errorLines)) process.stderr.write(`  ${line}\n`)
}

export default class SilentReporter implements Reporter {
  private failures: TestCase[] = []

  onTestCaseResult(testCase: TestCase): void {
    if (testCase.result().state === "failed") {
      this.failures.push(testCase)
    }
  }

  // Vitest fails a run on errors outside any test case too (a file that fails
  // to load, a hook, an unhandled rejection); staying quiet about them turns a
  // red run into an exit 1 with no output.
  // fallow-ignore-next-line complexity
  onTestRunEnd(testModules: RunEnd[0], unhandledErrors: RunEnd[1]): void {
    // Sorted: completion order varies across parallel files and would defeat failure dedupe.
    const sorted = [...this.failures].sort((a, b) => a.fullName.localeCompare(b.fullName))
    for (const test of sorted) writeFailure(`FAIL ${test.fullName}`, test.result().errors ?? [])
    for (const module of testModules) writeFailure(`FAIL ${module.moduleId}`, module.errors())
    writeFailure("Unhandled errors", unhandledErrors)
    if (this.failures.length > 0) {
      process.stderr.write(`\n${this.failures.length} test(s) failed\n`)
    }
  }
}
