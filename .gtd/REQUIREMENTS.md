# Requirements: review of 9aa2f63 — close the quoted-`..` diff hole

Source: human note on `.gtd/REVIEW.md` at `2a0f82cb` (footnote `[^diff-quotes]`
on the `./claude/hooks/ship.ts#1076-1083` risk row). Code in
`claude/hooks/ship.ts`, tests in `claude/hooks/ship.test.ts`.

## 1. `READ_ONLY_GIT` refuses any quote or backslash in a `git diff` command — TECHNICAL

(critical: security)

**Quoted or escaped `..` still lets ship's writer read files outside the
repository.** The writer reads untrusted commit messages, so this is a
read-outside-the-repo hole, not a nit. The `diff`-only lookahead refuses
absolute, `~` and `..` paths, but its `..` check is not quote-transparent. These
four pass today:

- `git diff '.'./x README.md`
- `git diff .\./x README.md`
- `git diff ."."/x y`
- `git diff x/.\./.\./y z`

git then falls back to no-index on its own:
`git diff --stat '.'./feat-381-naive-pass-slices/package.json package.json`
diffs a sibling worktree's file.

- **Must fix, not optional.** Refuse any `"`, `'` or `\` anywhere in a
  `git diff` command outright — no stripping-then-testing alternative
- Applies to `diff` only; `log`, `show` and the other allowed subcommands keep
  their current quote handling
- Every currently accepted `git diff` command without quotes or backslashes
  stays accepted (`git diff --stat a..b`, `git diff HEAD~1 -- src/x.ts`,
  `git diff a...b -- docs/`)
- Every currently refused command stays refused
- Add the four bypass strings above to the rejected (`bad`) list of the
  `READ_ONLY_GIT` test
