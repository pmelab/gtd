# Quality findings

## correctness: a deferred forget lets a stack-mode retry resume the stack the first attempt dropped

`claude/hooks/ship.ts` now keeps the stack record until the pull-request step
succeeds (`squashed.forget` → `forgetStack` after `opened.ok`). The squash
itself is not deferred, so a retry takes a different path from the first
attempt. Example: a stack `refactor feature` shipped earlier (record and
`feat/x-refactor` still there, lower PR open), then a new single-slice process
lands on top. First `/gtd ship` (stack mode, the default): `commitSquash` →
`forget: true` → `pullRequest` sees the PR on `feat/x-refactor` (`onSlice`),
retargets it to `main`, and then `updatePr` or the body edit in `unstack` fails.
The record stays. Retry: `gtd summary` now fails (already squashed), so `plan` →
`resumable`. Every slice branch exists, so `topGuard` never compares
`gtdStackTop` with HEAD, and `chain` is valid because the old slice commits are
still ancestors of HEAD. The old stack resumes, and `stackPullRequests` moves
the top PR back onto `feat/x-refactor` with a `Stacked on` line. Before this
change the record was unset at squash time, so a retry also shipped the branch
alone. The test "every branch present and HEAD moved: the chain check decides"
confirms that the recorded top is ignored when no branch is missing, and no test
covers a stack-mode retry after a failed single-squash PR step. Fix: when the
squash sets `forget`, move the record right away to a key that only
`pullRequest`'s `onSlice` reads and `resumable` ignores (for example
`branch.<b>.gtdStackRetired`), and unset that key after the PR step succeeds. Or
have `resumable` treat a recorded top that is not HEAD as stale. Add a test for
the retry.

## correctness: following the refusal's own advice leaves the top PR on a stale slice base

`topGuard`'s refusal, and `settle`'s refusal for a closed lower PR, both tell
the user to run `git config --local --unset branch.<b>.gtdStack` "to ship the
branch alone". With the record gone, `ship()` reads an empty `recorded`, so
`pullRequest` computes `onSlice = false`. The top PR then keeps its
`feat/x-<slice>` base and its stale `Stacked on #N` line. The new test "an
unrecorded non-default base is left alone" (case `["feat/x-refactor", ""]`) pins
exactly this result. So the documented way out of both refusals ships nothing to
the default branch. `GTD_SHIP_MODE=commits` does what the refusal promises: with
no process, `plan` returns `forget: true` before `resumable` runs, `pullRequest`
gets the record, retargets the PR, strips the line, and forgets the record only
after that succeeds. Point both refusal texts (and the matching sentence in
`docs/driver.md` about the unset) at `GTD_SHIP_MODE=commits` instead of the raw
unset.

## correctness: a failed names write after the top write leaves a top that matches no stack

`recordStack` writes `gtdStackTop` first and `gtdStack` second. If the second
write fails, the squash is undone with `reset --soft ORIG_HEAD`, but
`gtdStackTop` keeps the discarded commit. Any older `gtdStack` record stays
alongside it, so the old names now sit beside a new top. Today nothing harms the
retry: the process is back, so `gtd summary` succeeds and `resumable` is never
reached, and the next record overwrites the top. Still, `topGuard` treats "top
== HEAD" as permission to rebuild branches from `HEAD~n`, which depends on the
two keys describing the same stack. Nit: unset `gtdStackTop` in the undo branch,
or write the names first and the top last, so the two keys only ever exist as a
matched pair.

## owasp-security: the new refusal hands the agent a shell command built from the branch name (Low)

`topGuard`'s refusal (`claude/hooks/ship.ts:535`) repeats a pattern `settle`
already has. It interpolates `STACK_KEY(branch)` into a backticked
`git config --local --unset …` command and tells the reader to run it. Git
refnames may contain `$`, `(`, `)`, `;` and backticks, so a branch named
`x$(curl …|sh)` turns that advice into command substitution once it is pasted
into a shell. In the Claude mod, the reader is an agent that may run the advice
by itself (CWE-78, A05:2025, ASI05 Unexpected Code Execution). Every `io.run`
call takes an argv array, so ship itself never runs the name through a shell.
The path only exists when someone checks out a branch whose name someone else
chose, for example one caught from a handoff, so this is defense in depth with
no demonstrated exploit. Fix: the correctness chunk above already moves both
refusals to `GTD_SHIP_MODE=commits`, which removes the interpolated command. If
a command stays, single-quote the key (`'branch.<b>.gtdStack'`) or name the
command without the branch.

## ponytail-review: a PR GitHub already moved to the default branch keeps its stale "Stacked on" line

`pullRequest` in `claude/hooks/ship.ts` now strips the stack line only when
`onSlice` is true (`unstack`: `const body = onSlice ? stackLine(was) : was`).
Before this change it stripped the line from every existing PR. Case: a stack
`refactor feature` was shipped, and the lower PR #7 is merged with "delete
branch". GitHub then retargets the top PR #8 to `main` on its own. Now the
author ships again, either with `GTD_SHIP_MODE=commits` or with a new
single-slice process (one group, so `commitSquash` → `pullRequest`). The base is
`main`, so `onSlice` is false, the body is not edited, and `updatePr` (not
stacked) does not touch it either. PR #8 keeps "Stacked on #7 — merge that
first" for good, and the record is forgotten after this ship, so no later run
fixes it. No test covers an existing PR on the default branch with a stack line:
the old strip test and the new ones all use base `feat/x-refactor` or
`release/1`. Fix: strip on the default branch too —
`const body = onSlice || existing.baseRefName === baseBranch ? stackLine(was) : was`
— the line is gtd's own exact marker, so stripping it there harms nothing. Add
one test: base `main`, body `Stacked on #7 — merge that first\n\nstanding`,
commits mode, expect a `--body-file` edit with stdin `standing` and no `--base`
edit.

## test-audit: three new tests pin behaviour the earlier chunks call bugs

Fixing those chunks has to rewrite these tests. Until then the suite argues
against the fixes, so each test should change together with its fix.

- "an unrecorded non-default base is left alone" in `claude/hooks/ship.test.ts`,
  case `["feat/x-refactor", ""]`, asserts that a PR on a slice base with no
  record is neither retargeted nor stripped. That is the result of following the
  refusal's `--unset` advice (correctness chunk 2). With that fix the case
  either goes, or it states the intended outcome. The case loop also runs inside
  one `test` body, so a failure does not say which pair broke. Use `test.each`.
- "a missing slice branch on resume › %s: refuses naming the branch and the
  unset" asserts `out.text` contains `git config --local --unset ${KEY}`. That
  is the advice that ships nothing (correctness chunk 2) and that interpolates
  the branch into a shell command (owasp chunk). Assert the replacement
  (`GTD_SHIP_MODE=commits`) instead. "a closed lower slice refuses a resume …
  names the unset" has the same problem.
- "a fresh stack records the top, then the names, then branches" fixes the order
  as top first, names second. Correctness chunk 3 asks for names first and top
  last. Both orders are call-shape details. The contract is "the two keys only
  exist as a matched pair", and no test checks it: "a failed git config puts the
  process back …" (names write fails) never asserts that `gtdStackTop` was unset
  or never written. Replace the order test with that failure case, and assert
  that no `git config --local ${TOP}` write survives without its `--unset`.

## test-audit: the fake git config has no state, so no test covers the retry that correctness chunk 1 found

`repo()` answers each argv from a fixed script. `git config --local --unset`
succeeds but changes nothing, and `--get` keeps returning the scripted record.
So every "kept" or "forgotten" assertion only checks whether a call was made,
and a two-run retry has to be re-scripted by hand (as in "a failed git branch -f
leaves a record that a second run rebuilds from HEAD"). The case that breaks is:
stack mode, single-slice `commitSquash`, the PR step fails, retry with every
slice branch present, the old chain still valid, and HEAD ≠ the recorded top. No
test covers it. "every branch present and HEAD moved: the chain check decides"
only scripts the _invalid_-chain variant, so it shows that `topGuard` ignores a
moved top when no branch is missing, and does not show that this is safe. Add
the valid-chain variant: first run fails at `gh pr edit 8 --body-file -` after
the retarget, second run with `gtd summary` failing, every branch present, `TOP`
≠ HEAD. Expect no `gh pr edit 8 --base feat/x-refactor` and no `Stacked on`
body. It fails on the current code, which is the point.

## test-audit: nits — a name that does not match what is exercised, and a weak order check

- "single-slice ship retargets off the record read before the unset" cannot
  observe _when_ `recorded` is read: the fake's `--get` returns the record
  before and after any `--unset`. Moving the `recorded` read below `squash()` in
  `ship()` passes every test, so the comment "Read before any squash" is the
  only guard. The test really checks "single-slice stack-mode ship defers the
  unset until after the retarget". Rename it to that, or drop it. It overlaps
  with "a single-slice ship unsets the stack record" plus "the record is unset
  only after the retarget, both keys".
- "the record is unset only after the retarget, both keys" compares
  `at(unset) > at("gh pr edit 8 --base main")` without checking that the edit
  index is `> -1`. With the retarget removed it passes on `x > -1`. A sibling
  test happens to cover that ("taking a PR off a stack with nothing new still
  succeeds"), but this assertion is vacuous alone. Add the `> -1` guard that the
  single-slice test already has. It also checks the `TOP` unset only by
  `toContain`, not by order.
- "a recorded stack that no longer chains is unset and the branch ships alone"
  still passes, but the unset now waits for the PR step. No test covers an
  invalid chain whose PR step then fails: the record must survive that, and the
  `io.log` line "dropped it" is then false. One case with
  `create("feat/x","main")` failing would cover both the record and the wording.

## conventions: two new comments only restate what the code does

AGENTS.md, "Comments": "Keep a comment … only where it explains an important
decision or genuinely unclear code … Everything else (restatement of the code,
history, a "what" with no "why") gets deleted, not moved."

- `unstack` in `claude/hooks/ship.ts`: "Aims a PR off a slice branch and drops
  its stale stack line. Returns a failure, or whether it changed anything and
  the body to keep." The first sentence is the body read aloud. The second one
  describes the return type, which the code already shows. No decision is
  recorded. Delete the comment. The "why" (only a slice base is gtd's to move)
  already sits at the `onSlice` line in `pullRequest`.
- `resumable`'s new sentence "`forget` asks ship to drop a stale record once its
  PR step succeeded" repeats the field name and the
  `if (opened.ok && squashed.forget)` line in `ship()`. Drop it, and keep "A
  string is a refusal", which the return type does not say.

Nit, non-blocking.

## conventions: the new ship behaviours get no `@inmem` scenario

AGENTS.md, "Testing": "create cucumber.js scenarios for each new feature, tagged
`@inmem`." This change adds behaviour a user can see. A missing slice branch is
now refused unless HEAD is the recorded `gtdStackTop`. Only a PR on a recorded
slice base is retargeted, so a PR on any other base keeps that base. A thrown
draft in a stack is retargeted before it is marked ready. All of it is covered
only by vitest cases in `claude/hooks/ship.test.ts`, and no `.feature` file
covers `/gtd ship` at all. `claude/` has no feature harness, and the original
ship commit (`6230714`) added none, so this inherits the gap rather than opening
it. Still, the rule has no exception for `claude/`. Either add an `@inmem`
scenario for the top-guard refusal, the case most likely to surprise a user, or
record in TODO.md that the mod's ship flow is deliberately left to unit tests.
Non-blocking.

## spec-challenge: "a rebase merge keeps the stack clean" is false on GitHub

Concern 5 of the requirements, carried into package 02, has `docs/driver.md`
(line ~407) say "a rebase merge or merge commit keeps the stack clean". GitHub's
"Rebase and merge" always re-creates the commits with new SHAs on the base
branch, just as a squash does. The upper slice's branch still holds the lower
slice's original commit. Its merge-base with the default branch stays the old
base, so its pull request shows the lower slice's changes again, the same
symptom the sentence warns about for a squash merge. Only a merge commit keeps
the lower commit's SHA on the default branch. Fix: say "only a merge commit
keeps the stack clean" and treat a rebase merge like a squash merge.

## spec-challenge: the doc's "rebased or resumed" way out conflicts with what a resume does and with the chain check

The same caveat says the PR above a squash-merged slice shows that slice's
changes "until it is rebased or resumed". Neither path does what the sentence
promises:

- **Resumed:** `settle` only drops merged slices and passes `floor` (the merged
  slice's old commit) to `stackPullRequests`, where it sets the description
  range. Nothing rebases or pushes a rewritten branch, so the upper PR's diff
  against the default branch still holds the lower slice's changes. The resume
  fixes the base and the description, not the diff
- **Rebased:** rebasing the top onto the default branch moves HEAD. Resume
  depends on the recorded slice branches still chaining to HEAD (`chain`) and,
  after this change, on HEAD being `gtdStackTop` whenever a branch is missing
  (`topGuard`). After the rebase, a 3+-slice stack with a remaining middle slice
  fails the chain check. Ship then drops the record and ships the branch alone,
  so the middle slice's PR stays open and its changes land in the top PR. If the
  merged slice's local branch was deleted (`gh pr merge --delete-branch` deletes
  it), ship refuses outright

The documented recovery therefore conflicts with the stack-record invariants
this change tightens. Fix: say the upper PR shows the lower slice's changes
until its branch is rebased onto the default branch, and that a rebase ends the
stack (ship then ships the branch alone). Or drop "or resumed" and say that only
a merge commit keeps the stack clean. Doc-only, but it is the one place a user
learns which merge method to pick.
