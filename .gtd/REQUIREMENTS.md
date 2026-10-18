# Requirements: review of 9aa2f63 — close the quoted-`..` diff hole

Source: human note on `.gtd/REVIEW.md` at `2a0f82cb` (footnote `[^diff-quotes]`
on the `./claude/hooks/ship.ts#1076-1083` risk row). Code in
`claude/hooks/ship.ts` (`READ_ONLY_GIT`, the writer's `mayRun` in
`claude/hooks/register.tsx`), tests in `claude/hooks/ship.test.ts`.

Baseline: `npm test` is green on `3568f9b8` (defaults, `naive_pass` on,
`risk_tier` on). No breakage concern leads.

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
- **Applies to `diff` only.** `log`, `show` and the other allowed subcommands
  keep their current quote handling: `git log --format='%h %s'` and
  `git log --format="%H%n%B" a..b` stay accepted
- **Every currently accepted `git diff` command without quotes or backslashes
  stays accepted:** `git diff --stat a..b`, `git diff HEAD~1 -- src/x.ts`,
  `git diff a...b -- docs/`
- **Every currently refused command stays refused** — the whole existing `bad`
  list, including `git diff ''--output=x`,
  `git diff --stat '/etc/hosts' /dev/null` and `git diff ".."/x y`
- **Add the four bypass strings above to the `bad` list** of the
  `the writer may only read git` test
- **Fix the comment above `READ_ONLY_GIT`:** it says quotes and backslashes are
  transparent; for `diff` they are now refused outright. State that in one line,
  with the reason (the `..` path check cannot see through shell quoting)

## Answered Questions

### Is losing `git diff` on a pathspec that needs quoting (spaces, special characters) acceptable?

Yes — the human ruled "refuse outright"; the writer only summarises commits and
needs `--stat`/ref ranges, never a quoted path.

### Should the quote ban use a separate lookahead rather than folding into the existing `diff` path check?

Implementer's call — any shape that keeps the regex a single `RegExp` exported
as `READ_ONLY_GIT` and passes the test list is acceptable.
