# Quality findings

## correctness: no test covers a failed revive after a one-slice squash onto a stack

`squashOntoStack` in `claude/hooks/ship.ts` squashes first (`commitSquash`) and
only then runs `resume.revive()`. When `git branch -f` fails there, the process
is already squashed and the record stays. The retry works, if you trace it by
hand: `gtd summary` finds no process, so `plan` → `resumable(…, "HEAD")` sees
the recorded top still in HEAD and rebuilds the branch at `<top>~n`. No test
checks this, though. "a lower branch deleted before a one-slice re-ship is
revived after the squash at <top>~n" covers only the success order. "a failed
git branch -f leaves a record that a second run rebuilds from the recorded top"
covers the multi-slice `recordStack` path. If you delete
`if (failed) return fail(failed)` in `squashOntoStack`, every test still passes:
`pushLink` stops the ship later with a different message. Also, the refusal text
("git branch -f X failed; /gtd ship resumes.") does not say the squash is
already kept, unlike `recordStack`'s message for the same failure. Optional: add
a two-run test (first run's `git branch -f` fails after
`git reset --soft <base>`, second run with `gtd summary` failing revives at
`<top>~1` and opens the stack), and say "the squash is kept" in the message.

## ponytail-review: `land` takes a `links` closure it can build itself

What this change does: a one-slice re-ship on a branch with a recorded stack now
squashes onto the top branch and keeps the stack, and every resume reads the
pull request states and rebuilds missing slice branches off the recorded top
before anything is written. The read-only git allowlist for the writer also
learned to refuse quoted flags and `git diff` paths outside the work tree.

Traced: `plan` (no process) → `resumable(…, "HEAD")` → `revive`; one slice →
`stackReads` → `resumable(…, base)` → `pushHistory` → `commitSquash` → `revive`
→ `stackPullRequests` with `floor`; retry after each failing step lands on the
no-process path and resumes from the unchanged `gtdStackTop`. Reads come before
writes everywhere. The `at = base` ancestry check and the `<top>~n` floor are
both pinned by tests that would fail without them. The only coverage gap found
(failed revive after a one-slice squash) is already the correctness chunk above.
Load assumed: one person shipping one branch.

1. **`land` gets a closure for data it already has** (`claude/hooks/ship.ts`,
   `land` and `squash`)
   - **What this is:** `squash` builds
     `links = (c) => sliceLinks(branch, groups, c)` and hands it to `land`,
     which already receives `branch` and `groups`.
   - **Problem:** Two ways to name the same thing; a reader has to check the
     closure was built from the same `branch`/`groups` that `land` was given.
   - **Fix:** Drop the `links` parameter and const; call
     `sliceLinks(branch, groups, built.commits)` in `land` and
     `sliceLinks(branch, groups, [])` in the dry-run line.
   - **If we skip it:** Nothing breaks; a few extra lines to read.

Verdict: Ship. Lean: -3 lines possible.

## test-audit: resume offsets past a merged slice are never exercised

Every recorded-stack test in `claude/hooks/ship.test.ts` records two slices
(`refactor feature`). With two slices `done` is 0 or 1, and at `done = 1` the
`chain` loop is empty, so the new offset arithmetic in `resumable` never runs
with a non-zero offset:

- `commits[i - done]` in `revive` — `commits[i]` passes every test
- `${top}~${recorded.length - 1 - i}` for a missing branch above a merged slice
- the floor `${top}~${last - (done - 1)}` — with `last = 1, done = 1`,
  `~${last}`, `~${done}` and the real formula all give `~1`

A wrong offset would revive a slice branch at the wrong commit, or read the
wrong merged floor and list the wrong commits in the next pull request. Nothing
catches that. Fix: add one three-slice resume (`a b c` recorded, `a` MERGED,
`feat/x-b` gone, top recorded). Expect `git branch -f feat/x-b <top~1 sha>`, the
floor read at `<top>~2` (shown by the `git log … <floor>..` range), and `b`'s
pull request into `main`.

## test-audit: READ_ONLY_GIT now refuses `git log --no-merges`, and no case pins it

Checked with node against the base and current regex. The new flag lookahead
`-["'\\]*-["'\\]*(?:… n["'\\]*o- | e["'\\]*x | t["'\\]*e)` matches any `--no-…`,
`--ex…` or `--te…` flag. So `git log --no-merges a..b`, `git diff --text a b`
and `git log --exclude=x --all` are now refused. The base commit allowed all
three. `--no-merges` is the flag ship itself passes when it reads slice history,
so the writer (`mayRun: READ_ONLY_GIT` in `claude/hooks/register.tsx`) is now
likely to be refused on its most natural command. The accept list has no case
for any of these flags, so the regression passes.

The `n-o-` branch also has no negative case of its own:
`git diff --no-index /etc/hosts /dev/null` is refused by the `/etc` path rule
anyway. Deleting the `n["'\\]*o-` alternative breaks no test.

Fix: narrow the alternatives to the flags that are actually meant (`--no-index`,
`--ext-diff`, `--textconv`). Add `git log --no-merges a..b` (and `--text`) to
the accept list, and `git diff --no-index a b` with in-tree paths to the refuse
list if that refusal is intended.

## test-audit: smaller gaps and one call-shape assertion

- `plan`'s
  `const failed = await found.revive?.(); if (failed) return fail(failed)` (the
  no-process resume path) has no failing-revive test. The existing retry test
  only fails `git branch -f` in the first, multi-slice run (`recordStack`). The
  second run's revive always succeeds. This is the same gap correctness found
  for `squashOntoStack`, at a second call site. One test that fails
  `git branch -f` on a `resume` fixture and expects
  `git branch -f … failed; /gtd ship resumes.` with no push covers it.
- `mergedSlices` gives the top slice its own refusal text ("Rename the branch").
  Its only test ("a MERGED/CLOSED top PR refuses…") uses `sbase`, which is a
  fresh stack and goes through `stackPrecheck`. A CLOSED top PR on a resume (the
  `resume` fixture) is untested, so a wrong ternary there would pass.
- "the squash lands on the top branch and the stack is kept untouched" asserts
  `toContain('git merge-base --is-ancestor ${C1} ${BASE}')`. That is a
  call-shape assertion: unscripted commands succeed, so it checks only that the
  call happened. The behaviour is already pinned by "a record that no longer
  chains retires…", which fails `is-ancestor C1 BASE` and would break if `at`
  went back to `HEAD`. Delete the assertion.
