# 01 — PR #392 review round 3 fixes in `claude/hooks/ship.ts`

All six concerns share one footprint, `claude/hooks/ship.ts` plus
`claude/hooks/ship.test.ts`, so they ship as one package. Interfaces, call
stacks and answered questions are in `.gtd/ARCHITECTURE.md`. **Every fix lands
with a `ship.test.ts` case that fails before the fix.** Tests drive `ship()` or
`pushBranch` through the scripted `repo()` io only. No test calls an internal
helper.

## Requirements

1. **Stale merge base after a restack.** A restack never moves the local default
   branch, so a later ship reads the merge base from a stale local default. **PR
   titles and descriptions then describe other people's changes.** The single-PR
   path after "one slice left, forget the stack" has the same bug. **Use
   `origin/<default>` when it descends from the local default, or when the stack
   sits on `origin/<default>` and not on the local default.** Otherwise keep
   today's order (local first, then origin).
2. **Hand-restack lease trusts any reflog sha (data loss).** A collaborator's
   commit X, pulled into the reflog and then dropped during a hand rebase, gets
   force-pushed away. **Origin's sha passes only when every commit in
   `<recorded top or merge-base>..<origin sha>` except the merged slice's is in
   the local branch by identity (author, author date, message).** **Otherwise
   refuse with the existing "Pull or reconcile `<b>`, then ship" text, and
   change nothing.**
3. **Merged-into-lower-slice refused too eagerly.** **Count a MERGED slice whose
   base is a slice branch already counted as landed, and only when its
   `mergedAt` is no later than that slice's.** Refuse when the chain never
   reaches the default branch, or when either `mergedAt` is missing. README and
   `docs/driver.md` get the reworded refusal.
4. **`pushBranch` never pushes fresh once origin lost the branch.** A stale
   `refs/remotes/origin/<b>` sends it down the lease path and git rejects it.
   **When `ls-remote` shows the branch gone, push `--set-upstream origin <b>`
   with no lease.**
5. **Slice branches resolved by bare name.** **A tag named like a slice branch
   wins and the restack reads the wrong commit.** **Resolve every slice branch
   as `refs/heads/<b>`.** Exception: the branch argument of
   `git rebase --update-refs --onto … <from> <branch>` stays bare.
6. **Drop `handRestack`'s unused `merged` parameter**, at the signature and its
   one call site in `resumable`.

## Tasks

### Task 1: Base ref prefers `origin/<default>` when it is the right base (req 1)

Paths: `claude/hooks/ship.ts` (`resolveRef`, `preflight`),
`claude/hooks/ship.test.ts`

- [ ] Shared `feature` fixture gains
      `git merge-base --is-ancestor main origin/main` → code 1; every existing
      test still resolves `main`
- [ ] `resolveRef(git, ok, baseBranch)`: with both refs resolving, returns
      `origin/<default>` when `--is-ancestor <default> origin/<default>`
      succeeds, or when `m = merge-base origin/<default> HEAD` is non-empty and
      `--is-ancestor m <default>` fails; otherwise `<default>`. With one ref,
      returns that one. Return values stay bare names
- [ ] `preflight` passes `git` through
- [ ] Test: restacked stack re-shipped with new work, stale diverged local
      `main` — every writer prompt's `git log`/`git diff --stat` range starts at
      the `origin/main` merge base
- [ ] Test: retry after a failed push, same stale `main` — retry's writer ranges
      start at the `origin/main` merge base
- [ ] Test: single-PR path after "one slice left, forget the stack", stale
      `main` — `pullRequest` takes `git merge-base origin/main HEAD`, writer
      log/diff hold only the branch's commits
- [ ] Test: local `main` behind `origin/main` — base ref `origin/main`
- [ ] Test: local `main` ahead of `origin/main`, branch cut from local `main` —
      base ref stays `main`
- [ ] Test: only `origin/main` resolves — base ref `origin/main`

### Task 2: Identity-checked hand-restack lease; drop `merged` (req 2, req 6)

Paths: `claude/hooks/ship.ts` (`originLeases`, `keptByHand`, `handRestack`,
`restackOf`, `isRecordedTop`, `resumable`), `claude/hooks/ship.test.ts`

- [ ] `IDENTITY = "%an%x00%ae%x00%at%x00%B"` shared with `isRecordedTop`
- [ ] `originLeases(io, ok, links, kept)` takes a predicate; `restackOf` passes
      `(l, sha) => ok("merge-base", "--is-ancestor", sha, l.commit)`,
      `handRestack` passes `keptByHand`. On false the refusal text is unchanged
- [ ] `keptByHand(git, ok, {branch, sha, top, from, onto})`: true when `sha`
      exists locally and every identity in
      `git log --format=IDENTITY%x1e <sha> ^<lower> ^<onto> ^<from>` appears in
      `git log --format=IDENTITY%x1e <onto>..refs/heads/<b>`; `lower` is `top`
      when `cat-file -e top` succeeds, else `merge-base <sha> refs/heads/<b>`.
      Merge commits on origin count. The reflog is no longer read
- [ ] `handRestack` loses `merged`; `resumable` stops passing it;
      `npm run typecheck` green
- [ ] Hand-restack fixtures drop their reflog keys
- [ ] Test: planned restack leases on origin's sha when it is an ancestor of the
      slice's pre-restack commit; refuses "Pull or reconcile" when not
- [ ] Test: hand restack dropped collaborator commit X (in `top..origin`,
      missing by identity locally, present in reflog) — refuses "Pull or
      reconcile <b>, then ship"; nothing pushed, rebased, retargeted or written
      to config
- [ ] Test: hand restack kept every commit — passes, pushes with
      `--force-with-lease=<b>:<origin sha>`
- [ ] Test: merged slice's commit in origin's range, absent locally — excluded,
      no refusal
- [ ] Test: stale recorded top (`cat-file -e top` fails) — range starts at
      `merge-base <sha> refs/heads/<b>`, identity check decides
- [ ] Existing hand-restack scenarios ("spotted a hand restack", lease push)
      still pass

### Task 3: `mergedAt`-ordered merged-slice chain (req 3)

Paths: `claude/hooks/ship.ts` (`View`, `viewPr`, `mergedSlices`),
`claude/hooks/ship.test.ts`, `README.md`, `docs/driver.md`

- [ ] `View` gains `mergedAt?: string`; `viewPr`'s `--json` becomes
      `number,title,body,url,state,baseRefName,mergedAt` for every caller
- [ ] All 12 scripted `gh pr view … --json …baseRefName` keys gain `,mergedAt`;
      MERGED fixtures carry a `mergedAt`
- [ ] `mergedSlices`: a MERGED slice at `done` counts when its base is
      `baseBranch`, or is `branchOf(k)` for a counted `k < done` with
      `Date.parse(mergedAt)` no later than k's. Missing `mergedAt` on either
      side, or any other base, returns the existing "merged into <base>, not
      <default>" refusal
- [ ] Test: a merged into `main`, b merged into `feat/x-a` — restack proceeds, b
      counted as landed
- [ ] Test: b merged into `feat/x-a`, a still OPEN — refuses "merged into
      feat/x-a, not main"; no fetch, push, rebase or config write
- [ ] Test: a merged into `main` first, b merged into `feat/x-a` later —
      refuses, nothing changes
- [ ] Test: b merged into `feat/x-a` with no `mergedAt` — refuses, nothing
      changes
- [ ] README: "when that pull request merged into another slice branch" →
      "merged into a slice branch whose chain never reached the default branch"
- [ ] `docs/driver.md`: "the lowest pull request merged into a branch other than
      the default branch" → same claim

### Task 4: Fresh push when origin lost the branch (req 4)

Paths: `claude/hooks/ship.ts` (`pushBranch`), `claude/hooks/ship.test.ts`

- [ ] When `ls-remote` is empty and the lease key is unset, push
      `--set-upstream origin <b>` with no lease, even if
      `refs/remotes/origin/<b>` resolves
- [ ] Test: stored lease key, empty `ls-remote`, stale
      `refs/remotes/origin/feat/x` — key unset,
      `git push --set-upstream origin feat/x` with no `--force-with-lease`,
      returns undefined

### Task 5: Slice branches as `refs/heads/<b>` (req 5)

Paths: `claude/hooks/ship.ts` (`brokenShape`, `strayBranch`, `restacked`,
`isRecordedTop`, `handRestack`), `claude/hooks/ship.test.ts`

- [ ] `brokenShape`: `rev-parse refs/heads/<b>~1`, `rev-parse <below>`,
      `rev-list --count <under>..HEAD`, with `<below>`/`<under>` as
      `refs/heads/<b>` when they name a slice, `origin/<default>` otherwise
- [ ] `strayBranch`: `rev-list <from>..refs/heads/<branch>`
- [ ] `restacked`: `merge-base origin/<default> refs/heads/<lowest>`,
      `rev-list --reverse refs/heads/<above>..refs/heads/<branch>`
- [ ] `isRecordedTop`: `rev-list --reverse <onto>..refs/heads/<lowest>`
- [ ] `handRestack`: `is-ancestor <from> refs/heads/<lowest>`,
      `refs/heads/<lowest>~1`, `merge-base <onto> refs/heads/<lowest>`
- [ ] `git rebase --update-refs … <branch>` argument and the printed by-hand
      line stay bare
- [ ] Existing scripted keys move to `refs/heads/` form
      (`rev-parse feat/x-middle~1`, `merge-base origin/main feat/x[-middle]`,
      `rev-list --count feat/x-middle..HEAD`, others)
- [ ] Test: three-slice restack and hand restack, each with tag `feat/x-middle`
      on an unrelated commit (bare keys → tag sha, `refs/heads/` keys → branch
      sha) — outcome, pushes and record writes match the no-tag run; no
      slice-branch resolution uses a bare name

### Task 6: Verify

- [ ] `npm run typecheck`, `npm test` green

## Tests

- unit: `claude/hooks/ship.test.ts`
