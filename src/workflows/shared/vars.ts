// The bundled workflow's settings, in two kinds. A process setting changes
// which step comes next, so it is pinned for the whole process at its start;
// an environment setting only changes how a step runs on this machine, so it
// is read live on every invocation. A factory option, `--var` (process
// settings only) and `GTD_<NAME>` override either.

/** The refactor guard's fixed list, and `seamAllow`'s default minus `.gtd/**`. */
export const testFileGlobs: readonly string[] = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.feature",
  "**/tests/**",
  "**/test/**",
  "**/__tests__/**",
]

export const defaultFlagRegistry = "src/flags/index.ts"

/** Process settings. */
export const defaults: Readonly<Record<string, string>> = {
  reviewBase: "",
  judgeBudgetBytes: "32768",
  judgeIdenticalMinP: "0.7",
  reviewNoteActionable: "0.7",
  reviewSeverityMinP: "0.7",
  qualityTriageMinP: "0.7",
  // How sure the judge must be that an answer at the review gate is a reusable standard.
  standardMinP: "0.8",
  refactorFlagPattern: "\\bGTD_FLAG_\\w+",
  seamAllow: [...testFileGlobs, ".gtd/**"].join(", "),
  flagMode: "true",
  // GTD_FLAG_RISK_TIER, recorded at process start; only "1" is on.
  flag_risk_tier: "0",
  // Decides the turn count: one `build.quality.<lens>` scope per entry, each
  // keyed in `./skills.ts`.
  qualityReviews:
    "correctness, owasp-security, ponytail-review, test-audit, conventions, spec-challenge, criteria-coverage",
  refactorQualityReviews: "correctness, ponytail-review, conventions",
  // Fix-and-retest rounds of the hands-on test before a person is asked;
  // "0" skips the test.
  prototypeRounds: "3",
}

/** Environment settings. */
export const envDefaults: Readonly<Record<string, string>> = {
  testCommand: "npm test",
  plannerModel: "smart",
  coderModel: "base",
}
