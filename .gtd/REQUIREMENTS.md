# Requirements: PR #392 review round 1 — ship restack fixes

**Fix all nine findings from PR #392's first review round in
`claude/hooks/ship.ts`, each pinned by its own `claude/hooks/ship.test.ts`
case.** The findings list lived in a session scratchpad file (`review-r1.md`);
it is ephemeral, so every finding is restated in full below.

**Every concern is TECHNICAL — the human's review list fixes each behaviour
outright, so no product fork is open.**

## Concerns

### 1. Fetch the default branch with an explicit refspec — TECHNICAL

`git fetch origin <base>` updates `origin/<base>` only when the remote carries a
default refspec. **Fetch `+refs/heads/<base>:refs/remotes/origin/<base>`
explicitly** in `restackOf`, so the restack always rebases onto the freshly
fetched tip. Test: a remote with no default fetch refspec still restacks onto
the new `origin/<base>`.

### 2. Detect an in-progress rebase by the rebase-merge dir — TECHNICAL

Detection reads only `REBASE_HEAD`. **Treat a rebase as in progress whenever
`git rev-parse --git-path rebase-merge` exists, and abort it in every such
case.** Test: a stopped rebase with no `REBASE_HEAD` still aborts and refuses
cleanly.

### 3. Count a slice merged only when it merged into the default branch — TECHNICAL

`mergedSlices` counts any `MERGED` PR as done, whatever base it merged into, and
the restack then cuts that commit out. **Only a slice whose PR `baseRefName` is
the default branch counts as merged-into-default; a slice merged into another
slice branch refuses with nothing changed** — no rebase, no config write, no
push, no retarget. Test: PR merged into a slice branch refuses, tree and refs
unchanged.

### 4. Validate the local merged slice branch before using it as `from` — TECHNICAL

`finishResume` prefers the local merged slice branch as `from` unchecked. **Use
the local branch only when it checks out against HEAD — the review states this
as "an ancestor of the branch (HEAD) / equals the floor-derived commit"; the
build picks whichever check the floor makes exact — otherwise use the floor.**
Test: a stale or diverged local slice branch is ignored in favour of the floor.

### 5. Detect a hand restack after origin moves on — TECHNICAL

`handRestack` requires `origin/<default>` to be an ancestor of the lowest
remaining slice branch, so any fetch after the hand rebase (origin moved
forward) drops the record and the top ships alone. **Test instead that the
commit beneath the lowest remaining slice (`lowest~1`) is an ancestor of
`origin/<default>`.** Test: hand restack, then origin advances, then ship still
adopts the restack and keeps the stack.

### 6. Refuse when `--update-refs` skipped a slice branch — TECHNICAL

`git rebase --update-refs` silently skips a branch checked out in another
worktree; `restacked` re-reads refs without checking they moved. **After the
rebase, verify every remaining slice branch contains `origin/<default>` and not
`from`; otherwise fail with a clear message naming the branch and the worktree,
before any config write or push.** Test: a slice checked out in a second
worktree yields that refusal, no push, no recorded-stack change.

### 7. Skip restack planning in recordedRefusal's dry call — TECHNICAL

`recordedRefusal`'s dry resumable call now plans a restack — an `ls-remote` over
the network plus restack refusals — on a fresh multi-slice ship. **That call
skips restack planning and hand-restack checks entirely.** Test: a fresh
multi-slice ship runs no `ls-remote` and hits no restack refusal.

### 8. Drop the duplicate Retarget preview line — TECHNICAL

The restack preview prints its own `Retarget:` line on top of `stackPreview`'s.
**Remove `retarget` from `restackOf`; `stackPreview` alone reports it.** Test:
`-n` output carries exactly one Retarget line.

### 9. Share the from-lookup and link building; fix the shadowed name — TECHNICAL

`handRestack` duplicates `finishResume`'s `from` lookup and link building and
re-reads the default branch and `TOP_KEY`. **Extract one shared helper both
call; rename `const names` in `restacked`, which shadows the module-level
`names()`.** Behaviour-neutral: the existing and new tests stay green. Lands
after concerns 4 and 5, which change the logic being shared.

### 10. Keep user docs accurate — TECHNICAL

**Update `README.md` and `docs/driver.md` wherever behaviour text changes** — at
minimum the merged-into-a-slice refusal (concern 3) and the other-worktree
refusal (concern 6). Name no `src/*.ts` module or internal function in that
prose.

## Answered Questions

### Do the three deferred review notes ride along with this work?

No — the human's start edit deleted all three `## Deferred review notes`
sections (836985b, daed27f, eda53bb) when writing this sketch; they stay out of
scope.

### Should a slice merged into another slice branch be restacked some other way instead of refused?

No — the review list states the outcome: refuse with nothing changed.

### Does the other-worktree failure stop before any side effect?

Yes — the review list requires the refusal before any config write or push.
