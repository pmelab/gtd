# 01 — PR #392 review round 1: ship restack fixes

Interfaces, argv contract, refusal texts and seams: `.gtd/ARCHITECTURE.md`
(`## Interfaces`). Footprint: `claude/hooks/ship.ts`,
`claude/hooks/ship.test.ts`, `docs/driver.md`, `README.md`. **No e2e change:
ship's scripted test repository is ship's whole suite.** Every test drives
`ship()`; no internal helper is tested directly. `ship()` keeps its exported
signature.

One package: concerns 1–9 centre on `ship.ts`/`ship.test.ts`; the docs (10)
describe this slice's behaviour, so they ride as its last task instead of a
separate full-suite run.

## Requirements

### 1. TECHNICAL: Fetch the default branch with an explicit refspec

`git fetch origin <base>` updates `origin/<base>` only when the remote carries a
default refspec. **Fetch `+refs/heads/<base>:refs/remotes/origin/<base>`
explicitly** in the restack, so it always rebases onto the freshly fetched tip.

### 2. TECHNICAL: Detect an in-progress rebase by the rebase-merge dir

Detection reads only `REBASE_HEAD`. **Treat a rebase as in progress whenever
`git rev-parse --git-path rebase-merge` exists, and abort it in every such
case.**

### 3. TECHNICAL: Count a slice merged only when it merged into the default branch

**Only a `MERGED` PR whose `baseRefName` equals the default branch counts;
`done` stops at the first that does not. Any other base — another slice branch,
or a missing `baseRefName` — refuses with nothing changed**: no fetch, rebase,
config write, push or retarget.

### 4. TECHNICAL: Stop trusting the local merged slice branch as `from`

**`<from>` is always the floor, `<recorded top>~(last-(done-1))`; the
`refs/heads/<branch>-<merged slice>` lookup is deleted** from the restack and
hand-restack paths. **Risk: a record with no `gtdStackTop` now yields no `from`,
so a hand restack on it drops the record and ships alone.**

### 5. TECHNICAL: Detect a hand restack after origin moves on

**Replace `is-ancestor origin/<default> <lowest>` with
`is-ancestor <lowest>~1 origin/<default>`.** **Risk: a multi-commit top as the
only remaining slice fails this test after a hand restack and ships alone**
(still leased push and retarget; only the log line differs).

### 6. TECHNICAL: Refuse when `--update-refs` skipped a slice branch

**Precheck: a remaining lower slice branch listed by
`git worktree list --porcelain` refuses before the rebase, and under `-n`.**
**Backstop: after a zero-exit rebase, before any config write or push, every
remaining lower slice branch must contain `origin/<default>` and not `<from>`;
otherwise roll every moved ref back (`update-ref`, `reset --keep`) and refuse
naming branch and worktree.**

### 7. TECHNICAL: Skip restack planning in recordedRefusal's dry call

**`recordedRefusal`'s dry `resumable` call runs no `git fetch`, no
`git ls-remote`, no `git worktree list`, no hand-restack check.** **Risk: a
hand-restacked live record reads as dead, so a fresh multi-slice ship replaces
it and leaves its remaining slice PRs open** — accepted.

### 8. TECHNICAL: Drop the duplicate Retarget preview line

**Remove `retarget` from `restackOf`; `stackPreview` prints the only `Retarget:`
line.**

### 9. TECHNICAL: Share the from-lookup and link building; fix the shadowed name

**One `stackRest` helper serves `finishResume` and `handRestack`; `topGuard`'s
rebased variant carries `top`, so `TOP_KEY` is read once; `resumable` reads the
default branch once; `restacked`'s local `names` becomes `written`.**
Behaviour-neutral. Lands after 4 and 5.

### 10. PRODUCT: Docs

`docs/driver.md` restack paragraph and the `README.md` ship sentence state the
new refusals, the rolled-back backstop, and the new hand-restack shape.
**Neither names a `src/*.ts`/`claude/hooks/*.ts` module or internal function.**

## Tasks

Order 1–8, then the refactor (9), then docs (10). Write each task's tests first
in `claude/hooks/ship.test.ts` and watch them fail.

### Task 1: Refspec fetch

- [ ] Restack runs `git fetch origin +refs/heads/main:refs/remotes/origin/main`,
      never bare `git fetch origin main`, then rebases onto `origin/main`; `-n`
      still skips the fetch
- [ ] Failed fetch refuses with exactly
      `git fetch origin +refs/heads/<base>:refs/remotes/origin/<base> failed; nothing changed.`
      plus stderr; nothing written
- [ ] Existing tests' fetch argv updated, nothing else in them

Paths: `claude/hooks/ship.ts` (`restackOf`), `claude/hooks/ship.test.ts`

### Task 2: rebase-merge detection

- [ ] After a non-zero rebase: `git rev-parse --git-path rebase-merge`, then
      `test -d <path>` via `io.run`; exists → `git rebase --abort`
- [ ] `REBASE_HEAD` only names the slice; absent with `rebase-merge` present →
      abort runs, conflict refusal names the top slice; no push, no `git config`
      write, no `gh pr edit`
- [ ] No `rebase-merge` dir (old git): no abort, stderr reported, refs unchanged

Paths: `claude/hooks/ship.ts` (`Restack.run`), `claude/hooks/ship.test.ts`

### Task 3: Merged-into-default only

- [ ] `mergedSlices(io, recorded, branchOf, baseBranch)` returns
      `{ done } | string`; views no longer returned
- [ ] Lowest PR `MERGED` into `feat/x-other`: refusal exactly
      `The pull request for slice <name> (#<n>, <sliceBranch>) merged into <baseRefName>, not <default>; nothing changed. Ship the branch alone with GTD_SHIP_MODE=commits.`
      — no fetch, rebase, `git config` write, push or `gh pr edit`
- [ ] Missing `baseRefName` refuses the same way
- [ ] `MERGED` with `baseRefName: "main"` restacks as today

Paths: `claude/hooks/ship.ts` (`mergedSlices`, `resumable`),
`claude/hooks/ship.test.ts`

### Task 4: Floor-only `from`

- [ ] Local `feat/x-refactor` diverged from the floor: the rebase uses the floor
      commit, never the local sha
- [ ] Hand restack with a stale local merged branch: `<from>` is the floor and
      the hand restack is still adopted
- [ ] No `refs/heads/<branch>-<slice>` read remains in either path
- [ ] `finishResume` still refuses
      `The commit of merged slice … cannot be found` when no `from` resolves

Paths: `claude/hooks/ship.ts` (`finishResume`, `handRestack`),
`claude/hooks/ship.test.ts`

### Task 5: Hand-restack shape test

- [ ] Hand restack, then origin advanced (`origin/main` not under the lowest
      branch, `<lowest>~1` under `origin/main`): leased pushes, lowest PR
      retargeted, stack kept
- [ ] `<lowest>~1` not under `origin/main`: not a hand restack, record drops,
      branch ships alone

Paths: `claude/hooks/ship.ts` (`handRestack`), `claude/hooks/ship.test.ts`

### Task 6: Other-worktree precheck and backstop

**Risk: leaving refs rebased after a skipped branch makes the next ship see a
broken chain and silently drop the stack — roll back every moved ref.**

- [ ] `checkedOutElsewhere(io, branches)` parses `git worktree list --porcelain`
      (`worktree <path>` / `branch refs/heads/<b>` blocks), returns the first
      hit, `undefined`, or a refusal string on failure
- [ ] Precheck runs after the merge-commit shortcut, before the rebase, and
      under `-n`
- [ ] Three slices, `feat/x-middle` at `/elsewhere`: refusal exactly
      `Slice branch feat/x-middle is checked out in worktree /elsewhere, so git rebase --update-refs would skip it; nothing changed. Free it there (git -C /elsewhere switch --detach), then /gtd ship.`
      — no rebase, no push, no `git config` write; `-n` prints the same refusal
- [ ] Rebase exits 0 but `feat/x-middle` still contains `<from>` (or lacks
      `origin/<default>`): `update-ref refs/heads/<b> <pre> <post>` for each
      moved lower branch and `reset --keep <pre-rebase HEAD>` run, then refusal
      `Slice branch <b> was not restacked[ (checked out in worktree <path>)]; the restack is undone and nothing was pushed or recorded.`
      — no push, no `git config` write
- [ ] Backstop after a same-run squash appends the existing
      `the squash was kept; undo it with git reset --soft <preShip>` line

Paths: `claude/hooks/ship.ts` (`restackOf`, `Restack.run`, new
`checkedOutElsewhere`), `claude/hooks/ship.test.ts`

### Task 7: Dry call skips restack planning

- [ ] `resumable(…, planRestack = true)`; `recordedRefusal` passes `false`,
      which skips `handRestack` and `restackOf`; `mergedSlices`, `topGuard`,
      `chain` still run
- [ ] Fresh multi-slice ship over a record with a merged lower slice: no
      `ls-remote`, no `fetch`, no `worktree list`; a scripted failing
      `ls-remote` does not refuse

Paths: `claude/hooks/ship.ts` (`resumable`, `recordedRefusal`),
`claude/hooks/ship.test.ts`

### Task 8: One Retarget line

- [ ] `restackOf` loses `retarget` and its preview line
- [ ] `-n` after a merged lower slice prints exactly one line starting
      `Retarget:`

Paths: `claude/hooks/ship.ts` (`restackOf`, `stackPreview`),
`claude/hooks/ship.test.ts`

### Task 9: Shared `stackRest`, single reads, rename

- [ ] `stackRest(git, { branch, recorded, done, top, commits, branchOf })`
      returns `{ from?, links }`; both `finishResume` and `handRestack` call it
- [ ] `topGuard` returns `{ top } | { rebased: true; top } | { refusal }`;
      `handRestack` reads no default branch, `TOP_KEY` or `from` itself;
      `resumable` reads the default branch once
- [ ] `finishResume` drops its `views` parameter
- [ ] `restacked`'s local `names` renamed `written`
- [ ] A hand-restack ship runs
      `git config --local --get branch.feat/x.gtdStackTop` exactly once
- [ ] Every existing case in the `a lower slice merged by squash` block passes;
      only argv edits forced by tasks 1, 2, 4 and 8 touch it

Paths: `claude/hooks/ship.ts` (`stackRest`, `topGuard`, `handRestack`,
`finishResume`, `resumable`, `restacked`), `claude/hooks/ship.test.ts`

### Task 10: Docs

- [ ] `docs/driver.md` restack paragraph (around "spots that hand restack"): add
      the merged-into-a-slice-branch refusal, the other-worktree refusal (and
      that `-n` shows it), the rolled-back backstop; hand-restack shape becomes
      "the lowest remaining slice sits on a commit of `origin/<default>`"
- [ ] `README.md` ship sentence (re-running `/gtd ship` … restacks): add that
      the restack refuses, with nothing changed, when a lower pull request
      merged into another slice branch or a slice branch is checked out in
      another worktree
- [ ] Neither doc names a `src/*.ts`/`claude/hooks/*.ts` module or internal
      function (AGENTS.md)
- [ ] `docs/**` is a doc-tested input: `npm test` stays green

Paths: `docs/driver.md`, `README.md`

## Verification

- [ ] `npx vitest run --project unit claude/hooks/ship.test.ts` green
- [ ] `npm test` green (full suite, all flag states)

## Tests

- unit: `claude/hooks/ship.test.ts`
