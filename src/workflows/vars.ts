// The bundled workflow's settings, in two kinds. A process setting changes
// which step comes next, so it is pinned for the whole process at its start;
// an environment setting only changes how a step runs on this machine, so it
// is read live on every invocation. `.gtdrc` `vars:`/`env:`, `--var` (process
// settings only) and `GTD_<NAME>` override either.

/** Process settings. */
export const defaults: Readonly<Record<string, string>> = {
  reviewBase: "",
  judgeBudgetBytes: "32768",
  judgeIdenticalMinP: "0.7",
  specPreJudge: "0.9",
  reviewNoteActionable: "0.7",
  architectureSkipMinP: "0.85",
  // Decides the turn count: one `build.quality.<lens>` scope per entry, each
  // keyed in `./skills.ts`.
  qualityReviews:
    "correctness, owasp-security, ponytail-review, test-audit, conventions, spec-challenge",
}

/** Environment settings. */
export const envDefaults: Readonly<Record<string, string>> = {
  testCommand: "npm test",
  plannerModel: "smart",
  coderModel: "base",
}
