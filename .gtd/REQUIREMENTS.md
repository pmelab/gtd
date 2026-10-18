# PR #392 review round 2: restack hardening

Fix every PR #392 review round 2 finding against the `/gtd ship` restack
(`claude/hooks/ship.ts`). **Each fix ships with its own
`claude/hooks/ship.test.ts` case** that fails without the fix. The finding list
lived in a session scratch file outside the repo (`review-r2.md`); its full
content is carried below, so nothing depends on that file surviving.

**Out of scope: rewriting the restack as an off-tree `merge-tree` + `update-ref`
transaction.** Keep `README.md` and `docs/driver.md` accurate wherever a
user-visible message or behaviour changes.

## Concerns

### 1. Conflict path claims a clean state it never checked — PRODUCT

On a rebase conflict the restack runs `git rebase --abort` and ignores its
result, then says "tree and refs are as before". **When the abort fails, say the
repo is mid-rebase and tell the user to run `git rebase --abort` by hand** —
never claim a clean state. The successful-abort message stays as is.

Test: a conflict whose abort fails prints the mid-rebase text, not "as before".

### 2. Failed rebase with no rebase dir is misreported as "refs are unchanged" — PRODUCT

A non-zero rebase exit with no `rebase-merge` dir is today read as "git older
than 2.38 refused `--update-refs`". **It can also mean every pick finished and
only the final `--update-refs` ref update failed.** In that case, compare HEAD
and every lower slice ref against their pre-rebase values; **if anything moved,
run the same rollback `unmovedSlice` runs** (restore refs and HEAD, print the
`update-ref`/`reset --keep` lines if restoring fails). Only when nothing moved
does "refs are unchanged" stay true.

Test: a rebase that exits non-zero with no rebase dir but moved HEAD or a slice
ref is rolled back and not reported as unchanged.

### 3. A dropped lower-slice commit breaks the stack shape silently — PRODUCT

A remaining lower slice whose commit the rebase drops (already upstream, or
emptied) passes the "moved" check, breaking one-commit-per-lower-slice and the
recorded top (`first` may come back empty). **After the rebase, verify each
remaining lower slice branch sits exactly one commit above the next-lower one
(or above `onto` for the lowest), and the top branch has at least one commit
above its lower.** Otherwise roll back (same rollback as concern 2) and refuse,
naming the slice.

Test: a lower slice whose change is already upstream is rolled back and refused
by name; nothing is pushed and the record is unchanged.

### 4. `--update-refs` drags unrelated local branches along — PRODUCT

`git rebase --update-refs` also moves any local branch pointing into
`from..branch` (a backup branch, another stack's branch), and rollback does not
restore it. **Before the rebase — and in the `-n` preview — refuse with nothing
changed when a local branch other than the remaining slice branches and the
merged slice branch points at a commit in `from..branch`, naming that branch.**

Test: a backup branch at a lower slice commit makes ship and ship `-n` refuse
naming it, with no ref moved.

### 5. A rejected leased push loses its lease on retry — PRODUCT

The record shrinks before any push. If a leased push is rejected (a collaborator
pushed between `ls-remote` and the push), the user fetches and re-ships: nothing
to restack, no lease, and `pushBranch`'s plain `--force-with-lease` against the
freshly fetched tracking ref **overwrites the collaborator's commit**. Fix:
**when the record is written, persist each moved branch's lease (origin's sha
read by `ls-remote`) in local git config; use it for every later push of that
branch until one succeeds, then unset it**, so the refusal still holds on retry.
The refusal names the config key to unset for a user who decides to overwrite on
purpose.

Test: restack, reject one push, move the tracking ref to the collaborator's
commit, ship again — the push is still refused; after a successful push the key
is gone.

### 6. Hand restack of a multi-commit top-only remainder drops the record — PRODUCT

`handRestack` tests `<lowest>~1` on `origin/<default>`, which only holds when
the lowest remaining branch has one commit. **Stack `[a, top]` with `top`
re-shipped (several commits), `a` squash-merged, user runs the printed hand
rebase: the next ship drops the record instead of resuming, as `docs/driver.md`
promises.** Fix the detection for that shape — e.g. `from` not reachable from
the lowest branch and `merge-base(lowest, onto)` is the parent of the first
commit of lowest not in `onto` — without loosening the guard that stops an
unrelated rebase from becoming a force push. If that cannot be detected safely,
`docs/driver.md` states the limitation explicitly instead.

Test: the `[a, top]` multi-commit hand restack resumes; an unrelated rebase of
the same shape still drops the record.

### 7. A merged slice name blocks reusing it in a later stack — PRODUCT

After a restack the merged slice leaves the record but its `<branch>-<slice>`
branch stays, so **a later fresh stack reusing that slice name is refused by
`takenSlice` as "not part of a stack gtd built".** Remember merged slice names
(in the existing `gtdStackRetired` key) so `takenSlice` treats them as
gtd-built. Forgetting the stack clears them with the rest.

Test: restack after slice `a` merges, finish the stack, ship a fresh stack with
a slice named `a` — no refusal.

### 8. Duplicate default-branch lookup and re-read base branch — TECHNICAL

`claude/hooks/handoff.ts` `throwBranch` inlines the `origin/HEAD` default-branch
logic — reuse `defaultBranch` from `ship.ts`. Pass preflight's `baseBranch` into
`resumable` instead of re-reading it. No behaviour change; existing tests stay
green.

### 9. Docs follow the changed messages — PRODUCT

Update the restack paragraphs of `docs/driver.md` (and `README.md` where it
mentions restack) for: the failed-abort text (1), the rollback on a half-done
rebase (2, 3), the unrelated-branch refusal (4), the persisted lease and how to
clear it (5), the hand-restack shape now resumed or the stated limit (6).

## Answered Questions

### Do the three deferred review notes (garbled-flag stdout assert, `gtd history list` scenario, `runSummaryCommand` doc comment) belong in this process?

No — the human deleted them from `.gtd/TODO.md` in the start diff; they are
dropped, not folded.

### For concern 6, fix the detection or only document the gap?

Fix the detection; fall back to documenting the limit only when it cannot be
detected without risking a force push of an unrelated rebase — the finding
states that order itself.

### Should the unrelated-branch case (concern 4) move or restore those branches instead of refusing?

Refuse with nothing changed and name the branch — the finding prescribes
refusal, matching every other restack guard.

### How does a user escape a persisted lease they want to override (concern 5)?

The refusal names the `git config --local --unset` line for that branch's lease
key; clearing it automatically on fetch would reopen the overwrite the fix
closes.
