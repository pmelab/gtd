## correctness: a part-way `recordStack` failure is not resumable, despite saying so

`claude/hooks/ship.ts` `recordStack` (L389-403) writes `branch.<b>.gtdStack`
first, then `git branch -f` each upper slice. Both run after `commitChain`
already moved HEAD (`reset --soft`), so the process is gone from HEAD.

- `git branch -f` fails on slice 2 of 3: the text says "/gtd ship resumes". The
  retry has no process at HEAD, so it goes to `resumable`, which finds
  `refs/heads/<branch>-<slice2>` missing, sets `valid = false`, unsets the
  record and ships the whole branch as ONE pull request into the default branch.
  The stack is silently dropped.
- `git config` fails: nothing is recorded, so the retry also ships one PR, with
  no warning.

Every commit in the chain is on HEAD's first-parent line (`commitChain` builds
it that way), so `resumable` could get upper slice `i` from `HEAD~(n-1-i)`
instead of needing the branch refs. Or write the branch refs before the record
and have the retry rebuild any that are missing. No test covers either failure.
Add one where `git branch -f` fails, then a second run, and check that the
second run still opens a PR for every slice.

## correctness: a merged lower slice makes the resumed stack refuse forever, after re-pushing its branch

The normal workflow is to merge the bottom PR of a stack first. After that,
`/gtd ship` on the branch (no process at HEAD) goes to `resumable`, which still
lists the merged slice. `stackPullRequests` then runs, for that slice:

1. `pushBranch` (L586) runs first, with no state check. If GitHub deleted the
   merged head branch and `origin/<b>` was pruned, this `--set-upstream` push
   creates the merged branch on origin again.
2. `sliceStep` then sees `MERGED`, and the ship fails with "…not open … /gtd
   ship resumes". Every later run does the same, until someone runs
   `git config --unset branch.<b>.gtdStack` by hand, which no message tells
   them.

The refusal is reached only after the push. A fresh process runs `stackPrecheck`
before any side effect, but the resume path never does. Fix: on resume, check
each slice's PR state before pushing anything, and drop a merged lower slice
from the links (or refuse before any push, and name the `--unset` fix). Also add
a test where the lower slice is MERGED in the resume path.

## correctness: a dry run can still write: `resumable` unsets the stack record under `-n`

`plan` calls `resumable` whatever `isDry` is (L293). When the recorded stack no
longer chains, `resumable` runs `git config --local --unset branch.<b>.gtdStack`
(L485) and logs "dropped it". The docs say `/gtd ship -n` "writes nothing". The
dry-run test (`the dry run lists each slice…`) takes the process path, so this
is never checked. Pass `isDry` into `resumable` and skip the unset (and change
the log text) when it is set.

## correctness: multi-slice commits skip what `git commit` enforces on the single-slice path

A single slice is committed by `commitSquash` → `git commit --cleanup=strip`.
Several slices are committed by `commitChain` → `git stripspace` +
`git commit-tree`. Both write the same squash commits, but `commit-tree` is
plumbing. It ignores `commit.gpgSign` and runs no `commit-msg` or `post-commit`
hooks. In a repository that requires signed commits, or that checks messages
with a `commit-msg` hook, a one-slice ship meets those rules and a two-slice
ship does not. The pushed commits are then unsigned or unchecked, and branch
protection may reject them only after the history ref is pushed and HEAD has
moved. Pass `-S` when `commit.gpgSign` is true (or document the gap), or build
the chain with `git commit` (for example `reset --soft` to each base and commit
with `--allow-empty`).

## correctness: `gtd summary --slice=<name>` exit status is unchecked before a published commit

`commitMessages` (L255) uses `(await io.run(["gtd","summary",`--slice=…`])).out`
whatever the exit code. `gtd summary --slice` can refuse (exit 1): the config
was edited since the process closed, or the replay diverged. When it does, the
writer gets only `COMMIT_FORMAT` and makes up a message, which is committed and
pushed. The old code used the stdout of a successful `gtd summary` probe. Refuse
on a non-zero code, the same way the `gtd slices` failure does ("…; nothing
changed" plus stderr). Add a test for it.

## correctness (FYI): stale `gtdStack` record survives a commits-mode or second-process ship

- Commits mode never clears `branch.<b>.gtdStack`. Only the single-slice path
  unsets it, and a later stack-mode run with no process can pick up the old
  record. `resumable` mostly drops it because the ancestry check fails, but a
  multi-slice commits ship could clear the record too, the way `squashOne` does.
- A second process on a branch that already shipped as a stack has a first slice
  whose `base` is the old top commit. Its lowest new PR targets the default
  branch, but it carries every old stack commit too.

## owasp-security: the writer's "read-only git" guard allows writing files and moving branches

[HIGH] Arbitrary file write and ref moves through `READ_ONLY_GIT`
(CWE-78/CWE-73, OWASP A01:2025, LLM01 Prompt Injection, ASI02 Tool Misuse &
Exploitation)

- Location: `claude/hooks/ship.ts` L815-816 (`READ_ONLY_GIT`). It is the only
  limit on the shipper's Bash (`register.tsx` `subagentDenial`).
- Path: a commit message anyone on the branch wrote (or a PR body) → the
  `commitMessages` / `createPr` / `updatePr` writer prompt → an injected
  instruction → the Bash tool → the regex allows it.
- Commands the regex accepts (checked):
  - `git log -1 --format=%B <sha> --output=<path>` writes the attacker's commit
    message, verbatim, to any path. `--output` works on log, show and diff.
    Writing a git config with `core.fsmonitor = <cmd>` runs `<cmd>` on the next
    `git status`, and ship runs `git` right after the turn. That is code
    execution as the user.
  - `git branch -f <b> <sha>`, `git branch -D <b>`, `git branch -m`.
- The guard is older than this change. This change makes it matter more: there
  is now one commit-message turn and one PR turn per slice, all reading
  untrusted text, and the new `<branch>-<slice>` refs that resume trusts are
  exactly what `git branch -f` moves (see the next chunk).
- The doc text "the writer may run only read-only `git` commands" (driver.md) is
  not true today.
- Fix:
  - Refuse any argument starting with `--output` or `-o`.
  - Allow `branch` only with no args, or with `--list`, `-a`, `-r`,
    `--show-current`, `--contains`.
  - Add the bad cases to the `the writer may only read git` test:
    `git log --output=x`, `git diff --output=x`, `git branch -f a b`,
    `git branch -D a`.
- Confidence: Confirmed. The regex accepts all three commands, and
  `git log --format=%B --output=<file>` writes the message verbatim.

## owasp-security: a slice push sends the branch name, not the commit ship built

[MEDIUM] TOCTOU between the recorded commit and the pushed ref (CWE-367, OWASP
A08:2025)

- Location: `stackPullRequests` → `pushBranch(io, l.branch, l.commit)` (ship.ts
  L586, L790-811).
- `head` (the commit) is used only for the `--is-ancestor` check. The push
  itself is `git push … origin <l.branch>`, which sends whatever
  `refs/heads/<l.branch>` points at when the push runs.
- Path: in a stack of 3 or more slices, the slice-0 PR writer turn (injectable,
  as in the chunk above) runs `git branch -f <branch>-<slice1> <other sha>`.
  Then the slice-1 push sends that sha. On the first push (`--set-upstream`) a
  non-ancestor sha is still pushed. The PR text and `ctx.to` still describe
  `l.commit`, so the PR's description no longer matches the branch it was opened
  on. The top slice is safe, because git will not `branch -f` the checked-out
  branch.
- Impact: a contributor to the branch can get content published under a
  description written for different commits. A reviewer still sees the real
  diff, which limits the damage.
- Fix: push the commit explicitly, for example
  `git push [--force-with-lease=<b>:<expected>] origin <l.commit>:refs/heads/<b>`
  (and `--set-upstream` on the first push). Or check `rev-parse refs/heads/<b>`
  == `l.commit` right before the push. Fixing the guard in the chunk above also
  closes this path.
- Confidence: Likely. This depends on the injected `git branch -f` getting
  through, which the regex allows.
