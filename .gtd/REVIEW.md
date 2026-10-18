# Review: fd5258c

<!-- base: 0ced0d6f03b8ee786d1d985c691acd6ef7a3e09a -->

No `.feature` file changed: no Scenarios chunk. All work sits in
`claude/hooks/ship.ts` plus its unit tests and two doc paragraphs.

## Hand-restack check of origin's copies: identity + patch instead of reflog

The old check trusted any sha in the branch reflog, which also holds commits
dropped on purpose. Now origin's copy of a slice branch passes only when every
commit it holds beyond the recorded top (or the merge base, once that top is
gone), minus `origin/<default>` and the merged slice, has a twin in the local
branch with the same author, email, date, message and patch.

**Fixed since last pass: identity and patch now pair correctly.** The separator
leads the format (`%x1e` before the identity), so each `git log -p` entry holds
one commit's header and its own patch. Checked on a real repo: git prints
header, blank lines, then the patch, so the split yields one entry per commit.

- [ ] ./claude/hooks/ship.ts#1378-1404 — `keptByHand` formats with
      `--format=%x1e${IDENTITY}`; the comment is reflowed to 80 columns and says
      why the separator leads
- [ ] ./claude/hooks/ship.ts#1336-1376 — `handRestack` drops the reflog `tips`
      map and the unused `merged` field and calls `keptByHand`. Slice refs are
      now `refs/heads/…`
- [ ] ./claude/hooks/ship.ts#985-1012 — `originLeases` takes an async `kept`
      predicate in place of `known`, and marks a link `fresh` when ls-remote
      shows that origin lacks the branch
- [ ] ./claude/hooks/ship.ts#1246-1249 — the automatic restack keeps the old
      rule (origin's sha is an ancestor of the pre-restack commit), now written
      as a predicate
- [ ] ./claude/hooks/ship.ts#866-885 — `resumable` stops passing `merged` to
      `handRestack`
- [ ] ./claude/hooks/ship.test.ts#2651-2770 — hand-restack cases: a dropped
      commit the reflog still knows is refused, a kept commit passes,
      merged-slice commits are excluded, an amended copy is refused,
      index/hunk-offset changes are ignored, a gone recorded top falls back to
      the merge base, no common history is refused. All fakes now use git's real
      order (separator, header, patch)
- [ ] ./claude/hooks/ship.test.ts#2699-2719 — new: origin's extra commit sits
      between two other local commits, each with a patch, and passes with the
      lease. Pins the pairing fix: the old trailing separator fails it

## Pushing a slice branch origin deleted, though a stale tracking ref remains

When ls-remote shows origin lacks the branch, the push is now a plain
`--set-upstream` push. Before, a leftover `origin/<b>` tracking ref sent it down
the `--force-with-lease` path, which leases on stale data. A plain push cannot
overwrite a branch someone recreated in the meantime.

- [ ] ./claude/hooks/ship.ts#322-324 — `Link.fresh` added
- [ ] ./claude/hooks/ship.ts#1477-1481 — `pushLink` passes `fresh` through
- [ ] ./claude/hooks/ship.ts#1778-1837 — `pushBranch` takes `fresh`. A stored
      lease key whose branch origin lost also sets `gone`, so the stale tracking
      ref is ignored. A successful push still unsets the stored key
- [ ] ./claude/hooks/ship.test.ts#304-315 — stored key, origin lost the branch,
      the tracking ref still resolves: pushes fresh, no lease
- [ ] ./claude/hooks/ship.test.ts#2742-2748 — hand restack whose middle branch
      is gone from origin: plain push for it, explicit lease for the top

## A slice merged into a lower slice branch before that one landed

A merged pull request whose base was not the default branch used to always
refuse the restack. Now it counts as landed if its base is a lower slice's
branch and it merged no later than that lower slice (compared by `mergedAt`). A
missing `mergedAt` still refuses. `gh pr view` now asks for `mergedAt`.

- [ ] ./claude/hooks/ship.ts#606-626 — `View.mergedAt` added and requested from
      gh
- [ ] ./claude/hooks/ship.ts#787-844 — `landedOn`, `unsettled` and
      `mergedElsewhere` pull the refusal logic out of `mergedSlices`. A merged
      slice above `done` still refuses, with the "merged elsewhere" message when
      it did not land The `<=` treats a tie as landed. GitHub stamps times to
      the second, so two merges in the same second pass. FYI: this is
      acceptable, the order there is not knowable anyway.
- [ ] ./claude/hooks/ship.test.ts#2873-2953 — merged into the lower branch
      first, then that one into main: proceeds, and only the top PR is
      retargeted. The top merged into a lower branch gives the plain "is MERGED"
      refusal. Lower still open, merged after the lower landed, and no
      `mergedAt` all refuse with nothing changed

## Base ref: prefer origin/<default> when the local default branch is stale

A restack never moves local `main`, so a later ship read a stale merge base and
described other people's commits. `resolveRef` now picks `origin/<default>` when
it descends from local main, or when HEAD's merge base with origin is not in
local main. Otherwise it keeps local main, so a branch cut from unpushed local
commits still diffs right.

- [ ] ./claude/hooks/ship.ts#154-180 — new `resolveRef` decision, used by
      `preflight`
- [ ] ./claude/hooks/ship.test.ts#68-73 — the shared fixture scripts local main
      as not an ancestor of origin/main, and the new `mergedAt` field
- [ ] ./claude/hooks/ship.test.ts#1189-1211 — stack ship over a diverged local
      main: the first writer prompt and the diff use the origin merge base
- [ ] ./claude/hooks/ship.test.ts#3527-3565 — single-PR cases: diverged main,
      main behind origin, main ahead with the branch cut from it (keeps main),
      only origin resolves
- [ ] ./claude/hooks/handoff.test.ts#214-222 — handoff fixture updated for the
      extra ancestor probe and the `mergedAt` field

## Slice branches resolved as refs/heads, never by bare name

A tag named like a slice branch wins over the branch in bare rev syntax. Every
git read of a slice branch in the restack path now uses `refs/heads/<b>`.

- [ ] ./claude/hooks/ship.ts#1068-1083 — `brokenShape` uses refs/heads for the
      lower slices
- [ ] ./claude/hooks/ship.ts#1124-1135 — `strayBranch` range
- [ ] ./claude/hooks/ship.ts#1284-1298 — `restacked` floor and first-commit
      range
- [ ] ./claude/hooks/ship.ts#1322-1329 — `isRecordedTop` range. The identity
      format moved to the shared `IDENTITY` const
- [ ] ./claude/hooks/ship.test.ts#2357-2410 — the `bareSlice` matcher, plus a
      three-slice restack that asserts no bare slice name reaches git
- [ ] ./claude/hooks/ship.test.ts#2627-2633 — the same assertion for the
      hand-restack path The rest of the test churn is mechanical renames of
      scripted command keys to `refs/heads/…` and the `mergedAt` gh field.

## User docs

- [ ] ./README.md#340-347 — restack refusal names the merged-into-lower-slice
      exception. Fixed since last pass: the garbled "merged into a anywhere" now
      reads "merged anywhere but the default branch"; the paragraph is reflowed
- [ ] ./docs/driver.md#433-470 — Risk: restack refusal now names the
      merged-into-lower-slice exception, but the hand-restack lease check still
      reads "a commit the local branch has no copy of, same author, date and
      message" (line 462). The code also compares email and the patch, so an
      amended copy with the same author, date and message is refused. Users read
      the check as looser than it is. Fix: "same author, email, date, message
      and change"
