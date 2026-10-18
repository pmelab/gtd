# PR #392 review round 2: restack hardening

**Two packages: concerns 1–8 as one change to `claude/hooks/ship.ts` (plus
`handoff.ts`), then concern 9 as the docs follow-up.** Every fix is driven
through the exported `ship()` / `pushBranch()` with the scripted `ShipIo` of
`claude/hooks/ship.test.ts`; no internal helper is tested directly.

**Out of scope, unchanged: rewriting the restack as an off-tree `merge-tree` +
`update-ref` transaction.**

Git behaviour verified on git 2.54 in a scratch repo: `--update-refs` moved an
unrelated `backup` branch sitting inside `from..branch`, and a lower slice whose
change was already upstream ended with its branch pointing at `onto` itself (no
commit of its own) while the rebase exited 0.

## Interfaces

```ts
// claude/hooks/ship.ts — newly exported; handoff.ts throwBranch calls it
// instead of inlining the origin/HEAD read. Falls back to "main".
export async function defaultBranch(
  git: (...args: string[]) => Promise<string>,
): Promise<string>

// claude/hooks/ship.ts — signature unchanged, contract extended:
// - effective lease = `lease` ?? `git config --local --get branch.<branch>.gtdLease`
// - a leased push that exits 0 unsets branch.<branch>.gtdLease when it was set
// - a killed (timed-out) or rejected leased push keeps the key
// - a rejected leased push whose lease came from (or was mirrored in) the key
//   appends: "To overwrite origin's copy on purpose, run
//   git config --local --unset branch.<branch>.gtdLease first."
// handoff.ts throwTo inherits this: a throw after a rejected restack push
// refuses the same way.
export async function pushBranch(
  io: ShipIo,
  branch: string,
  head?: string,
  lease?: string,
): Promise<string | undefined>

// claude/hooks/ship.ts — signature unchanged; new git config contract and
// refusal texts it emits.
export async function ship(
  io: ShipIo,
  isDry: boolean,
  rawMode?: string,
): Promise<Shipped>

// Config keys ship reads and writes (local git config):
type ShipConfig = {
  // NEW. Origin's sha as `git ls-remote` read it before a restack, one per
  // moved branch origin already had. Written by the restack before the record
  // shrinks; read by every later push of that branch until one succeeds.
  // Never touched by forgetStack: it must outlive the record.
  "branch.<b>.gtdLease": string
  // CHANGED meaning. Space-separated slice names gtd built:
  //  - a moved-aside record awaiting PR success (as today), and now also
  //  - merged slice names a restack dropped from a still-live record.
  // retireStack writes the union of what is there and the live names.
  // ship() unsets it after a successful PR step only when no live record
  // existed at the start of the run. forgetStack still clears it.
  "branch.<branch>.gtdStackRetired": string
}

// Refusal / failure texts (exact wording is the contract the tests pin):
// (1) conflict, abort failed:
//   "Slice <name> failed at restack: git rebase conflicted, and git rebase
//    --abort failed too: the repository is mid-rebase. Run git rebase --abort
//    by hand, then rebase by hand, which restacks every slice branch:
//    <rebase line>\nthen /gtd ship." + abort stderr + undo line (if squashed)
//   The successful-abort text stays exactly as today.
// (2) non-zero rebase exit, no rebase-merge dir, HEAD or a lower ref moved:
//   "git rebase failed after moving refs; the slice branches and HEAD are
//    restored and nothing was pushed or recorded.\n<stderr>" + undo line
//   Nothing moved: "git rebase failed; refs are unchanged." stays.
// (3) shape broken after a clean rebase:
//   "Slice <name> keeps no commit of its own after the restack (its change is
//    already in origin/<default>); the slice branches and HEAD are restored
//    and nothing was pushed or recorded. Ship the branch alone with
//    GTD_SHIP_MODE=commits." + undo line
// (2)/(3) rollback itself failing: "<why>, and the rollback failed: slice
//   branches stay rebased and nothing was pushed or recorded. Run by hand,
//   then /gtd ship:" + the `git update-ref` / `git reset --keep` lines — the
//   same shape unmovedSlice prints today.
// (4) unrelated branch inside the range (real run and -n):
//   "Branch <b> points into the commits the restack rebases, so git rebase
//    --update-refs would move it too; nothing changed. Move or delete it,
//    then /gtd ship."
```

## Call Stacks

Restack, real run (concerns 1–5, 7):

- `ship` → `squash` → `plan`/`stackReads` → `resumable(…, baseBranch, …)` →
  `finishResume` → `restackOf`
- `restackOf` (reads only, also under `-n`) → fetch → `checkedOutElsewhere` →
  **new `strayBranch`**: `git rev-list <from>..<branch>` +
  `git for-each-ref --format=%(objectname) %(refname) refs/heads/`; any branch
  in that range that is not a recorded slice branch (remaining, top, or merged)
  refuses (4) → `originLeases`
- `restack.run` →
  `git rebase --update-refs --onto origin/<default> <from> <branch>`
  - non-zero, `rebase-merge` dir present → `git rebase --abort`; its exit code
    picks the as-before text or the mid-rebase text (1)
  - non-zero, no dir → compare `rev-parse HEAD` and each lower ref against
    `preHead`/`pre`; moved → **new `rollback(pre, preHead)`** → (2); unmoved →
    today's "refs are unchanged"
  - zero → `unmovedSlice` (now calling `rollback`) → **new `brokenShape`**: for
    each lower slice `rev-parse <b>~1` must equal `rev-parse <below>`
    (`origin/<default>` for the lowest), and `rev-list --count <lowerTop>..HEAD`
    ≥ 1; first failure names the slice → `rollback` → (3)
  - → `restacked(…, merged)`
- `restacked` → `git config branch.<b>.gtdLease <lease>` per link with a lease
  (failure: today's "git config failed after the restack" text, record not yet
  shrunk) → record `gtdStack` → `gtdStackTop` → best-effort `gtdStackRetired` +=
  merged names (a failed write only over-refuses later) → `stackPullRequests` →
  `shipLink` → `pushLink` → `pushBranch`

Retry after a rejected leased push (concern 5):

- `ship` → `resumeAlone`/`pullRequest` or `stackPullRequests` → `pushBranch` (no
  explicit lease) → reads `branch.<b>.gtdLease` → `--force-with-lease=<b>:<sha>`
  → rejected again → refusal names the unset line; success → `--unset` the key

Hand restack (concern 6):

- `resumable` → `topGuard` (`rebased`) → `stackRest` → `handRestack`
  - `from` ancestor of lowest → not a hand restack (unchanged)
  - `<lowest>~1` ancestor of `origin/<default>` → hand restack (unchanged path)
  - **new, only when one slice remains (lowest is the top branch):** first =
    head of `git rev-list --reverse origin/<default>..<lowest>`; `<first>^`
    ancestor of `origin/<default>`, and
    `git log -1 --format=%an%x00%ae%x00%at%x00%B` of `first` equals that of the
    recorded top (`gtdStackTop`, always the top slice's first commit) → hand
    restack; anything else → drop the record as today

Fresh stack reusing a merged slice name (concern 7):

- `ship` → `squash` → `stackReads` → `stackPrecheck` →
  `takenSlice(dead = gtdStack names ∪ gtdStackRetired names)`

Cleanup (concern 8):

- `handoff.throwTo` → `throwBranch` → `defaultBranch(git)` from `ship.ts`
- `ship` → `preflight` returns `baseBranch` → threaded through `squash` →
  `plan`/`resumeAlone`/`stackReads`/`stackPrecheck`/`recordedRefusal` →
  `resumable(io, git, ok, branch, baseBranch, isDry, at, planRestack)`; the
  second `defaultBranch` read inside `resumable` is gone

## E2E Scenarios

No e2e change. `/gtd ship` lives in the Claude Code mod (`claude/hooks/`), which
no cucumber harness drives; every restack behaviour so far (#391, `daee504c`,
`3527a142`) is pinned through the scripted `ShipIo` in `ship.test.ts`.

## Unit Tests

### ship

- unit: claude/hooks/ship.test.ts — a conflict whose `git rebase --abort` exits
  non-zero prints the mid-rebase text and the `git rebase --abort` by-hand
  instruction, never "tree and refs are as before"; nothing pushed or recorded
  (covers 1)
- unit: claude/hooks/ship.test.ts — a conflict whose abort succeeds still prints
  "tree and refs are as before" unchanged (covers 1)
- unit: claude/hooks/ship.test.ts — a rebase exiting non-zero with no
  `rebase-merge` dir after HEAD moved runs `git update-ref` for each lower ref
  and `git reset --keep <preHead>`, prints "failed after moving refs", never
  "refs are unchanged"; nothing pushed or recorded (covers 2)
- unit: claude/hooks/ship.test.ts — same, with only a lower slice ref moved
  (HEAD unchanged), rolls back too (covers 2)
- unit: claude/hooks/ship.test.ts — same, with the rollback's `update-ref`
  failing, prints the `git update-ref`/`git reset --keep` hand lines (covers 2)
- unit: claude/hooks/ship.test.ts — a non-zero exit with no dir and nothing
  moved keeps "git rebase failed; refs are unchanged." and runs no
  `update-ref`/`reset` (covers 2)
- unit: claude/hooks/ship.test.ts — a stack of three where the middle slice's
  change is already upstream (`feat/x-middle~1` ≠ `origin/main` after the
  rebase) is rolled back and refused naming slice `middle`; no push, no
  `git config --local` write (covers 3)
- unit: claude/hooks/ship.test.ts — a top branch left with no commit above its
  lower slice after the rebase is rolled back and refused naming the top slice
  (covers 3)
- unit: claude/hooks/ship.test.ts — a `backup` branch at a lower slice commit
  inside `from..branch` refuses naming `backup`, before any fetch-dependent
  write, rebase, squash or push (covers 4)
- unit: claude/hooks/ship.test.ts — the same `backup` branch refuses identically
  under `-n` (covers 4)
- unit: claude/hooks/ship.test.ts — the remaining slice branches, the top branch
  and the merged slice's branch inside the range never refuse (covers 4)
- unit: claude/hooks/ship.test.ts — a restack writes
  `branch.<b>.gtdLease <origin sha>` for each moved branch origin had, before
  the record shrinks (covers 5)
- unit: claude/hooks/ship.test.ts — restack, reject the top push, then ship
  again with the tracking ref moved to the collaborator's commit and the key
  still set: the push is `--force-with-lease=<b>:<old lease>` and refuses naming
  `git config --local --unset branch.<b>.gtdLease`; after a later successful
  push the key is unset (covers 5)
- unit: claude/hooks/ship.test.ts — the one-slice-left restack (stack ends)
  persists the top branch's lease too, and the retry through the single-PR path
  still pushes leased (covers 5)
- unit: claude/hooks/ship.test.ts — stack `[a, top]`, `top` re-shipped with
  several commits, `a` squash-merged, hand rebase done: the next ship resumes
  (leased push, retarget, no rebase), not drops the record (covers 6)
- unit: claude/hooks/ship.test.ts — the same shape whose first commit above
  `origin/main` is not the recorded top's copy (unrelated rebase) drops the
  record and pushes no `--force-with-lease` (covers 6)
- unit: claude/hooks/ship.test.ts — a restack with two or more slices left adds
  the merged slice name to `gtdStackRetired`; a later fresh stack with a dead
  record and a slice named `a` is not refused by `takenSlice` (covers 7)
- unit: claude/hooks/ship.test.ts — an ordinary resume ship with a live record
  keeps `gtdStackRetired`; forgetting the stack still unsets it (covers 7)
- unit: claude/hooks/ship.test.ts — `resumable` asks
  `git symbolic-ref … origin/HEAD` once per ship, not twice (covers 8)

### pushBranch

- unit: claude/hooks/ship.test.ts — with no `lease` argument and
  `branch.<b>.gtdLease` set, pushes `--force-with-lease=<b>:<key sha>` even when
  HEAD is an ancestor of `origin/<b>` (covers 5)
- unit: claude/hooks/ship.test.ts — a successful leased push unsets the key only
  when it was set; a killed push keeps it (covers 5)
- unit: claude/hooks/ship.test.ts — with no key set, behaviour is exactly
  today's (set-upstream, ancestor shortcut, plain `--force-with-lease`)
  (covers 5)

### defaultBranch

- unit: claude/hooks/handoff.test.ts — throwing from the default branch still
  reads it via `origin/HEAD` and falls back to `main` when unset; the existing
  throw tests stay green unchanged (covers 8)

### Chores

- chore: docs/driver.md — restack paragraph: the failed-abort mid-rebase text
  (1); rollback on a rebase that moved refs then failed, or left a slice with no
  commit of its own (2, 3); the unrelated-branch refusal under ship and `-n`
  (4); the persisted `branch.<b>.gtdLease`, that it holds across a fetch and
  retry, and the `git config --local --unset` line to overwrite on purpose (5);
  the hand restack of a multi-commit top-only remainder now resumed (6)
  (covers 9)
- chore: README.md — the restack sentence lists the new refusals (unrelated
  branch, slice already upstream) next to the existing two (covers 9)

## Merged Concerns

**Concerns 1–8 merge into one package**: all eight change `claude/hooks/ship.ts`
— 1–4 inside `restackOf`'s run and its new shared `rollback`, 5 and 7 in
`restacked`/`pushBranch`/`takenSlice`, 6 in `handRestack`, 8 in `resumable`'s
signature (plus `handoff.ts`). Concern 9 stays separate: it only consumes the
texts 1–6 create, in `docs/driver.md` and `README.md`.

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

### How does concern 6 tell a hand restack of a multi-commit top from an unrelated rebase?

By commit identity, not patch: the first commit above `origin/<default>` must
carry the recorded top's author, email, author date and message, which a rebase
keeps even after a hand-resolved conflict (where a patch-id would differ); the
requirement's own `merge-base`-is-parent test alone holds for any linear branch,
so it would loosen the guard.

### Where does concern 5 read the persisted lease?

Inside `pushBranch`, the one push path every caller shares, so stack resumes,
single-PR retries and `/gtd throw` all honour it without plumbing.

### Does the lease key get written before or after the shrunken record?

Before: a failed lease write then refuses with the record untouched, and a
failed record write leaves the leases in place for the hand-restack path.

### How is the dropped-commit shape (concern 3) checked?

`<b>~1` must equal the next-lower branch (or `origin/<default>`) by sha, and the
top needs ≥ 1 commit above its lower; a scratch-repo run confirmed a dropped
slice leaves its branch on `onto` itself, which this catches and a
`rev-list --count` alone would not place.

### Can the concern 4 check over-refuse, since it runs before the same-run squash?

Only for a local branch sitting on an unsquashed process commit of the top
slice, which the squash would drop from the range; accepted, because checking
after the squash would break "a refusal changes nothing".

### Does storing merged names in `gtdStackRetired` collide with its retry role?

Not once two rules change: `retireStack` writes the union instead of
overwriting, and the post-PR unset fires only when the run started with no live
record; a moved-aside record then also carries merged names, which lets
`pullRequest` retarget a PR still based on a merged slice branch.

### Is the concern 8 refactor its own package?

No — it edits `resumable`'s signature, the same function concern 6 changes, so
it rides in the ship.ts package.
