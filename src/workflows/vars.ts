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
  reviewNoteActionable: "0.7",
  // `qualityReviews` fans out into one turn per entry (`qualityLenses`, in
  // `./review.ts`) rather than naming one step's skill list, so it is a
  // setting — pairing with `build.quality.reviewing`'s entry in
  // `./skills.ts`, which replaces the lens on every one of those turns.
  qualityReviews:
    "correctness, owasp-security, ponytail-review, test-audit, conventions, spec-challenge",
}

/** Environment settings. */
export const envDefaults: Readonly<Record<string, string>> = {
  testCommand: "npm test",
  fastTestCommand: "",
  plannerModel: "smart",
  coderModel: "base",
}
