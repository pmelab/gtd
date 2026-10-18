## correctness: merged slice names cannot actually be reused

`restacked` now adds merged slice names to `gtdStackRetired` so that
`takenSlice` lets a later stack reuse them, and `docs/driver.md` promises "A
merged slice's name may be reused by a later stack". But `stackPrecheck` runs
`prStateRefusal` right after `takenSlice`. `gh pr view <branch>-<name>` still
returns the slice's old MERGED pull request, so the fresh stack is refused
anyway ("is MERGED, not open").

The suite already pins that refusal: the
`a %s slice PR refuses before the history push` test with `MERGED`. The new test
`a fresh stack with a dead record may reuse a merged slice's name` passes only
because `sbase` mocks `gh pr view feat/x-refactor` as `noPr`. A real merged
slice never looks like that, so this is mock/live drift.

Fix one of two ways:

- Make `prStateRefusal` skip, or treat as new, any group whose name is in the
  retired set and whose PR is MERGED into the default branch. Then a new PR is
  created and the old branch is force-pushed on purpose.
- Or drop the doc sentence and the merged-name write to `gtdStackRetired`.

Either way, the reuse test must script the MERGED view that a live repository
returns.

## correctness: the persisted lease turns "pull or reconcile" into a dead end

`pushBranch` uses the stored `branch.<b>.gtdLease` until a push succeeds. After
a rejected restack push, the failure text still says "Pull or reconcile <b>,
then ship". Suppose the user does exactly that and merges origin's collaborator
commit into the local branch. The retry still leases on the pre-restack sha,
which origin no longer has, so the push is rejected every time. The only way out
is the appended hint, which is worded as "overwrite origin's copy on purpose".
That is wrong here: after the reconcile, nothing would be overwritten.

Fix: before pushing, accept the stored lease as satisfied when origin's current
sha (`ls-remote`, not the tracking ref) is an ancestor of the commit being
pushed. Then a reconciled branch pushes with that sha as its lease and the key
is cleared. Add a test for the reconcile-then-ship path. The current test
`a rejected top push, then a ship after a fetch …` covers only the un-reconciled
case.

## correctness: Nit: stale retired names survive a fresh stack over a stale live record

In `ship()`, `gtdStackRetired` is now cleared only when `!live.length`. When a
fresh stack is recorded over a stale live record, `forget` is false and `live`
is non-empty. So old retired names (for example merged names a past restack
wrote) carry over into the new stack's lifetime. Before this change they were
cleared on PR success.

The effect is small: `takenSlice` stays lenient for those names. But it
contradicts the comment "A stale retired record must not take a stack this ship
just recorded with it". Fix: clear the key whenever this ship wrote a new
record, meaning `land` recorded a stack. Do not tie it to the pre-squash `live`.
