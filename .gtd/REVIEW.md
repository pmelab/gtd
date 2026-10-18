# Review: e770bda

<!-- base: daee504c125e136d3804421597da2db8a48ee217 -->

**`/gtd ship` restack now refuses two unsafe cases up front and rolls back a
half-done rebase.** No `.feature` scenario changed; the behaviour is pinned by
vitest cases in `claude/hooks/ship.test.ts`.

**One risk below: a hand-restacked record with one slice left now blocks a fresh
stack ship.**

## Merged-into-the-wrong-base refusal

A lower slice pull request that merged into another slice branch never reached
the default branch. Restacking onto `origin/<default>` would drop its commit
silently, so the resume refuses before any read-write step.

- [ ] ./claude/hooks/ship.ts#753-781 — `mergedSlices` takes the default branch
      and refuses when a counted merged slice has `baseRefName` other than it
      (missing base shows as "no base"). Unused `views` return dropped.
- [ ] ./claude/hooks/ship.test.ts#2620-2634 — pins the exact refusal for a
      slice-branch base and for no base, with nothing written, and under `-n`
      too.

## Rebase base comes from the recorded top, not the local branch

`from` (the merged slice's commit) is now always read off `gtdStackTop`; a stale
or diverged local `<branch>-<slice>` is ignored. Extracted into `stackRest`,
shared by the hand-restack probe and `finishResume`.

- [ ] ./claude/hooks/ship.ts#713-735 — `topGuard` gets an explicit return type;
      the `rebased` arm now carries `top` too, so callers stop defaulting to
      `""`.
- [ ] ./claude/hooks/ship.ts#785-831 — `resumable` reads the default branch
      once, computes `stackRest` before `handRestack`, and threads
      `planRestack`.
- [ ] ./claude/hooks/ship.ts#833-863 — new `stackRest`: floor commit at
      `top~(len-1-(done-1))`, plus the remaining links.
- [ ] ./claude/hooks/ship.ts#865-902 — `finishResume` uses `stackRest`; refuses
      when no floor commit exists; skips `restackOf` when `planRestack` is
      false. Retarget argument removed (the stack preview already prints one).
- [ ] ./claude/hooks/ship.test.ts#2635-2660 — diverged local merged branch is
      never the rebase base; stale local branch does not block a hand restack;
      missing floor commit refuses naming the slice.
- [ ] ./claude/hooks/ship.test.ts#2798-2803 — `-n` prints exactly one
      `Retarget:` line (was duplicated).
- [ ] ./claude/hooks/ship.test.ts#2812-2815 — `-n` retarget wording now comes
      from the stack preview line.

## Hand-restack detection and liveness probe

Hand restack now accepts a lowest branch whose parent sits anywhere in
`origin/<default>`, so origin moving on after the hand rebase no longer drops
the stack. The liveness probe behind the fresh-stack refusal no longer touches
origin.

- [ ] ./claude/hooks/ship.ts#1123-1144 — Risk: with `plan` false `handRestack`
      returns `forget: false` always, but the planned path returns
      `forget: links.length === 1`. A hand-restacked record with one slice left
      now makes `recordedRefusal` refuse a fresh multi-slice stack ("already has
      a recorded stack"), where before it was dropped. Return
      `forget: slices.length === 1` on the probe path too.
- [ ] ./claude/hooks/ship.ts#621-640 — `recordedRefusal` calls `resumable` with
      `planRestack` false: no fetch, ls-remote or worktree list. `gh pr view`
      still runs.
- [ ] ./claude/hooks/ship.ts#781-784 — comment on what `planRestack` false
      skips.
- [ ] ./claude/hooks/ship.test.ts#2534-2540 — existing "not a hand restack" case
      updated to the new `lowest~1` ancestry probe.
- [ ] ./claude/hooks/ship.test.ts#2661-2674 — hand restack after origin moved on
      is kept: leased push, retarget, record rewritten.
- [ ] ./claude/hooks/ship.test.ts#2738-2762 — live and hand-restacked records
      refuse a fresh stack with origin offline, never calling
      ls-remote/fetch/push.

## Worktree guard and post-rebase rollback

`rebase --update-refs` silently skips a branch checked out in another worktree.
The restack now refuses up front when `git worktree list` shows a lower slice
branch elsewhere; after the rebase, any lower branch not sitting on `onto`
without `from` triggers a rollback of every lower branch and HEAD.

- [ ] ./claude/hooks/ship.ts#946-968 — `checkedOutElsewhere` parses
      `git worktree list --porcelain`; a failing list is a refusal string.
      Includes the current worktree, harmless since HEAD is always the top
      branch.
- [ ] ./claude/hooks/ship.ts#970-1015 — `unmovedSlice`: per lower branch,
      "moved" means `onto` is an ancestor and `from` is not. On the first
      unmoved one, restores every pre-rebase sha with compare-and-swap
      `update-ref` and `reset --keep` to the pre-rebase HEAD; a failed restore
      prints the manual commands plus the squash undo line.
- [ ] ./claude/hooks/ship.ts#1036-1046 — `restackOf` runs the worktree guard
      before leases, so `-n` refuses identically.
- [ ] ./claude/hooks/ship.ts#1052-1083 — `run` snapshots HEAD and lower branch
      shas before the rebase and calls `unmovedSlice` after a successful one.
- [ ] ./claude/hooks/ship.test.ts#2675-2701 — worktree refusal (real and `-n`,
      exact text) and failing worktree list refusal, nothing written.
- [ ] ./claude/hooks/ship.test.ts#2702-2737 — unmoved branch (still holds merged
      commit, or lacks `origin/main`) rolls back with no push/config/retarget;
      after a same-run squash the undo line survives.
- [ ] ./claude/hooks/ship.test.ts#2763-2797 — rollback restores a branch the
      rebase did move from its pre-rebase sha, using the moved sha as the CAS
      guard.

## Fetch refspec and rebase-failure detection

- [ ] ./claude/hooks/ship.ts#1030-1038 — fetch uses the explicit forced refspec
      `+refs/heads/<default>:refs/remotes/origin/<default>`, so
      `origin/<default>` updates regardless of the remote's fetch config.
- [ ] ./claude/hooks/ship.ts#1058-1066 — "rebase in progress" is now the
      `rebase-merge` dir existing, not `REBASE_HEAD`; a stop with no
      `REBASE_HEAD` is still aborted. `REBASE_HEAD` only names the stopped
      slice.
- [ ] ./claude/hooks/ship.ts#1102-1112 — rename `names` to `written`; it
      shadowed the module-level `names` helper.
- [ ] ./claude/hooks/ship.test.ts#2187-2228 — shared fixtures: refspec fetch,
      `--git-path` probe, worktree list showing only the top branch.
- [ ] ./claude/hooks/ship.test.ts#2234-2245 — order test uses the refspec fetch
      and asserts the bare `git fetch origin main` is gone.
- [ ] ./claude/hooks/ship.test.ts#2298-2303 — failed fetch pins the exact
      refusal text.
- [ ] ./claude/hooks/ship.test.ts#2411-2411 — conflict fixture adds the
      `rebase-merge` dir.
- [ ] ./claude/hooks/ship.test.ts#2430-2430 — same for the three-slice conflict.
- [ ] ./claude/hooks/ship.test.ts#2591-2619 — rebase-merge dir without
      `REBASE_HEAD` aborts and blames the top slice; no dir means no abort,
      stderr shown. Nit: helper `nothingWritten` returns true when something was
      written.

## Docs

- [ ] ./README.md#342-345 — names both new refusals in the `/gtd ship`
      paragraph.
- [ ] ./docs/driver.md#403-416 — resume skips only a lower slice merged into the
      default branch; a hand-restacked record counts as live.
- [ ] ./docs/driver.md#433-454 — documents the wrong-base and worktree refusals
      (also under `-n`), the rollback and its manual fallback, and the relaxed
      hand-restack shape.
