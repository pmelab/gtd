# Review: a15c21e

<!-- base: b54b218f9b16f92b0e1f911688330cdb9e425c44 -->

No `.feature` file changed in this range, so there is no Scenarios chunk. All
new behaviour is pinned by unit tests in `claude/hooks/ship.test.ts`.

**The one risk from the last round is fixed; no open risk remains.** The fix
lets a hand restack accept origin's copy of a branch when that sha is any former
tip in the local branch's reflog (its log of past tips).

## Restack after a lower slice is squash- or rebase-merged

`/gtd ship` on a stack whose lower PR merged by squash or rebase now fetches
`origin/<default>`, runs one
`git rebase --update-refs --onto origin/<default> <merged-slice> <branch>`,
pushes each moved branch with a lease on origin's sha, retargets the lowest PR
and shrinks the recorded stack. Before this change, a rebase dropped the record
and shipped the branch alone. All reads and refusals happen before the first
write.

- [ ] ./claude/hooks/ship.ts#736-746 — `Resumed` gains an optional `restack`,
      read-only until `run()` is called. The caller runs it after the squash and
      revive, so the order is always "squash first, then restack".
      `run(preShip)` takes the pre-squash HEAD so a failure can print how to
      undo it.
- [ ] ./claude/hooks/ship.ts#747-768 — `mergedSlices` returns each slice's PR
      view with the merged count. `finishResume` reads the lowest remaining PR's
      number from it for the retarget preview line.
- [ ] ./claude/hooks/ship.ts#769-810 — `resumable` tries the hand-restack check
      first when the chain is valid, the top was rebased and a slice merged.
      Otherwise it keeps the drop-and-ship-alone path. The tail moved into
      `finishResume`, unchanged apart from building the restack.
- [ ] ./claude/hooks/ship.ts#811-868 — `finishResume` builds a restack when a
      slice merged. The rebase starts from the merged slice's local branch, or
      from the floor (the merged slices' top commit) when that branch is
      missing.
- [ ] ./claude/hooks/ship.ts#866-907 — `originLeases` reads every branch's sha
      with one `ls-remote`. It refuses when origin's copy is not an ancestor of
      `known(l, sha)`, and records that sha as the lease (the commit
      `--force-with-lease` checks). The fix widened `known` to receive origin's
      sha so a caller can accept it directly. `pushLines` renders the dry-run
      push lines.
- [ ] ./claude/hooks/ship.ts#909-968 — `restackOf` fetches (skipped on `-n`) and
      returns nothing when the merged slice's commit is already in
      `origin/<default>`: a merge commit, so retarget only. Otherwise it checks
      leases, then builds the preview and `run`. A conflict aborts the rebase
      and names the slice from `REBASE_HEAD`. A rebase that never started (git
      older than 2.38) reports stderr. Both failures print
      `git reset --soft <preShip>` when a squash ran first. FYI:
      **`--update-refs` also moves any unrelated local branch pointing into the
      rebased range**, such as a herdr worktree branch.
- [ ] ./claude/hooks/ship.ts#969-1000 — `restacked` re-reads every moved tip,
      then writes the record before any push: slice names first, then the new
      top (the first commit above the next-lower branch). With one slice left it
      returns `forget`, and the usual retire path runs.
- [ ] ./claude/hooks/ship.ts#1028-1053 — Fix for last round's false refusal.
      `handRestack` reads each slice branch's reflog; origin's sha passes when
      it is a former local tip, else it is judged against the recorded
      `gtdStackTop` as before. A failed reflog read yields no tips and falls
      back to the old check, so it only refuses, never force-pushes. FYI: **git
      prunes unreachable reflog entries after 30 days
      (`gc.reflogExpireUnreachable`)**, so a hand restack shipped more than 30
      days after the re-ship, past a `gc`, still hits the refusal; the refusal
      is safe and changes nothing.
- [ ] ./claude/hooks/ship.ts#161-169 — `defaultBranch` is extracted from
      `preflight` so the resume path can read the default branch.

## Wiring the restack into both ship paths

- [ ] ./claude/hooks/ship.ts#329-358 — The no-process branch of `plan` moves
      into `resumeAlone`. A real run executes the restack and returns the moved
      links; `-n` passes the restack up for the preview.
- [ ] ./claude/hooks/ship.ts#366-370 — `plan` delegates to `resumeAlone`. Its
      return type grows `restack`.
- [ ] ./claude/hooks/ship.ts#425-443 — `squash` carries `restack` and passes the
      pre-squash `tip` into `squashOntoStack`.
- [ ] ./claude/hooks/ship.ts#513-541 — `squashOntoStack` returns the restack on
      `-n`. A real run pushes history, squashes and revives, then restacks and
      returns the rebased links.
- [ ] ./claude/hooks/ship.ts#202-209 — The dry run passes `squashed.restack`
      into `stackPreview`.
- [ ] ./claude/hooks/ship.ts#1064-1066 — `stackPreview` prints the restack block
      first. Nit: **the lowest PR's retarget shows twice on `-n`**, once as
      `gh pr edit N --base main` and once as "would retarget #N from … to main".
- [ ] ./claude/hooks/ship.ts#305-313 — `Link` gains `lease`. The `TOP_KEY`
      comment now says a restack moves the top.
- [ ] ./claude/hooks/ship.ts#712-712 — Comment updated: only a restack moves the
      recorded top.

## Leased push

- [ ] ./claude/hooks/ship.ts#1129-1129 — `pushLink` forwards the link's lease.
- [ ] ./claude/hooks/ship.ts#1427-1444 — `pushBranch` gets an optional `lease`.
      With one, it always runs `--force-with-lease=<b>:<sha>`, tracking ref or
      not, and skips the "already contains" shortcut. A rejected push says
      origin moved.

## Tests

- [ ] ./claude/hooks/ship.test.ts#201-236 — `pushBranch` lease cases: the lease
      is used, a rejection gives the "origin moved" text, a lease with no
      tracking ref still force-pushes, no lease keeps the first-push path.
- [ ] ./claude/hooks/ship.test.ts#2178-2344 — Restack with no process: fetch,
      rebase, leased push, retarget, stack ends. The merged slice's branch and
      local main are never touched. A stack of three shrinks its record. A merge
      commit only retargets. Failed fetch, `ls-remote` and record write all
      refuse; a branch origin lacks gets a plain first push.
- [ ] ./claude/hooks/ship.test.ts#2345-2413 — With a process at HEAD: squash
      then restack in one run. A lease refusal precedes the squash and history
      push; both failure modes name the pre-ship HEAD.
- [ ] ./claude/hooks/ship.test.ts#2414-2458 — Conflict: abort, name the slice
      (top slice included), print the hand command. The old-git failure aborts
      nothing.
- [ ] ./claude/hooks/ship.test.ts#2459-2496 — Hand restack: detected, pushed
      with leases, stack kept. Origin ahead of the recorded top refuses.
- [ ] ./claude/hooks/ship.test.ts#2497-2519 — New with the fix: **origin at a
      former local tip (in the reflog) ships with that sha as lease**; origin at
      a sha absent from the reflog and not under the top still refuses with no
      write.
- [ ] ./claude/hooks/ship.test.ts#2521-2556 — Shapes that are not a hand restack
      drop the record and ship alone.
- [ ] ./claude/hooks/ship.test.ts#2558-2578 — `-n` prints the rebase, leased
      pushes and retarget; runs no fetch and no writes.

## Docs

- [ ] ./docs/driver.md#414-444 — Replaces "a rebase ends the stack" with the
      restack behaviour: git 2.38+, leases, retarget, record shrink, conflict
      recovery, `-n` preview, merge-commit case, hand-restack detection.
- [ ] ./README.md#341-343 — One sentence: re-running `/gtd ship` after a lower
      PR merged restacks the rest.
