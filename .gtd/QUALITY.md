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
