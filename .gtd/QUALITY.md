# Quality findings

## correctness: a branch rebased after its lower slice merged is now refused instead of shipped

`claude/hooks/ship.ts` `topGuard` sets
`what = "A merged slice's commit cannot be found"` whenever `from > 0`, so ANY
resume with a merged lower slice requires the recorded top (`gtdStackTop`) to be
an ancestor of HEAD, even when no slice branch is missing. The common follow-up
to merging the bottom PR is `git rebase main`: a one-commit slice squash-merged
upstream is patch-identical, so the rebase drops it and rewrites the top, and
the recorded top is no longer in HEAD. That path now returns "A merged slice's
commit cannot be found and HEAD no longer contains the recorded top of the
stack; nothing changed", both in the no-process resume (`plan` →
`resumable(…, "HEAD")`) and in the new one-slice squash (`stackReads` →
`resumable(…, base)`). Before this change the same repo went through `chain`:
the lower branch no longer chained to HEAD, so the record was dropped and the
branch shipped alone, with the PR moved back to the default branch. A one-slice
stack-mode ship used to always drop the record. So a normal "merge bottom,
rebase, ship" flow now needs a manual `GTD_SHIP_MODE=commits`. And when the
rebase leaves no upper branches to check (`done === last`), `chain`'s loop is
empty and `valid` stays `true`, so the only rebase check left is this refusal.
Fix: refuse only when an unmerged slice branch is missing. When only the merged
floor needs the top and HEAD no longer contains it, either fall back to
`merge-base` (leave `floor` undefined) or take the existing "no longer chains →
ship alone" path. Add a test with `MERGED` lower, branches present, and
`merge-base --is-ancestor <top> HEAD` failing. No test covers that combination
today: "a recorded top that is not an ancestor of HEAD refuses" uses
`lowerGone`, an unmerged missing branch.

## correctness: a non-open top PR on a resumed stack names a remedy that also fails

`mergedSlices` gives the same refusal for every non-open PR at or above `done`,
the top branch included: "…a closed one needs GTD_SHIP_MODE=commits to ship the
branch alone." For the top slice (`i === last`, the branch itself) that advice
is wrong. Commits mode reaches `pullRequest`, which refuses again ("The pull
request for <branch> is MERGED, not open"). `docs/driver.md` and `stackPrecheck`
both say a merged or closed top PR needs a renamed branch. The wording is the
same as the deleted `settle`, but `settle` only ran on the no-process resume.
`mergedSlices` now also runs on every one-slice stack-mode ship with a recorded
stack, which before this change dropped the record and reported the accurate
`pullRequest` refusal. Fix: branch the text on `i === last`, as `stackPrecheck`
does ("Rename the branch").

## correctness: the new git and gh semantics are checked only against a scripted io, with no live contract

The ship tests' `repo` answers every unscripted argv with exit 0 and empty
output. Each new behaviour is asserted only as an exact argv string:

- the floor and missing-branch fallbacks read `<top>~n` and assume the recorded
  top is the last slice commit of a one-commit-per-slice first-parent chain
- `topGuard` now uses `merge-base --is-ancestor <top> HEAD`
- `pullRequest` and `preview` now call `gh pr view <branch>` where they used to
  call bare `gh pr view`

Nothing runs these against a real repository or `gh`. Bare `gh pr view` resolves
the PR through the branch's upstream/push configuration. `gh pr view <name>`
matches any PR whose head ref has that name, so in a fork setup it can find a
different PR than before. That PR is then edited (retargeted, body rewritten) or
wrongly read as `MERGED`/`CLOSED`. A wrong `~n` count, for example after a
`.gtd/`-only slice folds or an extra commit lands between slices, would pass the
suite unchanged. Consider adding a small real-git test of the `<top>~n` floor
and revive, and pinning the `gh pr view <branch>` choice (or passing
`OWNER:BRANCH`) with a comment on why the branch argument is safe.
