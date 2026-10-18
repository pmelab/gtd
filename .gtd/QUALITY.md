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
