// Pure threshold-sweep math for evals/judgments/eval.mjs — no network, no fs.
// A judged case is `{ p, real }`: `p` is a judge's probability that a
// spec-review finding is a genuine, actionable violation (the same framing
// `specFindingKeep` gates: keep a finding when `p >= specFindingKeep`).
// `real` is ground truth: did this finding's fix turn produce a real,
// unreverted diff?
//
// This sweep measures ONLY `specFindingKeep` — every mined fixture case is a
// finding-merit judgment ("is this a real violation?"), never a "requirement
// already satisfied?" judgment `specPreJudge` gates. A round of review caught
// an earlier version of this file deriving `specPreJudge` as `1 - threshold`
// on the assumption that a judge's calibration on one question transfers
// exactly to its negation over DIFFERENT evidence (package markdown plus a
// commit range, versus finding prose) — an identity this sweep never
// measures and cannot support. `specPreJudge` is instead a hand-picked,
// deliberately conservative default (see `UNMEASURED_SPEC_PRE_JUDGE_DEFAULT`
// below) until a fixture of real pre-judge cases exists to mine.

/**
 * One threshold's confusion counts against a keep-if-`p >= threshold` rule.
 * `missRate` is the fraction of REAL findings a threshold would suppress —
 * the number pre-judge/post-judge tuning must drive to (~)zero, since a
 * suppressed review that would have yielded a real fix is the failure mode
 * the whole package exists to avoid. `churnSuppressionRate` is the fraction
 * of churn a threshold correctly catches — the only number a threshold can
 * still improve once missRate is at its floor.
 */
export function summarize(threshold, judged) {
  let suppressedReal = 0
  let suppressedChurn = 0
  let keptReal = 0
  let keptChurn = 0
  for (const { p, real } of judged) {
    const suppressed = p < threshold
    if (suppressed && real) suppressedReal++
    else if (suppressed && !real) suppressedChurn++
    else if (!suppressed && real) keptReal++
    else keptChurn++
  }
  const totalReal = suppressedReal + keptReal
  const totalChurn = suppressedChurn + keptChurn
  return {
    threshold,
    missRate: totalReal ? suppressedReal / totalReal : 0,
    churnSuppressionRate: totalChurn ? suppressedChurn / totalChurn : 0,
    suppressedReal,
    suppressedChurn,
    keptReal,
    keptChurn,
    totalReal,
    totalChurn,
  }
}

/** `summarize` at every candidate threshold, in the order given. */
export function sweep(thresholds, judged) {
  return thresholds.map((threshold) => summarize(threshold, judged))
}

/**
 * Picks the threshold that maximizes churn suppression among every threshold
 * tied for the lowest observed missRate — "a suppressed review would ~never
 * have yielded a real fix" (the package's own acceptance line) means the
 * miss floor wins over squeezing out more churn. Ties at the same missRate
 * AND churnSuppressionRate keep the smallest threshold — a smaller
 * `specFindingKeep` keeps strictly more findings, so it degrades to plain
 * review scope more gracefully if the judge itself drifts.
 */
export function recommend(sweepResults) {
  const floor = Math.min(...sweepResults.map((r) => r.missRate))
  const atFloor = sweepResults.filter((r) => r.missRate === floor)
  return atFloor.reduce((best, r) => {
    if (r.churnSuppressionRate > best.churnSuppressionRate) return r
    if (r.churnSuppressionRate < best.churnSuppressionRate) return best
    return r.threshold < best.threshold ? r : best
  })
}

/**
 * NOT derived from any measured case — no fixture case here is a "requirement
 * already satisfied?" judgment, so there is no sweep to pick this from (see
 * this file's opening comment). Chosen conservatively high: `pre` only skips
 * a section's review when the judge clears THIS floor, so a high default
 * means the pre-judge rarely fires until real pre-judge history exists to
 * mine a measured value from. Mirrored in `unified.yaml`'s `specPreJudge`
 * var comment — keep both in sync by hand.
 */
export const UNMEASURED_SPEC_PRE_JUDGE_DEFAULT = 0.9

/**
 * `specFindingKeep` is `recommend`'s threshold directly (keep a finding when
 * its violation-probability clears the floor) — the one var this sweep
 * actually measures. `specPreJudge` is NOT derived from it; see
 * `UNMEASURED_SPEC_PRE_JUDGE_DEFAULT`'s own comment.
 */
export function recommendedVars(sweepResults) {
  const { threshold } = recommend(sweepResults)
  return { specFindingKeep: threshold, specPreJudge: UNMEASURED_SPEC_PRE_JUDGE_DEFAULT }
}
