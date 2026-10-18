# Review: a4fdcbb

<!-- base: 3527a142b65cc7f66d4086f613d3590208c290c1 -->

Hardens the `/gtd ship` restack (re-ship after a lower stacked slice merged):
every failed or misshapen rebase now rolls back, a stray local branch in the
rebased range refuses up front, a rejected restack push keeps its lease across a
fetch, retired slice names stop blocking a fresh stack, and a hand restack of a
multi-commit top-only remainder is recognised. No `.feature` file changed, so
there is no Scenarios chunk; all coverage is vitest in `claude/hooks/`.

**One risk: a successful restack push never clears `gtdLease`, so a later
rewriting ship of that branch is refused with "stale info".**

## Persisted push lease

The restack writes origin's pre-restack sha to `branch.<b>.gtdLease` per moved
branch before the record shrinks. `pushBranch` reads it on every push: origin
gone unsets it; origin's sha already in the pushed commit leases on that sha;
otherwise it leases on the stored sha, so a fetch cannot launder a
collaborator's commit into an overwrite. A rejected push names the unset line.

- [ ] ./claude/hooks/ship.ts#323-327 — new `LEASE_KEY`; deliberately outside
      `forgetStack`'s key list.
- [ ] ./claude/hooks/ship.ts#1235-1243 — Risk: the lease is written for every
      moved branch, but the restack's own push passes `l.lease` explicitly,
      which zeroes `kept` in `pushBranch`, so the key is **never unset after a
      successful push** (the test "forgetting the stack never touches the lease"
      pins exactly that). The key then lingers with the pre-restack sha. The
      next ship that rewrites that branch without restacking (a squash whose
      result no longer contains origin's tip) finds origin's sha not an ancestor
      of HEAD, falls back to the stale stored sha, and is **rejected every
      time** until the user unsets the key by hand. Without the key, that push
      succeeds via plain `--force-with-lease`. Also contradicts docs/driver.md
      ("kept ... until a push of that branch succeeds"). Fix: unset the key
      after any successful push of that branch, explicit lease included.
- [ ] ./claude/hooks/ship.ts#1717-1737 — reads the key, probes origin with
      `git ls-remote`, picks the lease. Adds one network round trip to every
      push of a branch that carries a key.
- [ ] ./claude/hooks/ship.ts#1742-1749 — appends the unset hint only on a
      `stale info`/`rejected` error, and unsets the key only when it drove the
      push.
- [ ] ./claude/hooks/ship.test.ts#237-319 — `pushBranch` unit cases: lease from
      key, rejection keeps key, unrelated failure, reconciled origin, origin
      lost the branch, killed push, no key.
- [ ] ./claude/hooks/ship.test.ts#3082-3165 — end-to-end: written before the
      record shrinks, failed write pushes nothing, rejected push then fetch
      keeps the old lease, reconciled ship leases on origin's sha.

## Restack rollback and shape checks

A non-zero rebase with no rebase dir used to claim "refs are unchanged" even
when only the final ref update failed. It now checks HEAD and every lower slice
and rolls back if any moved. A conflict whose `git rebase --abort` also fails
now says the repo is mid-rebase instead of claiming a clean tree. After a
"successful" rebase, a new shape check catches a slice whose change was already
upstream (git drops the pick, exits 0, and leaves the branch on `onto`), rolls
back and points to commits mode. The rollback loop is extracted so three call
sites share it.

- [ ] ./claude/hooks/ship.ts#1007-1046 — `rollback`, `rollbackFailed` (shared
      hand-lines message) and `brokenShape` (each lower slice exactly one commit
      above the one below; top keeps at least one commit).
- [ ] ./claude/hooks/ship.ts#1070-1071 — `unmovedSlice` now calls the shared
      rollback; message text unchanged.
- [ ] ./claude/hooks/ship.ts#1107-1175 — `rebaseFailed` (no-dir: detect
      movement, roll back or report refs unchanged; dir: abort, name the stopped
      slice, separate text when the abort fails) and `shapeRefusal`.
- [ ] ./claude/hooks/ship.ts#1222-1227 — `run` wiring: rebase failure, then
      unmoved slice, then shape check, then `restacked`.
- [ ] ./claude/hooks/ship.test.ts#2285-2313 — existing fixtures gain the reads
      the shape check now makes (`rev-list --count`, `<slice>~1`,
      `origin/main`).
- [ ] ./claude/hooks/ship.test.ts#2905-3046 — abort-fails text, no-dir rollback
      (HEAD moved, only a lower ref moved, failing rollback, nothing moved),
      upstream slice refused by name for lower and top.

## Stray branch refusal

`git rebase --update-refs` moves every local branch pointing into the rebased
range, and no rollback restores an unknown one. The restack now refuses, under
`-n` too and before anything changes, when a branch other than the remaining
slices, the top or a merged slice's branch points into `from..branch`.

- [ ] ./claude/hooks/ship.ts#1084-1106 — `strayBranch`; comment owns the
      accepted over-refusal (a branch on an unsquashed top process commit).
- [ ] ./claude/hooks/ship.ts#1207-1208 — called in `restackOf` before leases and
      preview, so dry run refuses identically.
- [ ] ./claude/hooks/ship.ts#834-842 — `merged` slice names threaded into
      `handRestack` so a merged slice's leftover branch is known.
- [ ] ./claude/hooks/ship.ts#920-927 — same `merged` list threaded into
      `restackOf`.
- [ ] ./claude/hooks/ship.test.ts#3047-3081 — refuses before any rebase/push,
      identical under `-n`, known branches never refuse.

## Hand restack of a top-only remainder

When only the top slice remains and it spans several commits, `<lowest>~1` is
not on origin, so a correct hand restack used to drop the record. It is now
accepted when the first commit above `origin/<default>` matches the recorded top
commit by author, email, author date and message, and its parent is on origin.

- [ ] ./claude/hooks/ship.ts#1273-1286 — `isRecordedTop`; two empty identity
      reads do not count as a match.
- [ ] ./claude/hooks/ship.ts#1312-1316 — the extra check applies only to a
      one-slice remainder.
- [ ] ./claude/hooks/ship.test.ts#3191-3251 — resumes with a leased push and
      retarget; mismatched identity, two-slice remainder, empty reads and an
      off-origin parent all drop the record with no force push.

## Retired record handling

A retired record (a stack this ship moved aside until its PR step succeeds) is
now merged with any existing one, not overwritten. Its names count as gtd's own
in the fresh-stack taken-name check, and it is only cleared when no live stack
existed or this ship recorded a new one; an ordinary resume keeps it.

- [ ] ./claude/hooks/ship.ts#219-234 — `settleRecords` replaces the inline
      branch; keeps the retired key on a resume of a live stack that recorded
      nothing new.
- [ ] ./claude/hooks/ship.ts#335-337 — `retireStack` writes the union of old and
      new retired names.
- [ ] ./claude/hooks/ship.ts#498-498 — `land` reports `recorded: true` for a
      freshly recorded stack.
- [ ] ./claude/hooks/ship.ts#699-700 — `takenSlice` treats retired names as
      gtd-built.
- [ ] ./claude/hooks/ship.test.ts#3166-3190 — retired name reusable by a fresh
      stack; ordinary resume keeps `gtdStackRetired`.

## Default branch resolved once

`resumable` re-read `origin/HEAD` on its own; `ship` already had it from
preflight. `baseBranch` is now threaded through the call chain, and
`defaultBranch` is exported so `/gtd throw` reuses it instead of a copy.

- [ ] ./claude/hooks/ship.ts#161-164 — exported, typed against a plain git
      reader so `handoff.ts` can pass its own.
- [ ] ./claude/hooks/ship.ts#195-195 — `ship` passes `baseBranch` to `squash`.
- [ ] ./claude/hooks/ship.ts#814-822 — `resumable` takes `baseBranch`, its own
      lookup removed. The intermediate signatures (`resumeAlone`, `plan`,
      `squash`, `stackReads`, `recordedRefusal`, `stackPrecheck`) change only to
      pass it.
- [ ] ./claude/hooks/handoff.ts#5-5 — imports `defaultBranch`.
- [ ] ./claude/hooks/handoff.ts#76-76 — replaces the duplicated `symbolic-ref`
      parse.
- [ ] ./claude/hooks/handoff.test.ts#230-258 — throw from a `trunk` default
      branch and the `main` fallback.

## Docs

- [ ] ./README.md#344-354 — lists the new refusals (stray branch, slice already
      upstream) and that a failed rebase rolls back.
- [ ] ./docs/driver.md#429-432 — failed abort says mid-rebase.
- [ ] ./docs/driver.md#444-469 — rollback cases, stray-branch refusal,
      `gtdLease` key and how to override it, top-only hand restack rule. The
      "until a push of that branch succeeds" claim is false today; see the Risk
      above.
