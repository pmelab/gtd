#!/usr/bin/env node
// Drives `promptfoo eval` for the `eval` npm script and strips its own
// end-of-run aggregate ("Results: N passed (X%)" ... "Duration: ...") from
// stdout as it streams — that block sums pass/fail across BOTH fixtures AND
// BOTH models, exactly the aggregate Requirement C forbids. The per-test
// results table above it is unaffected and stays on screen. `evals/report.mjs`
// then prints the real per-fixture, per-model rates from `evals/results.json`.
// promptfoo's own exit code is preserved: `npm run eval` still fails when any
// assertion fails. Once promptfoo itself exits clean, `evals/compare-baseline.mjs`'s
// `compare()` runs in-process as a regression gate against the committed
// `evals/baseline.json` — a per-cell rate drop fails `npm run eval` even
// though every promptfoo assert passed. `compare()` prints the per-cell
// matrix itself, so on that path this file skips its own `printReport()` —
// the matrix must print exactly once, never a duplicate copy.
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { compare } from "./compare-baseline.mjs"
import { cellsFrom, printCells, readResults } from "./report.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS_PATH = join(HERE, "results.json")

// `--repeat 4` and `--max-concurrency 2` are defaults, not a fixed
// configuration — `promptfooArgs` appends whatever `npm run eval -- ...`
// forwards AFTER them, so a user-supplied `--repeat 1` (last-flag-wins, per
// promptfoo's own commander-based CLI) overrides the default for one run
// without editing this committed file.
function promptfooArgs(extraArgs) {
  return [
    "eval",
    "--config",
    join(HERE, "promptfooconfig.yaml"),
    "--repeat",
    "4",
    "--max-concurrency",
    "2",
    "--no-cache",
    "-o",
    RESULTS_PATH,
    ...extraArgs,
  ]
}

// `onChunk` feeds bytes in as they stream; `flush` must be called once the
// stream ends to emit whatever trailing partial line (no terminating `\n`)
// is still buffered — without it, a final chunk with no newline is silently
// dropped rather than ever reaching `onLine`.
function makeLineFilter(onLine) {
  let buffered = ""
  let suppressing = false
  function onChunk(chunk) {
    buffered += chunk
    const lines = buffered.split("\n")
    buffered = lines.pop() ?? ""
    for (const line of lines) suppressing = onLine(line, suppressing)
  }
  function flush() {
    if (buffered) suppressing = onLine(buffered, suppressing)
    buffered = ""
  }
  return { onChunk, flush }
}

function isAggregateStart(line) {
  return line === "Results:"
}

function isAggregateEnd(line) {
  return line.startsWith("Duration:")
}

// Suppresses the block from the "Results:" heading (inclusive) through the
// "Duration: ..." line (inclusive) that follows it; every other line passes
// through untouched.
function filterAggregate(line, suppressing) {
  if (suppressing) return !isAggregateEnd(line)
  if (isAggregateStart(line)) return true
  process.stdout.write(line + "\n")
  return false
}

function runPromptfoo(extraArgs) {
  return new Promise((resolve) => {
    const child = spawn("promptfoo", promptfooArgs(extraArgs), {
      stdio: ["inherit", "pipe", "inherit"],
    })
    const filter = makeLineFilter(filterAggregate)
    child.stdout.on("data", (chunk) => filter.onChunk(chunk.toString("utf-8")))
    child.stdout.on("end", () => filter.flush())
    // A spawn failure (promptfoo not resolvable on PATH) emits 'error'
    // instead of 'close' — without this handler it's an unhandled
    // exception and a raw stack trace, not a clear infra-failure message.
    child.on("error", (err) => {
      console.error(`eval: failed to start promptfoo: ${err.message}`)
      resolve(1)
    })
    child.on("close", (code) => resolve(code ?? 1))
  })
}

function printReport() {
  try {
    printCells(cellsFrom(readResults(RESULTS_PATH)))
  } catch (err) {
    // promptfoo never got as far as writing RESULTS_PATH (a spawn failure,
    // a killed process) — there is no per-cell report to print, only the
    // infra failure already reported above.
    console.error(`eval: no results to report: ${err.message}`)
  }
}

// The baseline gate runs after a green promptfoo exit — a promptfoo failure
// already fails the command, and comparing against RESULTS_PATH when
// promptfoo never wrote it would report a confusing secondary error.
// `compare()` prints the per-cell matrix itself, so the caller must not also
// call `printReport()` — that would print the same matrix twice.
function runBaselineGate() {
  compare()
  return process.exitCode ?? 0
}

async function main() {
  const code = await runPromptfoo(process.argv.slice(2))
  if (code === 0) {
    const gateCode = runBaselineGate()
    process.exit(gateCode)
  }
  printReport()
  process.exit(code)
}

main()
