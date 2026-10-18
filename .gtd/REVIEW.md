# Review: 130b58e

<!-- base: c9f28445f9fca2d5f0c22e02e61ce8ad1885ac01 -->

**`/gtd ship` now squashes per slice and, by default, opens one stacked pull
request per slice.** `GTD_SHIP_MODE=commits` keeps all slice commits on one
branch under one PR. 117 ship unit tests pass. No `.feature` file changed, so
there is no Scenarios chunk.

**Two risks, both on the escape hatch the refusals advertise
(`GTD_SHIP_MODE=commits`):** a closed top PR still fails, after the squash and
push; and a branch shipped as a stack keeps its stacked base and `Stacked on #N`
line when re-shipped in commits mode.

## Slice input and mode

`GTD_SHIP_MODE` is parsed up front. Slice ranges now come from
`gtd slices --json` (validated strictly). Ship no longer regex-reads
`gtd summary` prose.

- [ ] ./claude/hooks/ship.ts#49-93 — `shipMode` (unset or empty means `stack`;
      any other value is refused) and `readSlices`: schema 1, non-empty, names
      `^[a-z][a-z0-9-]*$`, full 40/64-hex commits, unique names, each base equal
      to the previous tip
- [ ] ./claude/hooks/register.tsx#596-596 — reads `GTD_SHIP_MODE` from the host
      env on every ship
- [ ] ./src/workflows/shared/text.ts#1080-1082 — drops the "byte for byte, ship
      regex-reads it" comment. Correct: ship no longer parses this text
- [ ] ./src/workflows/shared/text.test.ts#295-297 — same comment dropped from
      the pinned-literal test

## Planning the squash

`plan` probes `gtd summary`, then reads slices. It refuses a still-open slice, a
non-initial state, or a tip that is not HEAD. Slices that changed only `.gtd/`
fold into a neighbour. If every slice did, the process is dropped.

- [ ] ./claude/hooks/ship.ts#154-209 — `preflight` pulled out of `ship`. The
      top-level flow: squash, then settle a resumed stack, then dry preview or
      PRs. A commits-mode warning is appended to the result
- [ ] ./claude/hooks/ship.ts#211-260 — `landed` groups slices by
      `diff --quiet … :(exclude).gtd/`: a leading/middle `.gtd/`-only slice
      carries its base forward, a trailing one extends the last tip.
      `rebaseWarning` reads `rebaseMergeAllowed`, and anything but `true` warns.
      `unfinished` names the open slice
- [ ] ./claude/hooks/ship.ts#262-282 — one writer turn per landed group fed
      `gtd summary --slice=<name>`. Cost trailers are summed per group's own
      range, and every message gets the `Gtd-History` trailer
- [ ] ./claude/hooks/ship.ts#284-325 — `plan`: no process at HEAD in stack mode
      looks for a recorded stack to resume. Otherwise it validates slices and
      checks that the tip is HEAD

## Building the commits

Single group: the old `reset --soft` + `git commit`. Several groups: every
commit is built with `commit-tree` before any ref moves, then one
`reset --soft`.

- [ ] ./claude/hooks/ship.ts#327-404 — `squash`: precheck (stack only), then
      messages, then the dry return, then the history push, then
      `squashOne`/`commitChain`. Commits mode and single-slice unset
      `branch.<b>.gtdStack`, so a stale stack record cannot resume later
- [ ] ./claude/hooks/ship.ts#724-775 — `sliceTree` swaps each slice tip's
      `.gtd/` for HEAD's via `ls-tree`/`mktree`. `commitChain` keeps
      `commit.gpgSign` (`-S`), but `commit-tree` runs **no `commit-msg` hook**
      (documented). An empty `commit-tree` reply is a failure, never a reset to
      `''`
- [ ] ./claude/hooks/ship.ts#689-702 — `pushHistory` split out unchanged in
      behaviour. It still runs before any squash
- [ ] ./claude/hooks/ship.ts#704-722 — `commitSquash` loses the inline history
      push and range parsing it used to hold

## Stack record, precheck and resume

The stack is recorded in `git config branch.<b>.gtdStack` (slice names). Upper
slices get `<branch>-<slice>` branches. A part-way failure resumes from the
record.

- [ ] ./claude/hooks/ship.ts#406-424 — `recordStack`: a failed `git config`
      undoes the squash via `ORIG_HEAD`. A failed `branch -f` keeps the squash,
      and a resume rebuilds the branch from `HEAD~n`
- [ ] ./claude/hooks/ship.ts#426-479 — `viewPr` reads a PR by branch (non-zero
      `gh` means no PR, so a `gh` auth/network failure also reads as "no PR").
      `stackPrecheck` refuses a foreign `<branch>-<slice>` branch or a non-open
      PR before anything is pushed
- [ ] ./claude/hooks/ship.ts#471-477 — Risk: the refusal for a merged/closed PR
      says "Ship with GTD_SHIP_MODE=commits" even when the closed PR is the
      **top** branch's. Commits mode's `pullRequest` refuses a non-open PR too,
      but only **after** the squash, the history push and the branch force-push.
      So following the hint rewrites and pushes the branch and still fails. Fix:
      give the last group a different hint (rename the branch), or have
      `pullRequest` check PR state before pushing
- [ ] ./claude/hooks/ship.ts#481-535 — `chain`/`resumable`: the recorded upper
      branches must chain by ancestry to HEAD. If they do not, the record is
      unset (dry run: only logged) and the branch ships alone. A missing branch
      is rebuilt from `HEAD~(n-i)`. That assumes nothing was committed on top
      since the failed run
- [ ] ./claude/hooks/ship.ts#537-557 — `settle`: merged bottom PRs drop out and
      the next slice targets the default branch from `floor`. A closed one
      refuses and names the `git config --unset`. FYI: after a **squash** merge
      of the bottom PR, the next PR's diff against the default branch still
      includes the lower slice. Ship retargets but never rebases. Stack mode
      gives no merge-method warning, unlike commits mode

## Opening the stacked pull requests

PRs are created bottom first, so each upper PR's body can open with
`Stacked on #N — merge that first`.

- [ ] ./claude/hooks/ship.ts#559-592 — `stackPreview` (dry run per slice:
      message, branch, open/refresh, retarget) and `stackLine`. That function
      strips/replaces/prepends the stack line, anchored at the body's start
- [ ] ./claude/hooks/ship.ts#594-671 — `sliceStep` creates the PR, rewrites a
      thrown draft, or retargets (`gh pr edit --base`) and then updates.
      `pushLink` refuses to push an upper branch a writer turn moved. A lower PR
      number that cannot be read stops before the upper PR is opened. Failures
      name the slice, the step, and what landed
- [ ] ./claude/hooks/ship.ts#902-1004 — `createPr` takes a `Ctx` range
      (`from..to`, not `..HEAD`), prepends the stack line, and returns the PR
      number parsed from `gh pr create`'s URL
- [ ] ./claude/hooks/ship.ts#1011-1103 — `updatePr` works on `to`. In stacked
      mode "nothing new" re-applies the stack line instead of failing. NO-UPDATE
      and appended updates both pass through `restack`

## Single-branch path and push

- [ ] ./claude/hooks/ship.ts#846-862 — Risk: commits/single-slice `pullRequest`
      never reads `baseRefName` and never strips the stack line. A branch first
      shipped as a stack, then re-shipped with `GTD_SHIP_MODE=commits` (the way
      out the refusals recommend), **keeps its PR targeted at `<branch>-<slice>`
      with a stale `Stacked on #N` line**. The PR then describes the wrong
      range. Fix: read `baseRefName`, retarget to the default branch, and pass
      the body through `stackLine(body)`
- [ ] ./claude/hooks/ship.ts#802-828 — the dry-run `preview` also prints the
      commits-mode warning
- [ ] ./claude/hooks/ship.ts#865-889 — `pushBranch` takes a `head`, so the
      ancestor check against `origin/<branch>` uses the slice commit
- [ ] ./claude/hooks/ship.ts#891-895 — `READ_ONLY_GIT` tightened: blocks
      `-o`/`--ou…` (`--output` writes a file) and allows `branch` only with
      `--list`/`-a`/`-r`/`--show-current`/`--contains <rev>`

## Tests

- [ ] ./claude/hooks/ship.test.ts#4-61 — new exports imported. A `slicesDoc`
      builder is added, and the shared `feature` fixture now scripts
      `gtd slices --json` and `gtd summary --slice=main`
- [ ] ./claude/hooks/ship.test.ts#322-331 — the 64-hex history case now goes
      through a 64-hex slices document instead of a summary regex
- [ ] ./claude/hooks/ship.test.ts#517-542 — writer-allowlist cases for `branch`
      mutations and `--output`/`-o`
- [ ] ./claude/hooks/ship.test.ts#555-608 — `shipMode` (an invalid mode makes no
      call) and `readSlices` (the golden doc plus each refusal case)
- [ ] ./claude/hooks/ship.test.ts#610-842 — per-slice squashing: prompt source,
      open slice, tip-not-HEAD, `.gtd/`-only folding (cost trailers included),
      commits mode chain, history push ordering, rebase warning, dry run
- [ ] ./claude/hooks/ship.test.ts#844-876 — `stackLine` and `pushBranch` with a
      head
- [ ] ./claude/hooks/ship.test.ts#878-1353 — the stack: bottom-first PRs,
      retarget, collisions, thrown draft, resume after a push/branch/config
      failure, merged/closed lower slices, signing, `.gtd/` tree swap. Missing:
      **no test covers a commits-mode re-ship of a branch that was stacked**
      (see the Risk above)

## Docs and prompts

- [ ] ./docs/driver.md#368-403 — `/gtd ship` rewritten for per-slice commits,
      `GTD_SHIP_MODE` (`stack`/`commits`), branch naming, refusals, the missing
      `commit-msg` hook, and resuming. Its "use `GTD_SHIP_MODE=commits`" advice
      carries both Risks above
- [ ] ./README.md#339-351 — names `GTD_SHIP_MODE` and links the driver doc
- [ ] ./README.md#628-630 — the `Gtd-History` trailer is now on every slice's
      commit
- [ ] ./claude/hooks/assist.ts#122-122 — the finish prompt now offers to "squash
      it and open its pull request(s)"
