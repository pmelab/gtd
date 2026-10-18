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

## ponytail-review: a follow-up process on a branch whose bottom PR merged can never ship as a stack

What this change does: `/gtd ship` now squashes a finished process into one
commit per slice and, by default, opens one stacked pull request per slice on
`<branch>-<slice>` branches. Load assumed: one person shipping one branch at a
time. (The earlier chunks' findings are not repeated here.)

1. **Should fix — merged bottom slice blocks every later stack ship**
   (`claude/hooks/ship.ts` `stackPrecheck` L450-456)
   - **What this is:** before anything changes, the precheck reads the PR of
     every slice branch (`gh pr view <branch>-<slice>`) and refuses unless it is
     open.
   - **Problem:** slice names come from the workflow (`build`, …), so a second
     process on the same branch reuses them. The normal flow merges the bottom
     PR first. `gh pr view <branch>` with a branch name also finds merged PRs,
     so after that merge every multi-slice follow-up process on the branch hits
     "The pull request for slice build (#N, …) is MERGED, not open; nothing
     changed". Nothing the user can do on that branch changes the answer, and
     the message names no way out (`GTD_SHIP_MODE=commits` would skip the check,
     but nobody is told).
   - **Fix:** when a lower slice's PR is MERGED and its recorded branch commit
     is already an ancestor of `baseRef`, treat that slice as done: drop it from
     the links and let the next slice target the default branch. Smallest
     version: at least say in the refusal how to proceed. Add a test: a fresh
     two-slice process, recorded stack, lower PR MERGED.
   - **If we skip it:** the stack mode works for exactly one process per branch;
     review follow-ups have to move to a new branch by hand.

2. **Nice to have — `pullRequest` is a wrapper that only drops a field**
   (`claude/hooks/ship.ts` L740-750)
   - **What this is:** `pullRequest` calls `pullRequestOf` and returns
     `{ ok, text }`.
   - **Problem:** `Shipped` already accepts the extra `number` field, and
     `pullRequestOf` has no other caller. It is one extra function to read.
   - **Fix:** delete `pullRequest`, rename `pullRequestOf` to `pullRequest`.
   - **If we skip it:** nothing breaks; 10 lines stay.

Verdict: fix 1 first (with the earlier chunks' must-fixes). Lean: -10 lines
possible. Not checked: `gh pr view <branch>` returning merged PRs was taken from
gh's documented branch lookup, not run against GitHub.

## test-audit: the resume test makes up the state the first run should have left

`ship stack` ›
`an upper push failing keeps the squash, reports, and a second run resumes`
(ship.test.ts L1036-1068) runs `ship` twice, but the second run does not start
from what the first run wrote. It scripts the state itself:

- It sets `git config --local --get branch.feat/x.gtdStack` → `refactor feature`
  and `refs/heads/feat/x-refactor` → C1. Nothing checks that the first run wrote
  them before its first push. `branches each slice…` (L910) checks only that
  `git branch -f` and `git config` ran at some point, never that they ran before
  `git push --set-upstream origin feat/x-refactor`. If `recordStack` moved after
  `stackPullRequests` (so the record is written only on success), every test
  still passes, but a real part-way failure would leave nothing to resume from.
  Then the retry ships one PR into main, the same silent stack drop the
  correctness chunk describes.
- It inherits `origin/feat/x-refactor` → missing from `sbase`, although the
  first run pushed that branch. So the second run pushes the lower slice
  `--set-upstream` again, and the test does not notice. The case that matters is
  never exercised: on resume, the lower branch is already on origin at C1, and
  the resume must not push it.
- Fix:
  - In the first run, check that `git config --local … gtdStack` and
    `git branch -f feat/x-refactor C1` come before the first `git push`.
  - In the second run, script `origin/feat/x-refactor` as existing, with
    `git merge-base --is-ancestor C1 origin/feat/x-refactor` → 0. Check that no
    push of `feat/x-refactor` happens.
  - The missing-branch and merged-lower cases from the correctness chunks need
    their own resume tests. Today the only resume-failure test,
    `a recorded stack that no longer chains…`, covers only the ancestry check.
    The `!sha` path, where an upper branch ref is missing, has no test.

## test-audit: a vacuous check in the `.gtd/`-only fold test

`ship per slice` › `a .gtd/-only second slice folds into the first…` (L705)
checks `ran().some(c => /^git push .*refs\/heads/.test(c))` is false. No push in
ship ever names `refs/heads/`. `pushBranch` pushes `origin <branch>` /
`--set-upstream origin <branch>`. So this check passes even if the fold wrongly
builds a stack. The rest of the test catches the main regression (one
`git commit`, no `commit-tree`), but the "no slice branch" part proves nothing.
Replace it with checks that nothing runs `git branch -f`,
`git push --set-upstream origin feat/x-refactor` or
`gh pr view feat/x-refactor`.

## test-audit: a commits-mode test pins the stale-record bug

`ship stack` › `commits mode builds no slice branches` (L1116-1124) checks
`ran().some(c => c.includes(KEY))` is false: commits mode never touches
`branch.feat/x.gtdStack` at all, not even to clear it. The correctness FYI chunk
says commits mode should unset a stale record. This test would then fail for the
right fix. Narrow it to "no `git branch -f`, no
`git config --local <KEY> <names>` set". An `--unset` should still pass.

## test-audit: guarded failure paths with no test that fails when the guard is removed

Each of these is a guard in this change. Deleting it fails no test (reasoned,
not mutation-run):

- `stackPullRequests` L593-594: the stop when the PR number cannot be read from
  `gh pr create`'s reply. Without it, `below` stays `undefined`, and `stackLine`
  quietly removes the "Stacked on" line from the upper PR. That PR is then
  published with nothing saying it depends on the one below. Test: the lower
  `create(...)` replies `out: "created\n"` (no `/pull/N`), and the ship fails at
  "pull request" with no `gh pr create` for `feat/x`.
- `commitChain` L665-677: a `git stripspace` or `git commit-tree` failure, or an
  empty `commit-tree` output. The scripted repo answers unscripted calls with
  `code 0, out ""`. So if the `!prev` check is dropped, the run goes on to
  `git reset --soft ""`, and nothing catches it. Test: second `commit-tree` with
  `code: 1`, then check that no `git reset`, `git branch -f` or `gh` call runs.
  This is the one place the "every commit exists before any ref moves" comment
  is actually enforced.
- `sliceStep` L551-557: a failed retarget (`gh pr edit --base` exits non-zero).
  Nothing checks that the ship stops at "retarget" before `updatePr` edits the
  body.
- `recordStack` L397/L399: a failed `git config` or `git branch -f`. This is the
  untested path the correctness chunk names. Listed here only so the fix comes
  with its test.

## test-audit (FYI): `GTD_SHIP_MODE` wiring has no test

`register.tsx` L596 is the only place `GTD_SHIP_MODE` reaches `ship`. Every mode
test calls `ship(io, isDry, "commits")` directly. If the
`await $.env.get("GTD_SHIP_MODE")` argument were dropped, commits mode could no
longer be reached from the plugin, and every test would stay green.
`register.tsx` has no tests at all (older than this change), so this is FYI. A
small test that `shipNow` passes the env value through would close the gap, if a
harness for `$` exists or is worth adding.

## conventions: comments that restate the code, one of them wrong

AGENTS.md, Comments: "Keep a comment … only where it explains an important
decision or genuinely unclear code … Everything else (restatement of the code,
history, a 'what' with no 'why') gets deleted, not moved."

- `claude/hooks/ship.ts` L271, above `type Link`: "One PR of a stack: its
  branch, its squashed commit, and what it is stacked on." Only restates the
  fields, and `Link` has no "stacked on" field (`name`, `branch`, `commit`), so
  it is also wrong. Delete it.
- L278, "Either the finished process's landed groups, or the result that ends
  the ship early.": restates the union type below it. Delete it.
- L823-824, above `type Ctx`: "The commit range a PR describes. `stacked` PRs
  also carry the 'Stacked on' line, naming `below` …": restates the field names.
  Delete it.
- L1-4 module header, which this change rewrote: the new parenthetical "(one
  commit for a single slice, one per landed slice otherwise)" is a "what" that
  the code (`landed`, `squashOne`) already says, and "A port of the `ship` fish
  function" is history. Cut it down to the decision, or delete it.

## conventions (FYI): the new ship mode has no `@inmem` cucumber scenario

AGENTS.md, Testing: "create cucumber.js scenarios for each new feature, tagged
`@inmem`." Stacked ship and `GTD_SHIP_MODE` are a new user-facing feature, and
they are covered only by vitest in `claude/hooks/ship.test.ts`. There is
precedent: the Claude Code mod has no cucumber harness, and the old one-commit
ship had no scenario either. Add a scenario, or accept the mod as an exception
on purpose. Leaving it out unremarked is not the same as deciding.

## conventions (FYI): `docs/driver.md` still describes one commit message for `-n`

User CLAUDE.md: "always make sure every significant change is also reflected in
the readme". The README was updated, but the rewritten `/gtd ship` bullet in
`docs/driver.md` still says "`/gtd ship -n` prints the commit message and what
would happen to the pull request". A multi-slice dry run prints one message per
slice and one PR plan per slice. It also says "A subagent writes the commit
message (from `gtd summary`)", but each slice's message now comes from
`gtd summary --slice=<name>`. Change both to the plural.
