# Quality findings

## correctness: a deferred forget lets a stack-mode retry resume the stack the first attempt dropped

`claude/hooks/ship.ts` now keeps the stack record until the pull-request step
succeeds (`squashed.forget` → `forgetStack` after `opened.ok`). The squash
itself is not deferred, so a retry takes a different path from the first
attempt. Example: a stack `refactor feature` shipped earlier (record and
`feat/x-refactor` still there, lower PR open), then a new single-slice process
lands on top. First `/gtd ship` (stack mode, the default): `commitSquash` →
`forget: true` → `pullRequest` sees the PR on `feat/x-refactor` (`onSlice`),
retargets it to `main`, and then `updatePr` or the body edit in `unstack` fails.
The record stays. Retry: `gtd summary` now fails (already squashed), so `plan` →
`resumable`. Every slice branch exists, so `topGuard` never compares
`gtdStackTop` with HEAD, and `chain` is valid because the old slice commits are
still ancestors of HEAD. The old stack resumes, and `stackPullRequests` moves
the top PR back onto `feat/x-refactor` with a `Stacked on` line. Before this
change the record was unset at squash time, so a retry also shipped the branch
alone. The test "every branch present and HEAD moved: the chain check decides"
confirms that the recorded top is ignored when no branch is missing, and no test
covers a stack-mode retry after a failed single-squash PR step. Fix: when the
squash sets `forget`, move the record right away to a key that only
`pullRequest`'s `onSlice` reads and `resumable` ignores (for example
`branch.<b>.gtdStackRetired`), and unset that key after the PR step succeeds. Or
have `resumable` treat a recorded top that is not HEAD as stale. Add a test for
the retry.

## correctness: following the refusal's own advice leaves the top PR on a stale slice base

`topGuard`'s refusal, and `settle`'s refusal for a closed lower PR, both tell
the user to run `git config --local --unset branch.<b>.gtdStack` "to ship the
branch alone". With the record gone, `ship()` reads an empty `recorded`, so
`pullRequest` computes `onSlice = false`. The top PR then keeps its
`feat/x-<slice>` base and its stale `Stacked on #N` line. The new test "an
unrecorded non-default base is left alone" (case `["feat/x-refactor", ""]`) pins
exactly this result. So the documented way out of both refusals ships nothing to
the default branch. `GTD_SHIP_MODE=commits` does what the refusal promises: with
no process, `plan` returns `forget: true` before `resumable` runs, `pullRequest`
gets the record, retargets the PR, strips the line, and forgets the record only
after that succeeds. Point both refusal texts (and the matching sentence in
`docs/driver.md` about the unset) at `GTD_SHIP_MODE=commits` instead of the raw
unset.

## correctness: a failed names write after the top write leaves a top that matches no stack

`recordStack` writes `gtdStackTop` first and `gtdStack` second. If the second
write fails, the squash is undone with `reset --soft ORIG_HEAD`, but
`gtdStackTop` keeps the discarded commit. Any older `gtdStack` record stays
alongside it, so the old names now sit beside a new top. Today nothing harms the
retry: the process is back, so `gtd summary` succeeds and `resumable` is never
reached, and the next record overwrites the top. Still, `topGuard` treats "top
== HEAD" as permission to rebuild branches from `HEAD~n`, which depends on the
two keys describing the same stack. Nit: unset `gtdStackTop` in the undo branch,
or write the names first and the top last, so the two keys only ever exist as a
matched pair.
