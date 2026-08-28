#!/usr/bin/env node
// Prints the per-fixture, per-model pass rate promptfoo's own summary can't:
// its "N passed (X%)" line and results.json's per-provider testPassCount are
// both summed across fixtures AND models — exactly the aggregate Requirement
// C forbids. This groups `results.results.results[]` by (provider label,
// fixture variant) and prints one `n/total` line per cell, nothing spanning
// either axis.
import { readFileSync } from "node:fs"

function providerLabel(r) {
  return r.provider?.label ?? r.provider?.id
}

function cellKey(r) {
  return `${providerLabel(r)}|${r.vars?.variant}`
}

function cellsFrom(results) {
  const cells = new Map()
  for (const r of results) {
    const key = cellKey(r)
    const cell = cells.get(key) ?? { passed: 0, total: 0 }
    cell.total += 1
    cell.passed += r.success ? 1 : 0
    cells.set(key, cell)
  }
  return cells
}

function readResults(path) {
  const doc = JSON.parse(readFileSync(path, "utf-8"))
  return doc.results?.results ?? []
}

function printCells(cells) {
  const sortedKeys = [...cells.keys()].sort((a, b) => a.localeCompare(b))
  for (const key of sortedKeys) {
    const { passed, total } = cells.get(key)
    console.log(`${key}: ${passed}/${total}`)
  }
}

function main() {
  const path = process.argv[2] ?? "evals/results.json"
  const cells = cellsFrom(readResults(path))
  printCells(cells)
}

main()
