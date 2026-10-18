# Review: 2ce55fd

<!-- base: 90ede0c556e285c43f30f12afb7148cfef3850ff -->

No `.feature` scenario changed in this range; every behaviour is pinned by unit
tests in `claude/hooks/ship.test.ts`.

## A failing `gh pr view` refuses instead of reading as "no PR"

**Only gh's "no pull requests found" stderr now means no PR; any other failure
(auth, network) refuses.** Before, any non-zero exit read as "no PR", so ship
could open a duplicate pull request. **Every PR read now runs before that step's
push**, so a refusal leaves the branch unpushed.

- [ ] ./claude/hooks/ship.ts#528-551 — `NO_PR_FOUND` exported as the one stderr
      that means "none"; any other non-zero exit returns a refusal string naming
      the branch and gh's stderr. **Matching is on English stderr text: a gh
      release that rewords it turns every first ship into a refusal.** Fails
      safe (refuses, never duplicates).
- [ ] ./claude/hooks/ship.ts#1079-1092 — single-branch ship: PR read and the
      not-open check moved ahead of `pushBranch`; refusal now says the branch
      was not pushed and the squash and history ref stay.
- [ ] ./claude/hooks/ship.ts#821-847 — new `shipLink` holds one slice's steps:
      read its PR, refuse before the push, push, then create/update. Nine
      positional parameters; an options object would read better.
- [ ] ./claude/hooks/ship.ts#866-875 — `stackPullRequests` loop shrinks to a
      `shipLink` call; failure message and "Landed:" list unchanged.
- [ ] ./claude/hooks/ship.ts#783-797 — `sliceStep` takes the already-read `view`
      instead of reading it again.
- [ ] ./claude/hooks/ship.ts#748-766 — stack dry-run preview returns a refusal
      on a failed read instead of printing "would open".
- [ ] ./claude/hooks/ship.ts#197-201 — `ship` turns that preview refusal into a
      failed result.
- [ ] ./claude/hooks/ship.test.ts#1125-1223 — pins the refusal for
      single-branch, fresh stack, dry run, resumed stack, single-slice process
      (squash kept, nothing pushed), upper slice after lower landed (upper never
      pushed), read-before-push ordering, and a dry run never saying "would
      open".
- [ ] ./claude/hooks/ship.test.ts#1979-1984 — garbled JSON reply now pushes
      nothing (was: pushed, then refused).
- [ ] ./claude/hooks/ship.test.ts#16-18 — `noPr` helper scripts the real "no PR"
      stderr.
- [ ] ./claude/hooks/ship.test.ts#72-72 — base fixture switched to `noPr`.
- [ ] ./claude/hooks/ship.test.ts#960-961 — stack fixture switched to `noPr`.
- [ ] ./claude/hooks/ship.test.ts#1447-1447 — resume fixture switched to `noPr`.

## A fresh multi-slice ship refuses over a live recorded stack

**A fresh stack ship on a branch whose `gtdStack` record still chains to HEAD
now refuses before any write**, naming `GTD_SHIP_MODE=commits` or the two
`git config --unset` commands plus deleting/renaming slice branches. A record
that no longer chains is treated as dead and shipped over. Before, any recorded
name simply bypassed the collision check.

- [ ] ./claude/hooks/ship.ts#567-581 — Risk: **`recordedRefusal` reuses
      `resumable`, whose own refusals fire before the staleness test, so some
      dead records refuse instead of being dropped.** `topGuard` refuses when a
      slice branch is missing and HEAD lacks the recorded top, and
      `mergedSlices` refuses on a closed recorded slice PR before chaining is
      even checked; a dead record hitting either now fails the fresh ship where
      it shipped before. Contradicts docs/driver.md "a record that no longer
      chains to HEAD is dropped, not refused". No test covers either case. Fix:
      treat those `resumable` refusals as dead (or test chaining first) inside
      `recordedRefusal`.
- [ ] ./claude/hooks/ship.ts#553-565 — `takenSlice` skips only names of the dead
      record passed in, instead of reading the record itself.
- [ ] ./claude/hooks/ship.ts#583-598 — PR-state loop split out of
      `stackPrecheck` unchanged as `prStateRefusal`.
- [ ] ./claude/hooks/ship.ts#600-616 — `stackPrecheck` now runs live-record
      refusal, then collision check, then PR states. **Each recorded slice's PR
      is now read twice before the push and a third time in `shipLink`** — extra
      gh round trips, not a defect.
- [ ] ./claude/hooks/ship.test.ts#1056-1123 — replaces the old "a branch named
      in gtdStack is not a collision" test: live record refuses (real and dry
      run), dead record ships over, post-remedy old branch is a collision,
      retired record alone never refuses, commits mode still ships one PR.
- [ ] ./docs/driver.md#405-410 — documents the live-stack refusal, its remedy,
      and the `gh pr view` refusal.

## PR update range floors at the merge base

**`updatePr` adds `^<merge base>` to the commit count and commit log**, so a
stored sync head from before a main merge no longer re-counts commits that merge
brought in.

- [ ] ./claude/hooks/ship.ts#1296-1298 — count range gains `^mergeBase`.
- [ ] ./claude/hooks/ship.ts#1332-1332 — log fed to the model gets the same
      floor.
- [ ] ./claude/hooks/ship.test.ts#1225-1283 — pins the floored range for a
      synced head below and above the merge base, missing or non-ancestor heads
      (fallback), and a stacked upper slice floored at the lower commit.
- [ ] ./claude/hooks/ship.test.ts#33-36 — test runner strips a trailing `^<sha>`
      from rev-list/log keys so old fixtures still match; the floor is asserted
      separately.
