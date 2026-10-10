const bangHeader = /^\w+(?:\([^)]*\))?!: /
// The literal spelling, not commitlint's own `BREAKING[ -]CHANGE`: semantic-
// release's default (angular) analyzer reads only `BREAKING CHANGE:`, and it
// never parses a `!` header at all — the footer alone is what cuts a major.
const footer = /^BREAKING CHANGE: \S/m

export default {
  extends: ["@commitlint/config-conventional"],
  // Off so `fixup!`/`squash!`/`Revert` commits fail like any other; merge
  // commits never reach it (the CI step lints `git rev-list --no-merges`).
  defaultIgnores: false,
  plugins: [
    {
      rules: {
        "breaking-change-footer": ({ raw }) => {
          const bang = bangHeader.test(raw)
          return [
            bang === footer.test(raw),
            bang
              ? "a `!` subject needs a `BREAKING CHANGE: <how to migrate>` footer"
              : "a `BREAKING CHANGE:` footer needs a `!` before the subject's colon",
          ]
        },
      },
    },
  ],
  rules: {
    "header-max-length": [2, "always", 72],
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore"],
    ],
    "breaking-change-footer": [2, "always"],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
}
