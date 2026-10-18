# Review: ba54cf2

<!-- base: b54b218f9b16f92b0e1f911688330cdb9e425c44 -->

No `.feature` file changed in this range, so there is no Scenarios chunk. All
new behaviour is pinned by unit tests in `claude/hooks/ship.test.ts`.

## Restack after a lower slice is squash- or rebase-merged

`/gtd ship` on a stack whose lower PR merged by squash or rebase now fetches
`origin/<default>`, runs one
`git rebase --update-refs --onto origin/<default> <merged-slice> <branch>`,
pushes each moved branch with a lease on origin's sha, retargets the lowest PR
and shrinks the recorded stack. Before this change, a rebase dropped the record
and shipped the branch alone. All reads and refusals happen before the first
write.

- [ ] ./claude/hooks/ship.ts#729-745 — `Resumed` gains an optional `restack`,
      which stays read-only until `run()` is called. The caller runs it after
      the squash and revive, so the order is always "squash first, then
      restack". `run(preShip)` takes the HEAD from before the squash so a
      failure can print how to undo it.
- [ ] ./claude/hooks/ship.ts#747-765 — `mergedSlices` returns each slice's PR
      view along with the merged count. `finishResume` reads the number of the
      lowest remaining PR from it for the retarget preview line.
- [ ] ./claude/hooks/ship.ts#769-809 — `resumable` now tries the hand-restack
      check first when the chain is valid, the top was rebased and a slice
      merged. Otherwise it keeps the drop-and-ship-alone path. The tail moved
      into `finishResume`, unchanged apart from building the restack.
- [ ] ./claude/hooks/ship.ts#811-866 — `finishResume` builds a restack when a
      slice has merged. The rebase starts from the merged slice's local branch,
      or from the floor (the merged slices' top commit) when that branch is
      missing.
- [ ] ./claude/hooks/ship.ts#869-906 — `originLeases` reads every branch's sha
      with one `ls-remote`. It refuses if origin's copy is not an ancestor of
      the known pre-restack commit, and records that sha as the branch's lease
      (the commit `--force-with-lease` checks). `pushLines` renders the dry-run
      push lines.
- [ ] ./claude/hooks/ship.ts#908-966 — `restackOf` fetches (skipped on `-n`) and
      returns nothing when the merged slice's commit is already in
      `origin/<default>`, which means a merge commit and only a retarget.
      Otherwise it checks the leases, then builds the preview and the `run`. A
      conflict aborts the rebase and names the slice from `REBASE_HEAD`. A
      rebase that never started (git older than 2.38) reports stderr. Both
      failures print `git reset --soft <preShip>` when a squash ran first. FYI:
      `--update-refs` also moves any unrelated local branch that points into the
      rebased range, such as a herdr worktree branch.
- [ ] ./claude/hooks/ship.ts#967-999 — `restacked` re-reads every moved tip,
      then writes the record before any push: first the slice names, then the
      new top, which is the first commit above the next-lower branch. With one
      slice left it returns `forget`, and the usual retire path runs.
- [ ] ./claude/hooks/ship.ts#1000-1046 — Risk: **a hand restack after the top
      branch has been re-shipped since the last record write is falsely
      refused.** `handRestack` checks origin's copy of every branch against the
      recorded `gtdStackTop` (`() => top`). Neither a non-restack re-ship
      (`squashOntoStack` keeps the old top) nor a restack of a multi-commit top
      slice (`restacked` records the first commit above the lower branch)
      updates that key to the top branch's tip. In both cases `origin/<branch>`
      is a descendant of the recorded top, not an ancestor, so the ship refuses
      with "origin/<branch> holds commits <branch> lacks". The unit fixture
      never scripts that case. Judge the top branch against its own last-pushed
      tip, or skip the ancestor check for it and rely on the lease.
- [ ] ./claude/hooks/ship.ts#161-171 — `defaultBranch` is extracted from
      `preflight` so the resume path can read the default branch.

## Wiring the restack into both ship paths

- [ ] ./claude/hooks/ship.ts#329-357 — The no-process branch of `plan` moves
      into `resumeAlone`. On a real run it now runs the restack and returns the
      moved links. On `-n` it passes the restack up for the preview.
- [ ] ./claude/hooks/ship.ts#359-372 — `plan` delegates to `resumeAlone`. Its
      return type grows `restack`.
- [ ] ./claude/hooks/ship.ts#420-446 — `squash` carries `restack` and passes the
      pre-squash `tip` into `squashOntoStack`.
- [ ] ./claude/hooks/ship.ts#504-544 — `squashOntoStack` returns the restack on
      `-n`. On a real run it pushes history, squashes and revives, then restacks
      and returns the rebased links.
- [ ] ./claude/hooks/ship.ts#200-212 — The dry run passes `squashed.restack`
      into `stackPreview`.
- [ ] ./claude/hooks/ship.ts#1048-1058 — `stackPreview` prints the restack block
      first. Nit: the lowest PR's retarget shows twice on `-n`, once as
      `gh pr edit N --base main` from the restack block and once as "would
      retarget #N from … to main" from the per-slice block.
- [ ] ./claude/hooks/ship.ts#302-313 — `Link` gains `lease`. The `TOP_KEY`
      comment now says a restack moves the top.
- [ ] ./claude/hooks/ship.ts#709-712 — Comment updated: only a restack moves the
      recorded top.

## Leased push

- [ ] ./claude/hooks/ship.ts#1114-1120 — `pushLink` forwards the link's lease.
- [ ] ./claude/hooks/ship.ts#1417-1435 — `pushBranch` gets an optional `lease`.
      With one, it always runs `--force-with-lease=<b>:<sha>`, whether or not a
      tracking ref exists, and skips the "already contains" shortcut. A rejected
      push says origin moved.

## Tests

- [ ] ./claude/hooks/ship.test.ts#201-236 — `pushBranch` lease cases: the lease
      is used, a rejection gives the "origin moved" text, a lease with no
      tracking ref still force-pushes, and no lease keeps the first-push path.
- [ ] ./claude/hooks/ship.test.ts#2178-2344 — Restack with no process: fetch,
      rebase, leased push and retarget, then the stack ends. The merged slice's
      branch and local main are never touched. A stack of three shrinks its
      record. A merge commit only retargets. Failed fetch, failed `ls-remote`
      and a failed record write all refuse, and a branch origin lacks gets a
      plain first push.
- [ ] ./claude/hooks/ship.test.ts#2345-2413 — With a process at HEAD: squash,
      then restack, in one run. A lease refusal comes before the squash and the
      history push, and both failure modes name the pre-ship HEAD.
- [ ] ./claude/hooks/ship.test.ts#2414-2458 — Conflict: abort, name the slice
      (the top slice included) and print the hand command. The old-git failure
      aborts nothing.
- [ ] ./claude/hooks/ship.test.ts#2459-2533 — Hand restack: it is detected and
      pushed with leases and keeps the stack. Origin being ahead refuses. Shapes
      that are not a hand restack drop the record. The fixture keeps
      `origin/feat/x` equal to the recorded top, so the false refusal flagged
      above goes unseen.
- [ ] ./claude/hooks/ship.test.ts#2534-2552 — `-n` prints the rebase, the leased
      pushes and the retarget, and runs no fetch and no writes.

## Docs

- [ ] ./docs/driver.md#414-445 — The driver doc replaces "a rebase ends the
      stack" with the restack behaviour: git 2.38+, leases, retarget, record
      shrink, conflict recovery, the `-n` preview, the merge-commit case and
      hand-restack detection.
- [ ] ./README.md#338-346 — One sentence saying that re-running `/gtd ship`
      after a lower PR merged restacks the rest.
