#!/usr/bin/env node
// Grades: a candidate `specFindingKeep` threshold value (the post-judge var
// Task 3 of packages/02-spec-review-judgments.md wires into unified.yaml)
// against a recorded fixture of THIS repo's own history. `specPreJudge` is
// NOT swept here — see `metrics.mjs`'s `UNMEASURED_SPEC_PRE_JUDGE_DEFAULT`
// for why (no fixture case is a "requirement already satisfied?" judgment).
//
// GRANULARITY CAVEAT: `specFindingKeep` gates ONE `## ` finding at a time in
// the real workflow (`findingJudge`, one `noul` per `it.sections(...)`
// entry); this fixture's `findingMarkdown` is instead each fix turn's WHOLE
// `.gtd/SPEC_FEEDBACK.md` — preamble plus every finding — judged and labelled
// as one unit. A file containing one real defect plus two nits is labelled
// `real: true` even though the post-judge, run for real, would see the nits
// in isolation and might correctly strike them. The measured miss rate is
// therefore a coarser-than-real proxy: it bounds "would suppressing this
// WHOLE turn's feedback have lost a real fix", not "would suppressing this
// ONE finding". Treat the recommended `specFindingKeep` as a validated floor
// for turn-level suppression, not a per-finding-calibrated number — a repo
// with per-finding ground truth (e.g. did THIS finding's own named path
// appear in the fix turn's diff) would make a sharper eval.
//
// This is a SIBLING harness to evals/eval.mjs, which grades prompt-turn
// quality, not threshold values. That harness is cases × variants ×
// --repeat × providers scored against evals/baseline.json; this one is a
// one-shot sweep over
// evals/judgments/fixture.json, printed fresh every run (no baseline to
// regress, since a threshold recommendation is read by a human, not gated).
//
// Fixture derivation (regenerate by re-running this, not by hand-editing the
// JSON): `git log --all --grep="fix-spec → packages.item.health.check" -F`
// finds every landed fix-spec turn in this repo's own history (a commit
// whose subject is gtd's own state-transition trailer). For each, the
// PARENT commit's `.gtd/SPEC_FEEDBACK.md` is the finding text a spec-review
// judge would have seen; `git diff --name-only <parent> <commit> -- . ':!.gtd'`
// empty means the fix turn changed nothing outside `.gtd/` bookkeeping — the
// package's own definition of churn. Of 157 such turns in this repo as of
// 2026-09, 156 produced a real diff and exactly 1 did not (id
// 6535ba8f, fixture below) — this repo's spec-review findings are almost
// never spurious. That one churn case is itself ambiguous on inspection: the
// finding it records (a graft cache accidentally committed) reads as a
// genuine defect, not a nitpick — the fix turn plausibly just failed to act,
// which this diff-only proxy cannot tell apart from "the finding didn't
// deserve a fix". Recorded as churn anyway, matching the package's literal
// definition ("the fix turn changed nothing"), with this caveat for whoever
// regenerates the fixture next: a diff-emptiness signal measures the outcome,
// not the finding's merit, and a repo with more real churn examples would
// make a sharper eval. Revert-detection (the OR half of "changed nothing, or
// was reverted") is not implemented — no reverted fix-spec turn was found by
// inspection of the sample below, and grep-driven revert detection across a
// closure of possible later commits was judged not worth the complexity for
// one repo's worth of history.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { judgeFinding } from "./judge.mjs"
import { recommendedVars, sweep } from "./metrics.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = join(HERE, "fixture.json")

// Coarse enough to see the miss-rate floor's shape without paying for 100
// judge calls per case; a maintainer re-running this to fine-tune around the
// recommended value can pass --thresholds 0.32,0.34,... instead.
const DEFAULT_THRESHOLDS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

function parseThresholds(argv) {
  const idx = argv.indexOf("--thresholds")
  if (idx === -1) return DEFAULT_THRESHOLDS
  return argv[idx + 1].split(",").map(Number)
}

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"))
}

async function judgeAll(cases, gatewayUrl, gatewayKey) {
  const judged = []
  for (const c of cases) {
    const p = await judgeFinding(gatewayUrl, gatewayKey, c.findingMarkdown)
    judged.push({ id: c.id, p, real: c.real })
  }
  return judged
}

function printTable(judged, results) {
  console.log("Per-case judge output:")
  for (const { id, p, real } of judged) {
    console.log(`  ${id.slice(0, 12)}  p=${p.toFixed(2)}  real=${real}`)
  }
  console.log("\nPer-threshold suppression/miss rates:")
  console.log(
    "  threshold  missRate  churnSuppressionRate  (suppressedReal/totalReal, suppressedChurn/totalChurn)",
  )
  for (const r of results) {
    console.log(
      `  ${r.threshold.toFixed(2)}       ${r.missRate.toFixed(2)}      ${r.churnSuppressionRate.toFixed(2)}` +
        `                  (${r.suppressedReal}/${r.totalReal}, ${r.suppressedChurn}/${r.totalChurn})`,
    )
  }
}

async function main() {
  const gatewayUrl = process.env.GTD_EVALS_URL
  const gatewayKey = process.env.GTD_EVALS_KEY
  if (!gatewayUrl || !gatewayKey) {
    console.error(
      "eval:judgments: GTD_EVALS_URL and GTD_EVALS_KEY are required (the judge's gateway)",
    )
    process.exit(1)
  }

  const cases = loadFixture()
  const thresholds = parseThresholds(process.argv.slice(2))
  const judged = await judgeAll(cases, gatewayUrl, gatewayKey)
  const results = sweep(thresholds, judged)

  printTable(judged, results)

  const vars = recommendedVars(results)
  console.log(
    "\nRecommended vars (specFindingKeep measured by this sweep, lowest miss rate then " +
      "highest churn suppression; specPreJudge is the fixed unmeasured default, see this " +
      "file's own opening comment):",
  )
  console.log(JSON.stringify(vars, null, 2))
}

main().catch((err) => {
  console.error(`eval:judgments: ${err.stack ?? err.message}`)
  process.exit(1)
})
