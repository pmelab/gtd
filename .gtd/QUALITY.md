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

## owasp-security: a collaborator's amended commit on origin passes `keptByHand` and is force-pushed away (claude/hooks/ship.ts `keptByHand`)

[LOW] Data-integrity guard keyed on spoofable metadata, not content (CWE-345,
OWASP A08:2025 Software or Data Integrity Failures)

Path: origin/<slice> (written by anyone with push access) → `originLeases` →
`keptByHand` compares `%an %ae %at %B` only → lease = origin's sha → restack
`push --force-with-lease=<slice>:<that sha>` overwrites it.

`git commit --amend` (and `rebase -i` edit/fixup) keeps author name, email,
author date and, usually, the message. A collaborator who amends a slice commit
with a content fix and force-pushes produces a commit whose identity equals the
local, pre-amend one, so `theirs.every((i) => mine.has(i))` holds, the lease is
taken on their sha, and the restack's push discards their change with no
refusal. The old reflog/ancestor check refused this (their sha is neither in the
local reflog nor an ancestor of the top); the new one weakens that guard. Not
attacker-exploitable — whoever can push to origin can already delete the branch
— the harm is silent loss of a trusted collaborator's work, which is exactly
what the `holds commits <b> lacks` refusal exists to prevent.

Consider: match on identity AND content — require `git patch-id --stable` of
each origin commit to equal that of its identity twin in the local range (a hand
rebase that resolved a conflict would then refuse, which is the safe direction),
or at least compare tree diffs for twins with equal identity. Add a test:
origin's slice tip is an amended copy of a local commit (same identity,
different diff) and the restack must refuse before any write.

Hardening noted, not a finding: resolving slice branches as `refs/heads/<b>` (a
tag of the same name can no longer redirect rebase ranges or `rev-parse`), and
`landedOn` failing closed on a missing/unparseable `mergedAt` (NaN compares
false → refusal). All git/gh calls stay argv arrays, no shell; branch names
cannot start with `-`.
