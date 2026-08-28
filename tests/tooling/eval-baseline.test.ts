import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const OXFMT_BIN = fileURLToPath(new URL("../../node_modules/.bin/oxfmt", import.meta.url))
import { buildBaseline, compare, compareCells, record } from "../../evals/compare-baseline.mjs"

function resultsDoc(cells: Record<string, { passed: number; total: number }>) {
  const results: unknown[] = []
  for (const [key, { passed, total }] of Object.entries(cells)) {
    const [label, variant] = key.split("|")
    for (let i = 0; i < total; i++) {
      results.push({ provider: { label }, vars: { variant }, success: i < passed })
    }
  }
  return { results: { results } }
}

function cellsMap(cells: Record<string, { passed: number; total: number }>) {
  return new Map(Object.entries(cells))
}

let dir: string

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe("buildBaseline", () => {
  it("is flat and per-cell, with no aggregate field", () => {
    const baseline = buildBaseline(
      cellsMap({
        "planner|clean": { passed: 4, total: 4 },
        "cheap|violation": { passed: 3, total: 4 },
      }),
      "2026-01-01T00:00:00.000Z",
    )
    expect(baseline).toEqual({
      recordedAt: "2026-01-01T00:00:00.000Z",
      trials: 4,
      rates: {
        "planner|clean": { passed: 4, total: 4 },
        "cheap|violation": { passed: 3, total: 4 },
      },
    })
  })
})

describe("compareCells", () => {
  const baseline = {
    "planner|clean": { passed: 4, total: 4 },
    "planner|violation": { passed: 4, total: 4 },
  }

  it("flags a dropped rate: 4/4 baseline to 3/4 run reds the cell", () => {
    const violations = compareCells(
      baseline,
      cellsMap({
        "planner|clean": { passed: 4, total: 4 },
        "planner|violation": { passed: 3, total: 4 },
      }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("planner|violation")
    expect(violations[0]).toContain("baseline 4/4")
    expect(violations[0]).toContain("run 3/4")
  })

  it("passes clean on a matching baseline", () => {
    const violations = compareCells(
      baseline,
      cellsMap({
        "planner|clean": { passed: 4, total: 4 },
        "planner|violation": { passed: 4, total: 4 },
      }),
    )
    expect(violations).toEqual([])
  })

  it("passes clean when the run scores higher than the baseline", () => {
    const violations = compareCells(
      { "planner|clean": { passed: 3, total: 4 } },
      cellsMap({ "planner|clean": { passed: 4, total: 4 } }),
    )
    expect(violations).toEqual([])
  })

  it("compares rates, not counts — a different --repeat still compares meaningfully", () => {
    const violations = compareCells(
      { "planner|clean": { passed: 4, total: 4 } },
      cellsMap({ "planner|clean": { passed: 8, total: 8 } }),
    )
    expect(violations).toEqual([])
  })

  it("fails a cell present in the run but absent from the baseline", () => {
    const violations = compareCells({}, cellsMap({ "planner|clean": { passed: 4, total: 4 } }))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("planner|clean")
    expect(violations[0]).toContain("not recorded in baseline")
  })

  it("fails a cell present in the baseline but absent from the run", () => {
    const violations = compareCells({ "planner|clean": { passed: 4, total: 4 } }, cellsMap({}))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("planner|clean")
    expect(violations[0]).toContain("missing from run")
  })
})

describe("compare() CLI entry point", () => {
  it("exits non-zero and names the cell and both rates for a regression", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-baseline-"))
    const resultsPath = join(dir, "results.json")
    const baselinePath = join(dir, "baseline.json")
    writeFileSync(
      resultsPath,
      JSON.stringify(resultsDoc({ "planner|violation": { passed: 3, total: 4 } })),
    )
    writeFileSync(
      baselinePath,
      JSON.stringify({
        recordedAt: "x",
        trials: 4,
        rates: { "planner|violation": { passed: 4, total: 4 } },
      }),
    )
    const before = process.exitCode
    process.exitCode = undefined
    const violations = compare(resultsPath, baselinePath)
    expect(process.exitCode).toBe(1)
    expect(violations).toHaveLength(1)
    process.exitCode = before
  })

  it("exits clean on a matching baseline", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-baseline-"))
    const resultsPath = join(dir, "results.json")
    const baselinePath = join(dir, "baseline.json")
    writeFileSync(
      resultsPath,
      JSON.stringify(resultsDoc({ "planner|violation": { passed: 4, total: 4 } })),
    )
    writeFileSync(
      baselinePath,
      JSON.stringify({
        recordedAt: "x",
        trials: 4,
        rates: { "planner|violation": { passed: 4, total: 4 } },
      }),
    )
    const before = process.exitCode
    process.exitCode = undefined
    const violations = compare(resultsPath, baselinePath)
    expect(process.exitCode).toBeUndefined()
    expect(violations).toEqual([])
    process.exitCode = before
  })
})

describe("record() CLI entry point", () => {
  it("rewrites the baseline as an oxfmt fixed point, reproducing the same rates on a re-record with no change", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-baseline-"))
    const resultsPath = join(dir, "results.json")
    const baselinePath = join(dir, "baseline.json")
    writeFileSync(
      resultsPath,
      JSON.stringify(resultsDoc({ "planner|violation": { passed: 4, total: 4 } })),
    )
    record(resultsPath, baselinePath)
    const first = readFileSync(baselinePath, "utf-8")
    expect(JSON.parse(first).rates).toEqual({ "planner|violation": { passed: 4, total: 4 } })
    expect(() => execFileSync(OXFMT_BIN, ["--check", baselinePath])).not.toThrow()

    // Re-recording from the same results.json reproduces the same rates and
    // stays an oxfmt fixed point — `recordedAt` legitimately ticks forward,
    // so the rates (not the raw bytes) are what re-recording must reproduce.
    record(resultsPath, baselinePath)
    const second = readFileSync(baselinePath, "utf-8")
    expect(JSON.parse(second).rates).toEqual(JSON.parse(first).rates)
    expect(() => execFileSync(OXFMT_BIN, ["--check", baselinePath])).not.toThrow()
  })

  it("compare() never rewrites the baseline — only record, a deliberate human action, does", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-baseline-"))
    const resultsPath = join(dir, "results.json")
    const baselinePath = join(dir, "baseline.json")
    writeFileSync(
      resultsPath,
      JSON.stringify(resultsDoc({ "planner|violation": { passed: 4, total: 4 } })),
    )
    record(resultsPath, baselinePath)
    const first = readFileSync(baselinePath, "utf-8")

    // A run scoring HIGHER than a stale baseline leaves the file untouched
    // by `compare`.
    writeFileSync(
      resultsPath,
      JSON.stringify(resultsDoc({ "planner|violation": { passed: 4, total: 4 } })),
    )
    const before = process.exitCode
    process.exitCode = undefined
    compare(resultsPath, baselinePath)
    expect(process.exitCode).toBeUndefined()
    expect(readFileSync(baselinePath, "utf-8")).toBe(first)
    process.exitCode = before
  })
})
