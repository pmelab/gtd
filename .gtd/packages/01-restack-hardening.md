# 01 — PR #392 review round 2: restack hardening

Interfaces, config keys, refusal texts and call stacks: `.gtd/ARCHITECTURE.md`
(`## Interfaces`, `## Call Stacks`). Footprint: `claude/hooks/ship.ts`,
`claude/hooks/ship.test.ts`, `claude/hooks/handoff.ts`,
`claude/hooks/handoff.test.ts`, `docs/driver.md`, `README.md`. **No e2e change:
`/gtd ship` lives in the Claude Code mod, which no cucumber harness drives.**
Every test drives the exported `ship()` / `pushBranch()` with the scripted
`ShipIo`; no internal helper is tested directly. `ship()` and `pushBranch()`
keep their signatures.

One package: concerns 1–8 all centre on `ship.ts`; concern 9 (docs) only
describes this slice's texts, so it rides as the last task instead of costing a
second full-suite run.

**Out of scope: rewriting the restack as an off-tree `merge-tree` + `update-ref`
transaction.**

## Requirements

### 1. PRODUCT: Failed abort after a conflict says mid-rebase

**When `git rebase --abort` fails after a conflict, say the repo is mid-rebase
and tell the user to run `git rebase --abort` by hand** — never claim "tree and
refs are as before". The successful-abort text stays exactly as today.

### 2. PRODUCT: Non-zero rebase with no rebase dir is rolled back when refs moved

A non-zero exit with no `rebase-merge` dir can mean every pick finished and only
the final `--update-refs` update failed. **Compare HEAD and every lower slice
ref against their pre-rebase values; if anything moved, roll back (restore refs
and HEAD; print the `update-ref`/`reset --keep` lines if restoring fails).**
Only when nothing moved does "refs are unchanged" stay.

### 3. PRODUCT: A slice left with no commit of its own is rolled back and refused

**After a clean rebase, each remaining lower slice branch must sit exactly one
commit above the next-lower one (`origin/<default>` for the lowest), and the top
must have ≥ 1 commit above its lower.** Otherwise roll back (same rollback as 2)
and refuse naming the slice.

### 4. PRODUCT: Refuse when an unrelated local branch sits inside the range

**Before the rebase — and under `-n` — refuse with nothing changed when a local
branch other than the remaining slice branches, the top branch and the merged
slice branch points at a commit in `from..branch`, naming it.** **Risk:
over-refuses a branch sitting on an unsquashed top-slice process commit** —
accepted, so a refusal still changes nothing.

### 5. PRODUCT: A rejected leased push keeps its lease on retry

**Persist each moved branch's lease (origin's sha from `ls-remote`) as
`branch.<b>.gtdLease` before the record shrinks; `pushBranch` uses it for every
later push of that branch until one succeeds, then unsets it.** A killed or
rejected push keeps it. **The rejection names
`git config --local --unset branch.<b>.gtdLease`** for a deliberate overwrite.
**Risk: without this, a fetch + re-ship overwrites a collaborator's commit.**

### 6. PRODUCT: Hand restack of a multi-commit top-only remainder resumes

**Stack `[a, top]`, `top` re-shipped with several commits, `a` squash-merged,
hand rebase done: the next ship resumes (leased push, retarget, no rebase).**
Detect only when one slice remains: the first commit of
`origin/<default>..<lowest>` has its parent on `origin/<default>` and the same
author name, email, author date and message as the recorded top (`gtdStackTop`).
**An unrelated rebase of the same shape still drops the record and force-pushes
nothing.**

### 7. PRODUCT: A merged slice name can be reused in a later stack

**A restack adds the merged slice names to `gtdStackRetired`; `takenSlice`
treats `gtdStack ∪ gtdStackRetired` names as gtd-built.** `retireStack` writes
the union; the post-PR unset fires only when the run started with no live
record; `forgetStack` still clears it.

### 8. TECHNICAL: One default-branch lookup

**Export `defaultBranch(git)` from `ship.ts`; `handoff.ts` `throwBranch` calls
it. `preflight`'s `baseBranch` is threaded into `resumable`, which no longer
re-reads `origin/HEAD`.** No behaviour change.

### 9. PRODUCT: Docs

`docs/driver.md` restack paragraph and the `README.md` restack sentence state
the new refusals, rollbacks, persisted lease and resumed hand-restack shape.
**Neither names a `claude/hooks/*.ts` module or internal function.**

## Tasks

Order: 8 first (signature refactor others build on), then 2 (introduces the
shared `rollback`), 1, 3, 4, 5, 7, 6, docs last. Write each task's tests first
in the named test file and watch them fail.

### Task 1: `defaultBranch` export and threaded `baseBranch` (concern 8)

- [ ] `export async function defaultBranch(git)` in `ship.ts`, falling back to
      `"main"`; `handoff.ts` `throwBranch` calls it instead of inlining the
      `origin/HEAD` read
- [ ] `resumable(io, git, ok, branch, baseBranch, isDry, at, planRestack)`;
      `baseBranch` threaded from `preflight` through `squash` → `plan` /
      `resumeAlone` / `stackReads` / `stackPrecheck` / `recordedRefusal`
- [ ] A resume ship asks `git symbolic-ref … origin/HEAD` exactly once
- [ ] `handoff.test.ts`: throwing from the default branch reads it via
      `origin/HEAD`, falls back to `main` when unset; existing throw tests green
      unchanged

Paths: `claude/hooks/ship.ts` (`defaultBranch`, `preflight`, `squash`,
`resumable` and callers), `claude/hooks/handoff.ts` (`throwBranch`),
`claude/hooks/ship.test.ts`, `claude/hooks/handoff.test.ts`

### Task 2: Shared `rollback` and the no-dir failure path (concern 2)

- [ ] New `rollback(pre, preHead)` runs `git update-ref` per moved lower ref and
      `git reset --keep <preHead>`; `unmovedSlice` calls it; on failure prints
      "<why>, and the rollback failed: …" plus the `git update-ref` /
      `git reset --keep` hand lines
- [ ] Non-zero exit, no `rebase-merge` dir, HEAD moved: rollback runs; text
      starts exactly
      `git rebase failed after moving refs; the slice branches     and HEAD are restored and nothing was pushed or recorded.` +
      stderr + undo line if squashed; never "refs are unchanged"; no push, no
      `git config --local` write
- [ ] Same with only a lower slice ref moved (HEAD unchanged): rolled back
- [ ] Same with the rollback's `update-ref` failing: hand lines printed
- [ ] Nothing moved: `git rebase failed; refs are unchanged.` kept, no
      `update-ref`/`reset` run

Paths: `claude/hooks/ship.ts` (`Restack.run`, `unmovedSlice`, new `rollback`),
`claude/hooks/ship.test.ts`

### Task 3: Failed abort text (concern 1)

- [ ] Conflict, `git rebase --abort` exits non-zero: text (1) from ARCHITECTURE
      `## Interfaces` — "…the repository is mid-rebase. Run git rebase --abort
      by hand, then rebase by hand…" + abort stderr + undo line; never "tree and
      refs are as before"; nothing pushed or recorded
- [ ] Conflict, abort succeeds: today's "tree and refs are as before" text
      unchanged

Paths: `claude/hooks/ship.ts` (`Restack.run`), `claude/hooks/ship.test.ts`

### Task 4: Stack-shape check after a clean rebase (concern 3)

- [ ] New `brokenShape`: for each lower slice `rev-parse <b>~1` equals
      `rev-parse <below>` (`origin/<default>` for the lowest), and
      `rev-list --count <lowerTop>..HEAD` ≥ 1; runs after `unmovedSlice`
- [ ] Three slices, `feat/x-middle~1` ≠ `origin/main` after the rebase: rolled
      back, refusal (3) naming slice `middle`; no push, no `git config --local`
      write
- [ ] Top with no commit above its lower: rolled back, refused naming the top
      slice
- [ ] Rollback failing here prints the same hand lines as task 2

Paths: `claude/hooks/ship.ts` (`Restack.run`, new `brokenShape`),
`claude/hooks/ship.test.ts`

### Task 5: Unrelated-branch refusal (concern 4)

- [ ] New `strayBranch` in `restackOf` after `checkedOutElsewhere`:
      `git rev-list <from>..<branch>` +
      `git for-each-ref     --format=%(objectname) %(refname) refs/heads/`
- [ ] `backup` at a lower slice commit: refusal exactly
      `Branch backup points     into the commits the restack rebases, so git rebase --update-refs would     move it too; nothing changed. Move or delete it, then /gtd ship.`
      — no fetch-dependent write, rebase, squash or push
- [ ] Same refusal under `-n`
- [ ] Remaining slice branches, top branch and the merged slice's branch inside
      the range never refuse

Paths: `claude/hooks/ship.ts` (`restackOf`, new `strayBranch`),
`claude/hooks/ship.test.ts`

### Task 6: Persisted lease (concern 5)

**Risk: dropping the lease on retry lets a re-ship overwrite a collaborator's
commit.**

- [ ] `restacked` writes `git config branch.<b>.gtdLease <origin sha>` per moved
      branch origin had, **before** the record shrinks; a failed write gives
      today's "git config failed after the restack" text with the record
      untouched
- [ ] `pushBranch` with no `lease` and the key set pushes
      `--force-with-lease=<b>:<key sha>`, even when HEAD is an ancestor of
      `origin/<b>`
- [ ] Successful leased push unsets the key only when it was set; killed push
      keeps it
- [ ] No key set: exactly today's behaviour (set-upstream, ancestor shortcut,
      plain `--force-with-lease`)
- [ ] Restack, top push rejected, tracking ref moved to the collaborator's
      commit, ship again: push uses the old lease and refusal names
      `git config --local --unset branch.<b>.gtdLease`; after a later successful
      push the key is unset
- [ ] One-slice-left restack persists the top branch's lease; the single-PR
      retry still pushes leased
- [ ] `forgetStack` never touches `gtdLease`

Paths: `claude/hooks/ship.ts` (`restacked`, `pushBranch`, `originLeases`),
`claude/hooks/ship.test.ts`

### Task 7: Merged names in `gtdStackRetired` (concern 7)

- [ ] `restacked` best-effort adds merged slice names to `gtdStackRetired` after
      `gtdStackTop` (a failed write only over-refuses later)
- [ ] `retireStack` writes the union of existing and live names
- [ ] `ship()` unsets `gtdStackRetired` after a successful PR step only when no
      live record existed at run start
- [ ] `takenSlice` dead set = `gtdStack` names ∪ `gtdStackRetired` names
- [ ] Restack with ≥ 2 slices left adds `a`; a later fresh stack with a slice
      named `a` is not refused
- [ ] Ordinary resume ship with a live record keeps `gtdStackRetired`;
      forgetting the stack still unsets it

Paths: `claude/hooks/ship.ts` (`restacked`, `retireStack`, `ship`,
`stackPrecheck`, `takenSlice`), `claude/hooks/ship.test.ts`

### Task 8: Multi-commit top-only hand restack (concern 6)

- [ ] `handRestack`, only when one slice remains (lowest is the top branch):
      first = head of `git rev-list --reverse origin/<default>..<lowest>`;
      `<first>^` ancestor of `origin/<default>` and
      `git log -1 --format=%an%x00%ae%x00%at%x00%B` of `first` equals that of
      the recorded top → hand restack
- [ ] `[a, top]`, `top` multi-commit, `a` squash-merged, hand rebase done: next
      ship resumes — leased push, retarget, no rebase
- [ ] Same shape, first commit not the recorded top's copy: record dropped, no
      `--force-with-lease`
- [ ] Existing hand-restack cases (`from` ancestor, `<lowest>~1` on
      `origin/<default>`) unchanged

Paths: `claude/hooks/ship.ts` (`handRestack`), `claude/hooks/ship.test.ts`

### Task 9: Docs (concern 9)

- [ ] `docs/driver.md` restack paragraph: failed-abort mid-rebase text; rollback
      when a rebase moved refs then failed, or left a slice with no commit of
      its own; unrelated-branch refusal under ship and `-n`; persisted
      `branch.<b>.gtdLease`, that it holds across a fetch and retry, and the
      `git config --local --unset` line to overwrite on purpose; multi-commit
      top-only hand restack now resumed
- [ ] `README.md` restack sentence lists the new refusals (unrelated branch,
      slice already upstream) next to the existing two
- [ ] Neither doc names a `claude/hooks/*.ts` module or internal function
      (AGENTS.md)
- [ ] `docs/**` is doc-tested input: `npm test` stays green

Paths: `docs/driver.md`, `README.md`

## Verification

- [ ] `npx vitest run --project unit claude/hooks/ship.test.ts claude/hooks/handoff.test.ts`
      green
- [ ] `npm test` green (full suite, all flag states)

## Tests

- unit: `claude/hooks/ship.test.ts`
- unit: `claude/hooks/handoff.test.ts`
