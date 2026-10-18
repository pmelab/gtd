## correctness: merged slice names cannot actually be reused

`restacked` now adds merged slice names to `gtdStackRetired` so that
`takenSlice` lets a later stack reuse them, and `docs/driver.md` promises "A
merged slice's name may be reused by a later stack". But `stackPrecheck` runs
`prStateRefusal` right after `takenSlice`. `gh pr view <branch>-<name>` still
returns the slice's old MERGED pull request, so the fresh stack is refused
anyway ("is MERGED, not open").

The suite already pins that refusal: the
`a %s slice PR refuses before the history push` test with `MERGED`. The new test
`a fresh stack with a dead record may reuse a merged slice's name` passes only
because `sbase` mocks `gh pr view feat/x-refactor` as `noPr`. A real merged
slice never looks like that, so this is mock/live drift.

Fix one of two ways:

- Make `prStateRefusal` skip, or treat as new, any group whose name is in the
  retired set and whose PR is MERGED into the default branch. Then a new PR is
  created and the old branch is force-pushed on purpose.
- Or drop the doc sentence and the merged-name write to `gtdStackRetired`.

Either way, the reuse test must script the MERGED view that a live repository
returns.

## correctness: the persisted lease turns "pull or reconcile" into a dead end

`pushBranch` uses the stored `branch.<b>.gtdLease` until a push succeeds. After
a rejected restack push, the failure text still says "Pull or reconcile <b>,
then ship". Suppose the user does exactly that and merges origin's collaborator
commit into the local branch. The retry still leases on the pre-restack sha,
which origin no longer has, so the push is rejected every time. The only way out
is the appended hint, which is worded as "overwrite origin's copy on purpose".
That is wrong here: after the reconcile, nothing would be overwritten.

Fix: before pushing, accept the stored lease as satisfied when origin's current
sha (`ls-remote`, not the tracking ref) is an ancestor of the commit being
pushed. Then a reconciled branch pushes with that sha as its lease and the key
is cleared. Add a test for the reconcile-then-ship path. The current test
`a rejected top push, then a ship after a fetch …` covers only the un-reconciled
case.

## correctness: Nit: stale retired names survive a fresh stack over a stale live record

In `ship()`, `gtdStackRetired` is now cleared only when `!live.length`. When a
fresh stack is recorded over a stale live record, `forget` is false and `live`
is non-empty. So old retired names (for example merged names a past restack
wrote) carry over into the new stack's lifetime. Before this change they were
cleared on PR success.

The effect is small: `takenSlice` stays lenient for those names. But it
contradicts the comment "A stale retired record must not take a stack this ship
just recorded with it". Fix: clear the key whenever this ship wrote a new
record, meaning `land` recorded a stack. Do not tie it to the pre-squash `live`.

## owasp-security: Low: every failed leased push suggests switching off the collaborator guard

Not exploitable by an outside attacker. This is a fail-open nudge in the guard
that stops a force push from overwriting a collaborator's commit (CWE-636, OWASP
A06:2025 Insecure Design).

`pushBranch` (`claude/hooks/ship.ts`, the `push` closure) adds "To overwrite
origin's copy on purpose, run git config --local --unset branch.<b>.gtdLease
first." to every non-killed failure whenever a stored lease exists. That
includes failures that have nothing to do with the lease: an auth error, a
network error, a pre-receive hook, or a protected branch. Once the key is unset,
the next ship falls back to a bare `--force-with-lease`, which leases on the
tracking ref. The new comment above it says a fetch defeats exactly that. So
someone who fetched, hit an unrelated push error and followed the hint silently
overwrites any collaborator commit that origin now holds.

The correctness finding "the persisted lease turns pull or reconcile into a dead
end" sends users to the same hint, which makes this worse.

Fix: add the unset line only when git reports a lease rejection (`stale info` or
`rejected` in `r.err`). Otherwise keep the plain failure text. Add a test where
a kept-lease push fails with an unrelated error (for example
`Permission denied`) and check that the unset line is absent. Right now no test
would fail if the line were added on every failure.

## ponytail-review: Nit: the retired-name union is written twice

`retireStack` and the new tail of `restacked` (`claude/hooks/ship.ts`) both read
`branch.<b>.gtdStackRetired`, union it with new names, and write it back. They
must change together. For example, if the separator or the dedupe rule changes,
one copy drifts, and `takenSlice` then reads names that one writer formats
differently.

Fix: one helper, `addRetired(io, branch, more)`, which returns the `git config`
result. `retireStack` checks its code. `restacked` ignores it on purpose, as it
already does. That is about -6 lines. Nothing else changes.

Load assumed: one developer running `/gtd ship` on their own clone, so there are
no scale findings. Other issues this lens saw (merged-name reuse refused by
`prStateRefusal`, the lease dead end after a reconcile, the unset hint on
unrelated push errors, stale retired names) are already in the chunks above.

## test-audit: the healthy-shape check passes only because "" equals ""

`brokenShape` compares `git rev-parse <lower>~1` against
`git rev-parse <below>`. The `repo()` mock answers every unscripted call with
empty output, and the `two`/`three` fixtures script neither
`git rev-parse feat/x-middle~1` nor `git rev-parse origin/main`. So on every
successful restack test the lower-slice check compares `""` with `""`. Only
`midBroken` scripts real shas, and only for the refusal case.

Result: if the comparison picks the wrong pair (for example `l.branch` against
itself, or the wrong `below`), every success-path test would still pass, as long
as `midBroken` still differs. The same `"" === ""` would also let a real
`rev-parse` failure on both sides count as a healthy stack.

Fix: in `three`, script `git rev-parse feat/x-middle~1` and
`git rev-parse origin/main` to the same real sha (for example `BASE`). Then the
happy path actually compares something. Optionally, treat an empty `rev-parse`
as broken in `brokenShape`.

## test-audit: two isRecordedTop guards are not pinned by any test

The hand-restack tests (`a hand restack of a multi-commit top-only remainder`)
pin the identity match, an identity mismatch, and a first commit whose parent is
off origin. Removing either of these guards would still leave every test green:

- `slices.length === 1` in `handRestack`. No test has a remainder of two or more
  slices whose `lowest~1` is off origin while the identity matches. Dropping it
  widens this force-push guard to multi-slice remainders without any test
  failing.
- `mine !== ""` in `isRecordedTop`. Every test that reaches the identity
  comparison scripts both `git log -1` reads. No test has both reads come back
  empty, which is the mock's default and also what a failed read returns.
  Without the guard, two failed reads count as a match, which leads to a leased
  force push.

Fix: add one case to that describe for each guard. One case uses a two-slice
remainder with matching identity and expects no `--force-with-lease`. The other
leaves the `IDENT` reads unscripted and expects the record to be dropped.

## test-audit: Nit: call-count assertion on origin/HEAD reads

`a ship asks origin/HEAD for the default branch once` asserts how many times
`git symbolic-ref` runs. A user can't observe this, so it is call-shape: a
behaviour-preserving refactor that reads it twice would fail the test, while a
wrong default branch is already caught by the PR base assertions elsewhere. Drop
it, or swap it for a behavioural case: a non-`main` origin/HEAD restacks onto
`origin/<that>` and retargets to it.

Already raised under other lenses and not repeated here: the merged-name reuse
test's `noPr` mock/live drift (correctness), the missing reconcile-then-ship
test (correctness), and the missing unrelated-error test for the unset hint
(owasp-security).
