# Requirements: fix PR #391 review findings on stacked ship

Sketch: the human's `.gtd/TODO.md` edit (commit `102b6440`) lists five fixes to
`/gtd ship` from the PR #391 review. It also deleted three deferred review notes
(836985b `stdout`, daed27f `weak`, eda53bb `jsdoc`) and folded the fourth
(15386cd `docs-closed`) into item 5.

**All five concerns are TECHNICAL. The intent is explicit in the sketch; no
product fork is open.** Each one must leave `npm test` green on its own and add
or change unit tests in `claude/hooks/ship.test.ts`.

## Concerns

### 1. Single-branch ship retargets only a PR based on a recorded slice branch — TECHNICAL

Today a single-branch ship (one slice, commits mode, or no process) moves
**any** open PR whose base is not the default branch onto the default branch.
That silently undoes a base the human picked on purpose (a release branch, a
hand-made stack).

- **Retarget only when the PR's base is `<branch>-<name>` for a `<name>` in
  `branch.<branch>.gtdStack`.** Any other base stays untouched, with no retarget
  and no `gh pr edit --base` call
- The `Stacked on #N — merge that first` line is stripped only together with
  that retarget
- **Risk: the record is unset before the PR step runs today** — the single-slice
  squash, the commits-mode squash, and the "no longer chains" drop in a stack
  resume all unset `gtdStack` first. Read the recorded names before any unset
  and hand them to the PR step, or the fix retargets nothing
- **Risk: a retarget that fails after the unset leaves no record**, so a retry
  never retargets. Unset the record only after the retarget succeeds, or keep
  the names otherwise recoverable for the retry
- Tests: a PR on a recorded slice branch is retargeted and loses its stack line
  (existing "a stacked PR shipped as a single branch" case keeps passing); a PR
  on an unrecorded non-default base is left alone, base and body; the
  single-slice and chain-dropped paths still retarget

### 2. Stack mode retargets a thrown draft too — TECHNICAL

In stack mode a slice's PR that is a thrown draft (`<!-- gtd:thrown -->`) goes
straight to the rewrite and keeps its old base. Only the non-thrown branch runs
`gh pr edit --base`.

- **A thrown draft whose base differs from the slice's target base is retargeted
  before it is rewritten and marked ready**
- A failed retarget stops that slice at step `retarget` with nothing rewritten,
  same as the non-thrown path; the THROWN marker stays, so a retry comes back
- Tests: thrown draft on the wrong base is retargeted then rewritten; failed
  retarget leaves the draft untouched; the existing "thrown draft on the upper
  slice" case keeps passing

### 3. A commits-mode ship with no process unsets `gtdStack` — TECHNICAL

With no gtd process at HEAD, commits mode returns early and leaves an old stack
record behind. A later stack-mode ship then resumes a stack the human already
shipped away from.

- **No-process commits ship unsets `branch.<branch>.gtdStack` (not on a dry
  run)**, matching what commits mode already does with a process
- It reads the record first, so concern 1 can still retarget the PR off a
  recorded slice branch
- Tests: no-process commits ship removes the record; its dry run keeps it; a
  following stack-mode ship ships the branch alone

### 4. A resume rebuilds a missing slice branch only when HEAD is the recorded top — TECHNICAL

A resume that finds a recorded `<branch>-<slice>` branch missing rebuilds it
from `HEAD~n`. **If HEAD moved since the stack was built (new commits, an amend,
a rebase), `HEAD~n` is the wrong commit**, and ship force-moves a slice branch
onto it and pushes.

- **Record the top commit the stack was built at** alongside the slice names
  (local git config, set and unset with the names)
- On resume with any slice branch missing: **rebuild only when HEAD equals the
  recorded top; otherwise refuse with nothing changed**, naming the missing
  branch and the way out (`git config --local --unset branch.<branch>.gtdStack`
  to ship the branch alone)
- A resume with every slice branch present keeps today's chain check
- A record written before this change carries no top: treat it as "HEAD is not
  the recorded top" when a branch is missing
- Tests: missing branch at the recorded top is rebuilt and the ship resumes;
  missing branch after HEAD moved refuses and changes nothing (no branch -f, no
  push, record kept); dry run never rebuilds

### 5. `docs/driver.md`: fix the ship refusals and add the caveats — TECHNICAL

Lines ~396-403 of the `/gtd ship` bullet say every merged or closed PR can be
worked around with `GTD_SHIP_MODE=commits`. That is wrong for the top slice:
commits mode ships to `<branch>` too.

- **Offer `GTD_SHIP_MODE=commits` only for a merged or closed lower slice's PR;
  a merged or closed top PR needs a renamed branch**
- **Squash-merge caveat: squash-merging a lower stacked PR rewrites its commit,
  so the PR above shows the lower slice's changes again** until it is rebased or
  resumed; say which merge method keeps the stack clean
- **Stale lower PR caveat: a commits-mode re-ship of a stacked branch retargets
  its PR to the default branch and leaves the lower slice PRs open** — close
  them by hand
- Also document concerns 1-4 in the same bullet, short: a PR on a non-slice base
  keeps its base; a thrown draft is retargeted in a stack; a missing slice
  branch is rebuilt only at the recorded top, else refused
- `README.md` points to the driver doc for ship modes and needs no change unless
  a sentence there contradicts the fix
- Keep prose free of `src/*.ts` and internal function names (AGENTS.md)

## Answered Questions

### Do the three deleted deferred review notes (stdout, weak, jsdoc) still get done?

No. The human deleted them in the sketch commit; they are out of scope for this
process.

### Is the 15386cd `docs-closed` deferred note a separate concern?

No. Item 5 of the sketch restates it; it is folded into concern 5.

### Should ship say anything when it leaves a PR on a non-slice, non-default base?

No. The human set that base deliberately; ship keeps it silently, as the
sketch's "retargets only" wording implies.

### What does a resume do when a slice branch is missing and HEAD moved?

Refuse with nothing changed, as the sketch states; it never falls back to
dropping the stack and shipping the branch alone.
