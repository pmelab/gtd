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
  triageSkills: "spec-driven-development, planning-and-task-breakdown",
  architectureSkills: "api-and-interface-design, documentation-and-adrs, ponytail",
  decomposeSkills: "incremental-implementation, planning-and-task-breakdown",
  buildSkills: "test-driven-development, incremental-implementation, ponytail",
  fixSkills: "debugging-and-error-recovery",
  reviewFixSkills: "incremental-implementation, code-simplification",
  reviewSkills: "code-review-and-quality",
  specReviewSkills: "code-review-and-quality, spec-driven-development",
  escalateSkills: "debugging-and-error-recovery",
  qualityReviews: "owasp-security, ponytail-review, test-audit",
}
