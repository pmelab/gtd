#!/usr/bin/env node
// Regression gate for `npm run eval`: compares the per-cell pass RATE
// (never a count, since `--repeat` can differ from the baseline's `trials`)
// in `evals/results.json` against the committed `evals/baseline.json`. Any
// cell whose rate drops, or that is missing on either side, fails. Never
// invoked by a passing `npm run eval` to rewrite the baseline — see
// `--record` below, which is the one path a human types on purpose.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cellsFrom, readResults } from "./report.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS_PATH = join(HERE, "results.json")
const BASELINE_PATH = join(HERE, "baseline.json")
// This repo's own resolved binary, never `npx oxfmt` — npx resolves whatever
// version its cache holds (fetching from the network on a cold one), which
// can silently drift from the `oxfmt` devDependency everything else here is
// pinned to (see `evals/fixture.mjs`'s `OXFMT_BIN`).
const OXFMT_BIN = join(HERE, "..", "node_modules", ".bin", "oxfmt")

export function readBaseline(path) {
  return JSON.parse(readFileSync(path, "utf-8"))
}

function rate(cell) {
  return cell.passed / cell.total
}

// Builds the committed shape from a fresh `cellsFrom` map: flat, per-cell
// `{ passed, total }`, no averaged/aggregate field — the format itself makes
// an aggregate unrepresentable.
export function buildBaseline(cells, recordedAt) {
  const rates = {}
  let trials = 0
  for (const [key, cell] of [...cells.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    rates[key] = { passed: cell.passed, total: cell.total }
    trials = Math.max(trials, cell.total)
  }
  return { recordedAt, trials, rates }
}

// Compares run cells against the baseline's rates and returns every
// violation found — a lower rate, a cell missing from the baseline, or a
// baseline cell missing from the run. Never a single early exit: a real run
// against a stale baseline usually breaks more than one cell at once, and a
// human re-running by hand wants the whole picture.
export function compareCells(baselineRates, runCells) {
  const violations = []
  const runKeys = new Set(runCells.keys())
  const baselineKeys = new Set(Object.keys(baselineRates))

  for (const key of runKeys) {
    const runCell = runCells.get(key)
    const baselineCell = baselineRates[key]
    if (!baselineCell) {
      violations.push(`${key}: ${runCell.passed}/${runCell.total} — not recorded in baseline`)
      continue
    }
    const runRate = rate(runCell)
    const baselineRate = rate(baselineCell)
    if (runRate < baselineRate) {
      violations.push(
        `${key}: regressed — baseline ${baselineCell.passed}/${baselineCell.total}, run ${runCell.passed}/${runCell.total}`,
      )
    }
  }

  for (const key of baselineKeys) {
    if (runKeys.has(key)) continue
    const baselineCell = baselineRates[key]
    violations.push(
      `${key}: missing from run — baseline recorded ${baselineCell.passed}/${baselineCell.total}`,
    )
  }

  return violations
}

// `resultsPath`/`baselinePath` default to the real committed files but stay
// parameters so tests can point both at throwaway fixtures instead of
// mutating the repo's own committed baseline.
export function record(resultsPath = RESULTS_PATH, baselinePath = BASELINE_PATH) {
  const cells = cellsFrom(readResults(resultsPath))
  const baseline = buildBaseline(cells, new Date().toISOString())
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n")
  execFileSync(OXFMT_BIN, ["--write", baselinePath], { stdio: "inherit" })
  console.log(`${baselinePath} recorded from ${resultsPath}`)
}

export function compare(resultsPath = RESULTS_PATH, baselinePath = BASELINE_PATH) {
  const cells = cellsFrom(readResults(resultsPath))
  const baseline = readBaseline(baselinePath)
  const violations = compareCells(baseline.rates, cells)
  if (violations.length > 0) {
    console.error("eval: regression against evals/baseline.json:")
    for (const line of violations) console.error(`  ${line}`)
    process.exitCode = 1
    return violations
  }
  console.log("eval: no regression against evals/baseline.json")
  return violations
}

function main() {
  if (process.argv.includes("--record")) record()
  else compare()
}

if (import.meta.url === `file://${process.argv[1]}`) main()
