# Review: 406c55c

<!-- base: c9f28445f9fca2d5f0c22e02e61ce8ad1885ac01 -->

**`/gtd ship` now squashes per slice and, by default, opens one stacked pull
request per slice.** `GTD_SHIP_MODE=commits` keeps all slice commits on one
branch under one PR. 122 ship unit tests pass. No `.feature` file changed, so
there is no Scenarios chunk.

**Both earlier risks are fixed in code.** A closed **top** PR now refuses with
"Rename the branch" only. A commits-mode re-ship of a stacked branch retargets
the PR to the default branch and strips its `Stacked on #N` line.

**One risk remains, in the docs:** `docs/driver.md` still tells the reader to
use `GTD_SHIP_MODE=commits` for **any** merged/closed PR, including the top one,
where commits mode squashes and force-pushes, then still fails.

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

- [ ] ./claude/hooks/ship.ts#154-210 — `preflight` pulled out of `ship`. The
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
- [ ] ./claude/hooks/ship.ts#734-783 — `sliceTree` swaps each slice tip's
      `.gtd/` for HEAD's via `ls-tree`/`mktree`. `commitChain` keeps
      `commit.gpgSign` (`-S`), but `commit-tree` runs **no `commit-msg` hook**
      (documented). An empty `commit-tree` reply is a failure, never a reset to
      `''`
- [ ] ./claude/hooks/ship.ts#698-710 — `pushHistory` split out unchanged in
      behaviour. It still runs before any squash
- [ ] ./claude/hooks/ship.ts#712-732 — `commitSquash` loses the inline history
      push and range parsing it used to hold

## Stack record, precheck and resume

The stack is recorded in `git config branch.<b>.gtdStack` (slice names). Upper
slices get `<branch>-<slice>` branches. A part-way failure resumes from the
record.

- [ ] ./claude/hooks/ship.ts#406-424 — `recordStack`: a failed `git config`
      undoes the squash via `ORIG_HEAD`. A failed `branch -f` keeps the squash,
      and a resume rebuilds the branch from `HEAD~n`
- [ ] ./claude/hooks/ship.ts#426-466 — `viewPr` reads a PR by branch (non-zero
      `gh` means no PR, so a `gh` auth/network failure also reads as "no PR").
      `takenSlice` (split out of the precheck by the fix round) refuses a
      foreign `<branch>-<slice>` branch
- [ ] ./claude/hooks/ship.ts#468-488 — `stackPrecheck` refuses a non-open PR
      before anything is pushed. Fix: a closed **top** PR now says only "Rename
      the branch"; lower slices still offer `GTD_SHIP_MODE=commits`, which is
      correct there, since commits mode ships only to the top branch
- [ ] ./claude/hooks/ship.ts#490-545 — `chain`/`resumable`: the recorded upper
      branches must chain by ancestry to HEAD. If they do not, the record is
      unset (dry run: only logged) and the branch ships alone. A missing branch
      is rebuilt from `HEAD~(n-i)`. That assumes nothing was committed on top
      since the failed run
- [ ] ./claude/hooks/ship.ts#547-565 — `settle`: merged bottom PRs drop out and
      the next slice targets the default branch from `floor`. A closed one
      refuses and names the `git config --unset`. FYI: after a **squash** merge
      of the bottom PR, the next PR's diff against the default branch still
      includes the lower slice. Ship retargets but never rebases. Stack mode
      gives no merge-method warning, unlike commits mode

## Opening the stacked pull requests

PRs are created bottom first, so each upper PR's body can open with
`Stacked on #N — merge that first`.

- [ ] ./claude/hooks/ship.ts#567-600 — `stackPreview` (dry run per slice:
      message, branch, open/refresh, retarget) and `stackLine`. That function
      strips/replaces/prepends the stack line, anchored at the body's start
- [ ] ./claude/hooks/ship.ts#602-679 — `sliceStep` creates the PR, rewrites a
      thrown draft, or retargets (`gh pr edit --base`) and then updates.
      `pushLink` refuses to push an upper branch a writer turn moved. A lower PR
      number that cannot be read stops before the upper PR is opened. Failures
      name the slice, the step, and what landed
- [ ] ./claude/hooks/ship.ts#936-1036 — `createPr` takes a `Ctx` range
      (`from..to`, not `..HEAD`), prepends the stack line, and returns the PR
      number parsed from `gh pr create`'s URL
- [ ] ./claude/hooks/ship.ts#1038-1077 — `sinceHead` extracted from `updatePr`
      unchanged (fix round, for size). `updatePr` works on `to`. In stacked
      mode, or when this run `unstacked` the PR, "nothing new" re-applies the
      stack line and succeeds instead of failing. NO-UPDATE and appended updates
      both pass through `restack`

## Single-branch path and push

- [ ] ./claude/hooks/ship.ts#838-894 — Fix for the earlier re-ship risk:
      `pullRequest` now reads `baseRefName`, retargets a PR aimed elsewhere to
      the default branch, and writes the body through `stackLine` to drop a
      stale `Stacked on #N` line. Either change marks the run `unstacked`, so
      nothing new still succeeds. A failed retarget stops before the body is
      touched. FYI: the lower `<branch>-<slice>` PRs stay open and still
      duplicate the lower slices; ship never closes them. FYI: the dry-run
      `preview` does not mention the retarget
- [ ] ./claude/hooks/ship.ts#810-836 — the dry-run `preview` also prints the
      commits-mode warning
- [ ] ./claude/hooks/ship.ts#899-923 — `pushBranch` takes a `head`, so the
      ancestor check against `origin/<branch>` uses the slice commit
- [ ] ./claude/hooks/ship.ts#922-926 — `READ_ONLY_GIT` tightened: blocks
      `-o`/`--ou…` (`--output` writes a file) and allows `branch` only with
      `--list`/`-a`/`-r`/`--show-current`/`--contains <rev>`

## Tests

- [ ] ./claude/hooks/ship.test.ts#4-67 — new exports imported. A `slicesDoc`
      builder is added, and the shared `feature` fixture now scripts
      `gtd slices --json`, `gtd summary --slice=main`, and the `baseRefName`
      field in `gh pr view`
- [ ] ./claude/hooks/handoff.test.ts#218-218 — scripted `gh pr view` key gains
      `baseRefName`
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
- [ ] ./claude/hooks/ship.test.ts#878-1242 — the stack: bottom-first PRs,
      retarget, collisions, thrown draft, resume after a push/branch/config
      failure, merged/closed lower slices
- [ ] ./claude/hooks/ship.test.ts#1244-1254 — fix round: a MERGED/CLOSED top PR
      refuses with "Rename the branch", never suggests commits mode, and mutates
      nothing
- [ ] ./claude/hooks/ship.test.ts#1256-1290 — fix round: a commits-mode re-ship
      of a stacked PR retargets to `main` and writes the body without the stack
      line; with nothing new it still succeeds; a failed retarget fails before
      any body edit
- [ ] ./claude/hooks/ship.test.ts#1292-1401 — writer-moved slice branch,
      signing, `.gtd/` tree swap

## Docs and prompts

- [ ] ./docs/driver.md#396-399 — Risk: still says a merged or closed pull
      request refuses "(use `GTD_SHIP_MODE=commits` or rename the branch)" with
      no scope. For a closed **top** PR, commits mode squashes, pushes history
      and force-pushes the branch, then fails on the same closed PR, so **the
      doc advises the exact path the code fix stopped advising**. Fix: scope the
      commits-mode hint to a lower slice's PR, and say a closed top PR needs a
      renamed branch
- [ ] ./docs/driver.md#368-403 — `/gtd ship` rewritten for per-slice commits,
      `GTD_SHIP_MODE` (`stack`/`commits`), branch naming, refusals, the missing
      `commit-msg` hook, and resuming. Does not mention that a commits-mode
      re-ship retargets a stacked PR and leaves the lower slice PRs open
- [ ] ./README.md#339-353 — names `GTD_SHIP_MODE` and links the driver doc
- [ ] ./README.md#628-630 — the `Gtd-History` trailer is now on every slice's
      commit
- [ ] ./claude/hooks/assist.ts#122-122 — the finish prompt now offers to "squash
      it and open its pull request(s)"
