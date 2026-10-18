# Architecture: close the quoted-`..` diff hole

**One regex change in `claude/hooks/ship.ts`, one test-list change in
`claude/hooks/ship.test.ts`.** No new module, no new export, no caller change:
the writer's `mayRun` in `claude/hooks/register.tsx` keeps pointing at
`READ_ONLY_GIT`.

**Mechanism: a second negative lookahead after `^git `, refusing `diff` when a
`"`, `'` or `\` appears anywhere after it** — e.g. `(?!diff\b.*["'\\])`. `.`
stops at a newline, which is already refused by every branch, so the scan covers
the whole command. It sits beside the existing `diff` path lookahead; `log`,
`show` and the rest never reach it, so their quote handling is untouched.

**The existing path lookahead stays as is.** Its quote-transparent pieces become
dead for `diff` but harmless; trimming them is optional and must not change any
listed `ok`/`bad` result.

**`diff\b` also matches `diff-tree`/`diff-files`** (word boundary before `-`):
those get the quote ban too. Accepted — stricter, and no listed `ok` case uses
them.

## Interfaces

```ts
// claude/hooks/ship.ts — signature unchanged, behaviour narrowed:
// any `git diff…` command containing `"`, `'` or `\` is now refused.
export const READ_ONLY_GIT: RegExp
```

## Call Stacks

- writer agent Bash call → `register.tsx` writer `mayRun` →
  `READ_ONLY_GIT.test(command)` → refuse / allow

## E2E Scenarios

No e2e change. The guard is a pure regex already pinned by its unit test; the
writer's wiring to `mayRun` is unchanged.

## Unit Tests

### READ_ONLY_GIT

- unit: claude/hooks/ship.test.ts — `the writer may only read git` refuses
  `git diff '.'./x README.md` (covers 1)
- unit: claude/hooks/ship.test.ts — refuses `git diff .\./x README.md`
  (covers 1)
- unit: claude/hooks/ship.test.ts — refuses `git diff ."."/x y` (covers 1)
- unit: claude/hooks/ship.test.ts — refuses `git diff x/.\./.\./y z` (covers 1)
- unit: claude/hooks/ship.test.ts — every existing `bad` entry stays refused,
  incl. `git diff ''--output=x`, `git diff --stat '/etc/hosts' /dev/null`,
  `git diff ".."/x y` (covers 1)
- unit: claude/hooks/ship.test.ts — every existing `ok` entry stays accepted:
  `git diff --stat a..b`, `git diff HEAD~1 -- src/x.ts`,
  `git diff a...b -- docs/`, `git log --format='%h %s'`,
  `git log --format="%H%n%B" a..b` (covers 1)

### Chores

- chore: claude/hooks/ship.ts — replace the comment line "Quotes and backslashes
  are transparent to the flag check" with one line: for `diff`, quotes and
  backslashes are refused outright because the `..` path check cannot see
  through shell quoting; keep transparency stated for the other subcommands'
  flag check (covers 1)

## Answered Questions

### Is losing `git diff` on a pathspec that needs quoting (spaces, special characters) acceptable?

Yes — the human ruled "refuse outright"; the writer only summarises commits and
needs `--stat`/ref ranges, never a quoted path.

### Should the quote ban use a separate lookahead rather than folding into the existing `diff` path check?

Separate lookahead — smallest diff, keeps `READ_ONLY_GIT` a single exported
`RegExp`, and leaves the path check's existing refusals untouched.

### Should `git diff-tree`/`diff-files` be exempt from the quote ban?

No — `diff\b` catching them is stricter, costs no listed `ok` case, and the
writer has no need for quoted arguments there.
