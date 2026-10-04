// The bundled workflow's variable defaults. `.gtdrc` `vars:`, `--var` and
// `GTD_<NAME>` override any of them.
export const defaults: Readonly<Record<string, string>> = {
  testCommand: "npm test",
  plannerModel: "smart",
  coderModel: "base",
  reviewBase: "",
  judgeBudgetBytes: "32768",
  judgeIdenticalMinP: "0.7",
  specPreJudge: "0.9",
  reviewNoteActionable: "0.7",
  architectureSkipMinP: "0.85",
  // The per-step skill lists formerly declared here as `*Skills` vars now
  // live in `./skills.ts`, addressed per step by `.gtdrc` `skills:`.
  // `qualityReviews` is the one exception: it fans out into one turn per
  // entry (`qualityLenses`, in `./review.ts`) rather than naming one step's
  // skill list, so it stays a var — pairing with `build.quality.reviewing`'s
  // entry in `./skills.ts`, which replaces the lens on every one of those
  // turns.
  qualityReviews: "owasp-security, ponytail-review, test-audit",
}
