#!/usr/bin/env node
// Drives `promptfoo eval` for the `eval` npm script and strips its own
// end-of-run aggregate ("Results: N passed (X%)" ... "Duration: ...") from
// stdout as it streams — that block sums pass/fail across BOTH fixtures AND
// BOTH models, exactly the aggregate Requirement C forbids. The per-test
// results table above it is unaffected and stays on screen. `evals/report.mjs`
// then prints the real per-fixture, per-model rates from `evals/results.json`.
// promptfoo's own exit code is preserved: `npm run eval` still fails when any
// assertion fails.
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cellsFrom, printCells, readResults } from "./report.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS_PATH = join(HERE, "results.json")

const PROMPTFOO_ARGS = [
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
]

function makeLineFilter(onLine) {
  let buffered = ""
  let suppressing = false
  return (chunk) => {
    buffered += chunk
    const lines = buffered.split("\n")
    buffered = lines.pop() ?? ""
    for (const line of lines) suppressing = onLine(line, suppressing)
  }
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

function runPromptfoo() {
  return new Promise((resolve) => {
    const child = spawn("promptfoo", PROMPTFOO_ARGS, { stdio: ["inherit", "pipe", "inherit"] })
    const onChunk = makeLineFilter(filterAggregate)
    child.stdout.on("data", (chunk) => onChunk(chunk.toString("utf-8")))
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

async function main() {
  const code = await runPromptfoo()
  printReport()
  process.exit(code)
}

main()
