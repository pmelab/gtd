## correctness: live-stack refusal's remedy leads into a second refusal

`stackPrecheck` (claude/hooks/ship.ts) now refuses a fresh multi-slice stack
ship over a live `gtdStack` record and tells the user to unset `gtdStack` and
`gtdStackTop`, then ship again. The same change dropped the "recorded names are
not a collision" skip from `takenSlice`. So when the new process has the same
slice names as the recorded stack (the exact case the new test uses: record
`refactor feature`), following the advice makes the next ship hit `takenSlice`:
"Branch feat/x-refactor (slice refactor) already exists and is not part of a
stack gtd built", since the old slice branch still exists locally and on origin.
That message is wrong (gtd did build it), and the only way out it offers is
deleting a branch that may still back an open PR. Fix one of these: make the
refusal text name that step too (delete or rename the `<branch>-<slice>`
branches), or let `takenSlice` ignore names in the retired record or the old
`gtdStackTop` chain. Also add a test that follows the remedy: unset both keys,
keep `refs/heads/feat/x-refactor`, ship, and assert the result.

## correctness: "Nothing was pushed." is false once the history ref went out

`pullRequest` and `shipLink` now refuse on a failed `gh pr view` with "...
Nothing was pushed." These calls run after `squash()`, which has already
force-pushed `refs/gtd/history/<entry>` through `pushHistory` and squashed
locally. When a history entry exists, the message is untrue. The retry still
resumes, because the next `gtd summary` probe finds no process at HEAD, so
nothing is lost. Say what actually happened instead, e.g. "<branch> was not
pushed; the squash and history ref stay; /gtd ship retries." The single-slice
test ("the squash stays, nothing is pushed or opened") uses a fixture with no
history entry, so it does not cover this.

## correctness: since-head floor turns a main merge into a whole-branch re-weigh

`sinceHead` now accepts the synced head only when it descends from `mergeBase`.
That fixes the stacked case its test covers (synced head below the lower slice's
commit). But on a single branch where the author merged the default branch in,
`merge-base main HEAD` moves to main's tip, which the old synced head does not
contain. Every refresh after that falls back to `mergeBase..HEAD`, and
`updatePr` gives the model every commit on the branch as "commits added since it
was last considered". Consider keeping the synced head and excluding the floor
instead: `rev-list --count ${since}..${to} ^${mergeBase}` (same for the log).
That covers both cases. Add a test for a synced head that is an ancestor of HEAD
but not of the new merge base after a main merge.

## correctness: gh "no pull requests found" match has no live check (mock/live drift)

`viewPr` now treats a failed `gh pr view` as "no PR" only when stderr contains
`no pull requests found`. Every fake in `ship.test.ts` was edited to emit that
exact string, but nothing checks it against the real `gh`. If gh rewords that
line, every first ship of a branch refuses with "gh pr view … failed". Today's
gh does print `no pull requests found for branch "<b>"`, so this works now. Pin
the dependency where it lives: one shared constant used by both the code and the
fakes, and a comment naming the gh source of the string. Or add a `@live`
scenario that runs real `gh pr view` on a branch with no PR, if one can run
offline. No such scenario can, so at least keep the string in one place.

## correctness: Consider: refuse a non-open PR before pushing, now that the view comes first

`pullRequest` reads `existing` before `pushBranch`, but it still checks
`existing.state !== "OPEN"` only after the push. A ship onto a branch whose PR
is MERGED or CLOSED force-pushes the rewritten branch, then refuses. The view is
now available before the push, so move the state check above `pushBranch`. That
makes the refusal side-effect free, like the new `gh pr view` refusal.
`sliceStep` has the same order after `pushLink`, but there `stackPrecheck` /
`mergedSlices` already refuse non-open PRs earlier, so only the single-branch
path is affected.

## test-audit: since-head floor test pins the main-merge re-weigh

`a synced head not above the merge base falls back to it`
(claude/hooks/ship.test.ts) scripts `merge-base --is-ancestor M S` as false and
asserts the count runs over `M..HEAD`. On a single branch that state is exactly
"the author merged main in" (see the correctness chunk on the since-head floor),
so the test locks in the whole-branch re-weigh as intended behaviour. If the
floor moves to `S..HEAD ^M`, change this test to assert that range instead. Keep
the stacked upper-slice test as the owner of the "synced head below the lower
commit" case.

## test-audit: renamed garbled-JSON test says the opposite of what it asserts

`a real single-branch ship names the branch, pushes and edits nothing` now
asserts that no `git push` ran. "pushes and edits nothing" reads as "it pushes".
Rename it to `... names the branch, pushes nothing and edits nothing`, to match
its dry-run sibling (`... pushes nothing`).

## test-audit: Consider: "no pull requests found" test duplicates the base fixture

`stderr naming no pull request opens one as before` overrides `view("feat/x")`
with the same `no pull requests found` stderr that the shared `feature` fixture
now scripts. So every existing single-branch create test already proves this
path, and the test adds nothing. Either drop it, or make it the one owner by
giving the shared fixtures a `noPr(branch)` helper (it is defined only inside
this describe; sbase, feature and the missing-branch fixture each inline the
literal). That also keeps the gh string in one place for the correctness drift
chunk.

## conventions: Consider: new ship refusals have unit tests only, no scenario

AGENTS.md: "create cucumber.js scenarios for each new feature, tagged `@inmem`".
The change adds two user-visible refusals, both documented in docs/driver.md: a
fresh multi-slice stack ship over a live `gtdStack` record, and a `gh pr view`
failure other than "no pull requests found". Both are covered only by vitest
cases in claude/hooks/ship.test.ts. Nothing under `claude/` has a `.feature`
harness today, and these are guards on an existing command, not a new feature,
so this is weak. If the mod's ship behaviour is meant to fall under the rule,
add `@inmem` scenarios for the two refusals. Otherwise leave it.

## spec-challenge: "refuse any live record" contradicts ship's own stale-record rule

Decision (REQUIREMENTS concern 2, Answered Question "Does 'live recorded stack'
include a stale record…? Yes"): `stackPrecheck` refuses a fresh multi-slice
stack ship whenever `branch.<branch>.gtdStack` holds a name, with no staleness
check.

Invariant it conflicts with: ship already decides when a record is dead and
drops it on its own. `resumable` (claude/hooks/ship.ts) forgets the record when
it no longer chains to HEAD or when `topGuard` sees HEAD lost the recorded top
(`rebased`), and `docs/driver.md` promises "a rebase ends the stack: ship then
ships the branch alone". Nothing else clears `gtdStack` after a successful stack
ship: `forgetStack` runs only on a `forget` path (commits mode, a single landed
group, or that stale check), and the stale check is only reached by the
single-slice and no-process paths. The multi-slice path now refuses before any
such check.

Effect: the normal lifecycle (ship a stack, merge its PRs, rebase onto main or
keep working, finish a new multi-slice process, ship) refuses every time, even
though the record is provably dead by ship's own rule. Before this change that
case overwrote the record, which was right for a dead record. The user has to
unset the config by hand. Then, because `takenSlice` lost its skip, they hit the
collision refusal from the first correctness chunk when slice names repeat.

Fix: in `stackPrecheck`, run the same stale test `resumable` uses (all-but-top
slices MERGED, or `topGuard`/`chain` say the record no longer chains to HEAD).
Refuse only a record that is still live by that test, and let a dead one be
forgotten (or retired) the way the single-slice path already does it. Add a
test: record set, recorded top not an ancestor of HEAD, two landed slices, stack
mode. Assert it ships a fresh stack. Update the driver.md sentence to say "a
still-live recorded stack".
