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
