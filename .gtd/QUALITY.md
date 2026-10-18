# Quality findings

## correctness: an origin-deleted slice branch still hits the stale tracking ref on a restack push (claude/hooks/ship.ts `pushBranch`, `originLeases`)

The new `gone` flag fixes only the persisted-key path: when `ls-remote` shows
origin lost the branch, the key is unset and the branch is pushed fresh. The
restack's own path has the same problem and stays unfixed. `originLeases`
already ran `ls-remote` and found no sha for the slice, so `l.lease` is
`undefined`. Then `pushLink` → `pushBranch(io, b, commit, undefined)` runs with
no key, so `gone` stays false. It falls through to
`rev-parse --verify origin/<b>`, which a never-pruned tracking ref still passes,
and the rebased head is not an ancestor of it, so it pushes with a bare
`--force-with-lease`. That lease expects the stale tracking sha, so git rejects
it ("stale info"). The refusal tells the user to "Fetch and reconcile first",
but a plain fetch does not prune, so every retry fails the same way. (The
`is-ancestor HEAD origin/<b>` branch is worse: it returns success without
pushing, and the PR step then targets a branch origin lacks.)

Consider: carry "absent on origin" from `originLeases` into the link, for
example as a sentinel lease, so `pushBranch` takes the `--set-upstream` path. Or
make `pushBranch` trust `ls-remote` over the tracking ref whenever the tracking
ref is the only thing deciding between fresh push and lease. Add a restack test
where `ls-remote` omits a slice and `rev-parse --verify --quiet origin/<slice>`
succeeds.

## correctness: `keptByHand` comment describes a staleness test the code does not do (claude/hooks/ship.ts `keptByHand`)

Nit: the comment says the range starts at "the merge base, once that top is
stale". The code falls back only when the recorded top object is missing
(`cat-file -e top` fails). A top that still exists but is stale (the earlier
comment's sense: the top branch was re-shipped or restacked since) stays the
lower bound. Today that is harmless, because commits past a stale top are judged
by identity anyway. But the next reader will believe a staleness check exists.
Say "gone" (as the test name "a recorded top that is gone" does), not "stale".

## correctness: docs dropped the refusal for a slice merged into a non-slice branch (README.md, docs/driver.md)

Nit: both docs now say the restack refuses when a pull request "merged into a
slice branch whose chain never reached the default branch". The code
(`landedOn`/`unsettled`) also refuses when a slice merged into any branch that
is not a slice branch at all, which the old wording ("a branch other than the
default branch") covered. It also refuses when a slice merged into a lower
slice's branch after that branch had already landed, and when gh reports no
`mergedAt`. Reword to cover these cases, for example "merged anywhere but the
default branch, unless it merged into a lower slice branch before that one
merged into the default branch".
