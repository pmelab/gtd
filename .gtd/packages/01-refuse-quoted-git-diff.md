# 01 — refuse quoted `git diff` in the writer's read-only guard

## Requirement

1. **Close the quoted-`..` diff hole: any `git diff…` command containing `"`,
   `'` or `\` is refused by `READ_ONLY_GIT`.** Shell quoting must no longer
   smuggle a `..` path past the `diff` path check. `log`, `show` and the other
   subcommands keep their current quote handling. `diff-tree`/`diff-files` get
   the ban too (`diff\b` matches them) — accepted.

See `.gtd/ARCHITECTURE.md`.

## Tasks

### Task 1: pin the new refusals and every existing result

Paths: `claude/hooks/ship.test.ts`

- [ ] `the writer may only read git` lists as `bad`:
      `git diff '.'./x README.md`, `git diff .\./x README.md`,
      `git diff ."."/x y`, `git diff x/.\./.\./y z`
- [ ] Every existing `bad` entry stays refused, incl. `git diff ''--output=x`,
      `git diff --stat '/etc/hosts' /dev/null`, `git diff ".."/x y`
- [ ] Every existing `ok` entry stays accepted: `git diff --stat a..b`,
      `git diff HEAD~1 -- src/x.ts`, `git diff a...b -- docs/`,
      `git log --format='%h %s'`, `git log --format="%H%n%B" a..b`
- [ ] New `bad` cases fail before the regex change

### Task 2: add the quote-ban lookahead

Paths: `claude/hooks/ship.ts`

- [ ] `READ_ONLY_GIT` gains a second negative lookahead after `^git `, e.g.
      `(?!diff\b.*["'\\])`, beside the existing `diff` path lookahead
- [ ] Existing path lookahead unchanged (any trim must not flip a listed
      `ok`/`bad` result)
- [ ] Export stays a single `RegExp`; `claude/hooks/register.tsx` writer
      `mayRun` untouched
- [ ] Task 1 tests pass

### Task 3: fix the stale comment

Paths: `claude/hooks/ship.ts`

- [ ] Replace "Quotes and backslashes are transparent to the flag check" with
      one line: for `diff`, quotes and backslashes are refused outright because
      the `..` path check cannot see through shell quoting; transparency still
      holds for the other subcommands' flag check

## Tests

- unit: `claude/hooks/ship.test.ts`
