import { describe, expect, it } from "vitest"
import {
  recommend,
  recommendedVars,
  summarize,
  sweep,
  UNMEASURED_SPEC_PRE_JUDGE_DEFAULT,
} from "./metrics.mjs"

describe("summarize", () => {
  it("counts a low-p real case as a suppressed miss", () => {
    const result = summarize(0.5, [{ p: 0.2, real: true }])
    expect(result).toMatchObject({ suppressedReal: 1, missRate: 1, totalReal: 1, totalChurn: 0 })
  })

  it("counts a low-p churn case as correctly suppressed, not a miss", () => {
    const result = summarize(0.5, [{ p: 0.2, real: false }])
    expect(result).toMatchObject({
      suppressedChurn: 1,
      missRate: 0,
      churnSuppressionRate: 1,
      totalReal: 0,
    })
  })

  it("keeps a case exactly at the threshold (p >= threshold)", () => {
    const result = summarize(0.5, [{ p: 0.5, real: true }])
    expect(result).toMatchObject({ keptReal: 1, suppressedReal: 0 })
  })

  it("reports 0, not NaN, for a rate with zero denominator", () => {
    const result = summarize(0.5, [{ p: 0.9, real: true }])
    expect(result.churnSuppressionRate).toBe(0)
    expect(result.missRate).toBe(0)
  })

  it("mixes real and churn cases into independent rates", () => {
    const judged = [
      { p: 0.1, real: true }, // suppressed miss
      { p: 0.1, real: false }, // suppressed churn (correct)
      { p: 0.9, real: true }, // kept real (correct)
      { p: 0.9, real: false }, // kept churn (a false positive, not a miss)
    ]
    const result = summarize(0.5, judged)
    expect(result.missRate).toBe(0.5)
    expect(result.churnSuppressionRate).toBe(0.5)
  })
})

describe("sweep", () => {
  it("runs summarize once per threshold, in order", () => {
    const judged = [{ p: 0.4, real: true }]
    const results = sweep([0.1, 0.5, 0.9], judged)
    expect(results.map((r) => r.threshold)).toEqual([0.1, 0.5, 0.9])
    expect(results[0].keptReal).toBe(1) // 0.4 >= 0.1
    expect(results[1].suppressedReal).toBe(1) // 0.4 < 0.5
    expect(results[2].suppressedReal).toBe(1) // 0.4 < 0.9
  })
})

describe("recommend", () => {
  it("picks the highest threshold among those tied at the miss-rate floor", () => {
    // With this fixture, thresholds 0.1..0.4 all miss zero real cases; 0.4
    // additionally suppresses the churn case, so it must win over 0.1-0.3.
    const judged = [
      { p: 0.5, real: true },
      { p: 0.3, real: false },
    ]
    const results = sweep([0.1, 0.2, 0.3, 0.4, 0.6], judged)
    const best = recommend(results)
    expect(best.threshold).toBe(0.4)
    expect(best.missRate).toBe(0)
    expect(best.churnSuppressionRate).toBe(1)
  })

  it("prefers the miss-rate floor over higher churn suppression", () => {
    // threshold 0.6 suppresses the real case too (a miss) even though it
    // would otherwise also catch the churn case — recommend must not pick it.
    const judged = [
      { p: 0.5, real: true },
      { p: 0.3, real: false },
    ]
    const results = sweep([0.4, 0.6], judged)
    const best = recommend(results)
    expect(best.threshold).toBe(0.4)
  })

  it("breaks a full tie by keeping the smallest threshold", () => {
    const judged = [{ p: 0.9, real: true }]
    const results = sweep([0.1, 0.2], judged)
    const best = recommend(results)
    expect(best.threshold).toBe(0.1)
  })
})

describe("recommendedVars", () => {
  it("mirrors the recommended keep-threshold into specFindingKeep — the one var this sweep measures", () => {
    const judged = [
      { p: 0.5, real: true },
      { p: 0.3, real: false },
    ]
    const results = sweep([0.1, 0.4], judged)
    const vars = recommendedVars(results)
    expect(vars.specFindingKeep).toBe(0.4)
  })

  it("specPreJudge is the fixed unmeasured default, independent of the sweep's own result", () => {
    const judged = [{ p: 0.9, real: true }]
    const results = sweep([0.1, 0.9], judged)
    const vars = recommendedVars(results)
    expect(vars.specPreJudge).toBe(UNMEASURED_SPEC_PRE_JUDGE_DEFAULT)
  })
})
