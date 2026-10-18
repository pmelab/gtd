# 01 — Ship: stack record read up front, scoped retarget, top-commit guard

Merged concerns 1, 2, 3 and 4 of `.gtd/ARCHITECTURE.md`. All centre on
`claude/hooks/ship.ts` and `claude/hooks/ship.test.ts`; `ship`'s exported
signature stays unchanged.

## Requirements

### 1. Single-branch ship retargets only a PR based on a recorded slice branch

- **Retarget only when the PR's base is `<branch>-<name>` for a `<name>` in
  `branch.<branch>.gtdStack`.** Any other base stays untouched: no
  `gh pr edit --base`
- The `Stacked on #N — merge that first` line is stripped only together with
  that retarget
- **Risk: today the record is unset before the PR step** (single-slice squash,
  commits-mode squash, "no longer chains" drop). Read the names before any unset
  and hand them to the PR step, or the fix retargets nothing
- **Risk: a retarget failing after the unset leaves no record**, so a retry
  never retargets. Unset only after the PR step succeeds

### 2. Stack mode retargets a thrown draft too

- **A thrown draft whose base differs from the slice's target is retargeted
  before it is rewritten and marked ready**
- A failed retarget stops that slice at step `retarget`, nothing rewritten, the
  THROWN marker intact so a retry comes back

### 3. A commits-mode ship with no process unsets `gtdStack`

- **No-process commits ship unsets the record (never on a dry run)**, matching
  commits mode with a process
- It reads the record first, so requirement 1 still retargets off a recorded
  slice branch

### 4. A resume rebuilds a missing slice branch only when HEAD is the recorded top

- **New key `branch.<branch>.gtdStackTop` = full sha of HEAD when the stack was
  built**, set beside the names, unset with them
- **Missing slice branch: rebuild only when `rev-parse HEAD` equals the recorded
  top; otherwise refuse with nothing changed**, naming the missing branch and
  `git config --local --unset branch.<branch>.gtdStack`
- A pre-change record (names, no top) never authorises a rebuild
- Missing check runs before the chain check; a dry run refuses with the same
  text; with every branch present, today's chain check alone decides
- **Accepted risk: a stack-mode retry after a failed single-slice PR step
  resumes the old stack when its slice branches still chain to HEAD**

## Tasks

### Task 1: Read the record once, defer the forget to after the PR step

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] `ship()` reads `branch.<branch>.gtdStack` before any squash and passes the
      names to the single-branch PR step
- [ ] The three early unsets (single-slice squash, commits-mode squash, chain
      dropped) become a `forget` flag on the squash result; no unset runs inside
      `squash`
- [ ] No-process commits mode sets `forget` too
- [ ] `ship()` unsets both keys only after the PR step returns ok, never on a
      dry run
- [ ] Failed retarget keeps the record (no `--unset`); a second run with the
      same record retargets
- [ ] No-process commits dry run unsets nothing; a following no-record stack
      ship ships the branch alone (one PR into main, no `git branch -f`)

### Task 2: Retarget only off a recorded slice branch

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] PR base in `<branch>-<name>` for a recorded `<name>` →
      `gh pr edit --base     <default>` and stack line stripped
- [ ] Unrecorded non-default base (`release/1`, and a slice-looking base absent
      from the record) → no `gh pr edit --base`, no `--body-file` strip; refresh
      proceeds as for any open PR
- [ ] "stacked PR shipped as a single branch" fixture gains the record and
      passes; "taking a PR off a stack with nothing new" and "a failed retarget
      of a once-stacked PR" pass with the record scripted
- [ ] Single-slice and chain-dropped paths retarget, unset after the retarget

### Task 3: Stack mode retargets before the thrown/not-thrown split

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] Thrown draft on the wrong base gets `gh pr edit <n> --base <lower>` before
      `gh pr ready <n>` and its rewrite
- [ ] Failed retarget of a thrown draft stops at step `retarget`; no
      `gh pr ready`, no title/body edit
- [ ] "a thrown draft on the upper slice is rewritten with the stack line and
      marked ready" keeps passing

### Task 4: Record the stack top and guard the resume rebuild

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] Fresh stack build writes `branch.feat/x.gtdStackTop <top commit>`, then
      the names key, then `git branch -f` per lower slice
- [ ] Failed top-key write undoes the squash (`git reset --soft ORIG_HEAD`); no
      branch, push or `gh` call
- [ ] Every forget (single-slice, commits mode, chain dropped) unsets both keys
- [ ] Missing slice branch, top = HEAD → rebuilt and resumed (the "failed git
      branch -f" second run gains the top)
- [ ] Missing slice branch, HEAD moved → refusal naming the branch and
      `git config --local --unset branch.feat/x.gtdStack`; no `git branch -f`,
      no push, no `gh pr` write, no unset
- [ ] Missing slice branch, no top recorded → same refusal
- [ ] Dry run with a missing branch at the recorded top never runs
      `git branch -f`
- [ ] Every slice branch present, HEAD moved → chain check decides: chaining
      resumes, non-chaining ships alone

### Task 5: Gate

- [ ] `npm test` green; `lint:boundaries`, typecheck and `format:check` clean

## Tests

- unit: `claude/hooks/ship.test.ts`
