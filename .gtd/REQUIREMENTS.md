# Requirements: PR #392 review round 3 fixes

Fix the six round-3 findings on `/gtd ship`'s restack (`claude/hooks/ship.ts`).
**Every fix ships with its own `claude/hooks/ship.test.ts` case that fails
before the fix.** Correctness and safety only — no further dedup refactors, no
cucumber tier for the mod (`ship.test.ts` stands in, already decided).

## 1. Stale merge base after a restack — TECHNICAL

A restack moves the stack onto `origin/<default>` but never moves the local
default branch. On any later ship — new work, or a retry after a failed push —
`done` is 0, `floor` is unset, and the merge base comes from the base ref, which
picks the **stale local default branch** first. **Result: PR titles and
descriptions describe the merged lower slice and every upstream commit since —
other people's changes.** The plain one-pull-request path after the "one slice
left, forget the stack" case has the same bug.

- **Use `origin/<default>` as base ref and merge base when it descends from the
  local default branch, or when the stack sits on `origin/<default>` and not on
  the local default branch.**
- Otherwise keep today's choice (local default first, then `origin/<default>`).
- Tests: a restacked stack re-shipped with new work, and a retry after a failed
  push, both against a stale local default branch — the writer's log/diff holds
  only the stack's own commits. Same for the single-PR path after the forget.

## 2. Hand-restack lease trusts any reflog sha — TECHNICAL (safety)

Today origin's sha passes as "known" if it appears anywhere in the local
branch's reflog. **Data-loss path: a collaborator pushes X to
`origin/<branch>-b`, the user pulls (X enters the reflog), hand-rebases and
drops X resolving a conflict, and ship force-pushes with lease X — deleting the
collaborator's commit.**

- **Origin's sha passes only if every commit in
  `<recorded top or merge-base>.. <origin sha>`, other than the merged slice's,
  is still represented in the local branch** — same author, author date and
  message (the identity `isRecordedTop` already uses).
- **Otherwise refuse, nothing changed, with the existing "pull or reconcile"
  text.**
- Tests: the collaborator-commit-dropped case refuses and pushes nothing; a hand
  restack that kept every commit still passes.

## 3. Round-1 regression: merged-into-lower-slice refused too eagerly — TECHNICAL

`mergedSlices` refuses any merged lower slice whose PR base is
`<branch>-<lower slice>`, even when that lower slice has since merged into the
default branch — so the change did reach it.

- **Allow a MERGED slice whose base is the branch of a slice already counted as
  merged into the default branch; refuse only when the chain never reaches the
  default branch.**
- README's restack refusal list says it refuses "when that pull request merged
  into another slice branch" — **reword to: merged into a slice branch whose
  chain never reached the default branch.** Check `docs/driver.md` for the same
  claim.
- Tests: slice a → default, slice b → `<branch>-a` (merged), restack proceeds; b
  → `<branch>-a` with a never merged to default still refuses, nothing changed.

## 4. `pushBranch` never pushes fresh when origin lost the branch — TECHNICAL

When `ls-remote` shows origin no longer has the branch, the stored lease key is
unset, but a stale `refs/remotes/origin/<branch>` (no prune) routes the push to
the bare `--force-with-lease` path. **Git rejects it as stale info; the intended
fresh push never happens.**

- **In that case push fresh: `--set-upstream`, no lease.**
- Test: stored lease, origin branch deleted, stale tracking ref present — push
  succeeds and creates the branch.

## 5. Slice branches resolved by bare name — TECHNICAL

`brokenShape`, `strayBranch`, `restacked` and `isRecordedTop` resolve slice
branches by bare name; **a same-named tag wins and the restack reads the wrong
commit.**

- **Use `refs/heads/<b>` everywhere a slice branch is resolved**, these four and
  any other site found while there.
- Test: a tag named like a slice branch, pointing elsewhere, does not change the
  outcome.

## 6. Drop `handRestack`'s unused `merged` parameter — TECHNICAL

Remove it from the signature and every call site. No test needed beyond
typecheck and the existing suite staying green.

## Answered Questions

### Should a re-ship fast-forward the local default branch instead of switching the merge base to `origin/<default>`?

No — the review prescribes the base-ref switch; ship never touches branches the
user did not ask it to move.

### Does the hand-restack refusal get new wording?

No — it reuses the existing "pull or reconcile `<branch>`, then ship" text;
users already know that recovery.

### What happens to the three deferred review notes the sketch removed from `.gtd/TODO.md`?

Dropped — the human deleted them in the entry commit; they are out of scope for
this round.
