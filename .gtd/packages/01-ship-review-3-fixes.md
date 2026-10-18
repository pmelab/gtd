# 01 — Ship: gh failures refuse, live stack refuses, sinceHead floors at from

**One package for concerns 1, 2 and 3** — all live in `claude/hooks/ship.ts`,
tested in `claude/hooks/ship.test.ts`. Concern 4 builds nothing.

**Test only through `ship()` with the scripted `ShipIo`** — never a private
helper. No e2e change: no cucumber tier drives `claude/`.

## Requirements

### 1. A failing `gh pr view` refuses instead of reading as "no PR"

- **Only a non-zero exit whose stderr contains `no pull requests found`
  (case-sensitive) means "no PR".** Anything else refuses.
- **Refusal names the branch and carries gh's stderr; it lands before that
  step's first write.** Pre-squash read failing → repository unchanged (HEAD,
  branches, config, remote).
- **Risk: `pullRequest` and the slice loop run after the squash** — the squash
  stays; refusal lands before that step's push and `gh pr create/edit`;
  `/gtd ship` resumes.
- Dry runs refuse the same way.

### 2. A fresh multi-slice stack ship refuses over a live recorded stack

- **Refuse when `branch.<branch>.gtdStack` holds any name, mode is `stack`, more
  than one landed slice** — before the history push, dry runs too.
- **`gtdStackRetired` alone never refuses.**
- Unaffected: single-slice re-ship onto the stack, no-process resume,
  `GTD_SHIP_MODE=commits`.

### 3. `sinceHead` uses the synced head only when it sits above `from`

- **Use `prSyncHead` only if it resolves, is an ancestor of `to`, AND `from` is
  an ancestor of it**; otherwise `from`. Serves single PR and stacked slices.

### 4. Deferred review notes stay

- **`.gtd/TODO.md`'s three `## Deferred review notes` sections (836985b,
  daed27f, eda53bb) stay byte for byte.**

## Tasks

### Task 1: `viewPr` distinguishes absence from failure (concern 1)

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] `viewPr` returns `undefined` only on non-zero exit with stderr containing
      `no pull requests found`; any other non-zero exit returns
      `gh pr view <branch> failed: <stderr, trimmed>`; unreadable-JSON refusal
      unchanged
- [ ] Every scripted "no PR" reply in `ship.test.ts` (`{ code: 1 }` on
      `gh pr view …` in `feature` and the `ship stack` `sbase`) gains
      `err: 'no pull requests found for branch "<b>"'`
- [ ] Test: stderr `no pull requests found for branch "feat/x"` → `gh pr create`
      as today
- [ ] Test: single branch, no gtd process, `gh pr view` exits 1 with stderr
      `HTTP 401: Bad credentials` → fails naming `feat/x` and the stderr; no
      `git push`, no `gh pr create/edit`, no `git config` write
- [ ] Test: fresh two-slice stack, lower slice's `gh pr view` fails → fails
      naming `feat/x-refactor` and the stderr; no history push, `commit-tree`,
      `reset`, `git branch -f`, `git config` write, `git push` or gh write
- [ ] Test: same setup as a dry run → same refusal, nothing written
- [ ] Test: resume of a recorded stack (no gtd process), a slice's `gh pr view`
      fails → refusal; no `git branch -f`, `--unset`, push or gh write
- [ ] `handoff.ts`'s own `gh pr view` untouched

### Task 2: read the PR before pushing (concern 1)

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] `pullRequest` keeps `mergeBase` checks first, then `viewPr`, then
      `pushBranch`; refusal reads `<viewPr refusal> Nothing was pushed.`
- [ ] `stackPullRequests` calls `viewPr` per slice before `pushLink` and passes
      the view to `sliceStep(io, git, ok, l, view, base, lowerRef, ctx)`;
      `sliceStep` no longer calls `viewPr`
- [ ] Test: single-slice process, `gh pr view` fails after the squash → fails
      naming branch and stderr; squash stays; no `git push`, no
      `gh pr create/edit`
- [ ] Test: stacked PR step, upper slice's `gh pr view` fails after the lower
      landed → fails at step `pull request`, lists `refactor` as landed, never
      pushes `feat/x`
- [ ] Test: each slice's `gh pr view` precedes that slice's `git push` in
      `ran()` order
- [ ] Existing unreadable-JSON test on a real single-branch ship also asserts no
      `git push`

### Task 3: `stackPreview` refuses on a string view (concern 1)

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] `stackPreview` returns `{ refusal: "<viewPr refusal> Nothing changed." }`
      instead of dropping a string view into "would open"; `ship()` fails with
      it
- [ ] Test: dry-run stack whose `gh pr view` succeeds in the precheck then fails
      on the preview read (stateful `io.run`) → ship fails with the refusal,
      never prints "would open"

### Task 4: live-record refusal in `stackPrecheck` (concern 2)

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] `stackPrecheck` reads `branch.<branch>.gtdStack` first; any name refuses
      with exactly:
      `<branch> already has a recorded stack (<names, comma-separated>); nothing changed. Ship with GTD_SHIP_MODE=commits, or run git config --local --unset branch.<branch>.gtdStack and git config --local --unset branch.<branch>.gtdStackTop, then ship again.`
- [ ] `gtdStackRetired` never read there
- [ ] `takenSlice` drops its "named in the record is not a collision" skip
- [ ] Test: stack mode, two landed slices, `branch.feat/x.gtdStack` set → fails;
      text contains `GTD_SHIP_MODE=commits` and
      `git config --local --unset branch.feat/x.gtdStack`; no history push,
      `commit-tree`, `reset`, `git branch -f`, `git config` write, `git push` or
      gh call
- [ ] Test: same setup as a dry run → same refusal, nothing written
- [ ] Test: same setup with `GTD_SHIP_MODE=commits` → ships one PR as today
- [ ] Existing "a fresh stack shipped over a leftover retired record keeps its
      own record" still passes
- [ ] "a branch named in gtdStack is not a collision" replaced by the refusal
      test; one-slice re-ship onto the stack and no-process resume tests pass
      unchanged

### Task 5: `sinceHead` floors at `from` (concern 3)

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] `sinceHead` adds `git merge-base --is-ancestor <from> <synced>`; all three
      checks must hold, else `from`
- [ ] Test: single PR, `prSyncHead` S, `is-ancestor <merge-base> S` exits 1 →
      count and log use `<merge-base>..HEAD`, never `S..HEAD`
- [ ] Test: single PR, S between merge-base and HEAD → `S..HEAD`
- [ ] Test: S missing, or `is-ancestor S HEAD` exits 1 → `<merge-base>..HEAD`
- [ ] Test: stacked upper slice, its `prSyncHead` below lower slice commit C1 →
      range `C1..C2`

### Task 6: docs (concerns 1, 2)

Paths: `docs/driver.md`

- [ ] Ship paragraph (near the merged/closed-PR refusals, ~line 400): one
      sentence — a fresh multi-slice stack ship on a branch with a recorded
      stack refuses, naming `GTD_SHIP_MODE=commits` or unsetting
      `branch.<branch>.gtdStack` and `gtdStackTop`
- [ ] One clause: a `gh pr view` failure other than "no pull request" refuses
      before that step's writes
- [ ] No `src/*.ts` module or internal function named in the prose

### Task 7: keep deferred notes (concern 4)

Paths: `.gtd/TODO.md`

- [ ] The three `## Deferred review notes` sections (836985b, daed27f, eda53bb)
      match their current text byte for byte — no edit, reorder or delete

## Tests

- unit: `claude/hooks/ship.test.ts`
