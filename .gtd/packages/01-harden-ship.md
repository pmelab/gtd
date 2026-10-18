# 01 — Harden `/gtd ship`: shell guard, merged-first resume, one-slice re-ship, `viewPr`

Merged concern A (concerns 1, 2, 3, 4) of `.gtd/ARCHITECTURE.md`. All centre on
`claude/hooks/ship.ts` and `claude/hooks/ship.test.ts`; `ship`'s exported
signature and `READ_ONLY_GIT`'s type stay unchanged. No e2e change: the mod's
only test tier is the scripted-`ShipIo` vitest suite.

## Requirements

### 1. `READ_ONLY_GIT` rejects quoted or escaped write flags

- **Any word that, with `"`, `'` and `\` removed, starts `-o` or `--ou`
  refuses** in `log|show|diff|status|rev-parse|rev-list|merge-base`
- Lookahead, with Q = `["'\\]*`:
  `(?![^;&|<>\`$()\n]*\sQ-Q(?:o|-Q(?:o)Q(?:u)))`— any run of Q may precede each character of`-o`/`--ou`
- **Quotes elsewhere stay accepted** (`git log --format='%h %s'`)
- Every currently accepted command stays accepted; every refused one stays
  refused
- **Accepted risk: `--grep='a -o'` now refuses**, as unquoted `--grep=a -o`
  already does — a false refusal costs one retry, a false accept writes a file

### 2. One-slice stack-mode ship on a recorded stack resumes it

- **Stack mode + one landed slice + live `gtdStack` record resumes the stack**:
  squash commit lands on the top branch, lower branches and PRs stay, top PR
  keeps its slice base and is refreshed, record **not** forgotten
- **`gtdStackTop` is never moved after `recordStack`**: no
  `git config … gtdStackTop` write on a re-ship
- **Top guard = recorded top is an ancestor of HEAD**
  (`merge-base --is-ancestor <top> HEAD`), not equal to it; absent top or failed
  check refuses with "HEAD no longer contains the recorded top"
- **Every missing-branch and floor fallback reads
  `<top>~(recorded.length - 1 - i)`**, never `HEAD~n` — stays right after any
  number of re-ships
- Resume checks run against `at = groups[0].base` (process base) **before
  `pushHistory`**, so a refusal changes nothing; branch revives run after the
  squash
- Record that no longer chains → today's single-commit path: retire, ship one PR
  to the default branch, forget after the PR step
- **`GTD_SHIP_MODE=commits` never enters this path**: one commit, unstack,
  forget
- Dry run previews every remaining slice, commit message only under the top,
  writes nothing
- `docs/driver.md` stacked-ship paragraph updated; README line ~340 states no
  one-slice case and stays unchanged

### 3. Resume reads PR states first and drops merged slices

- **Fixed order in `resumable`**: read `gtdStack` (empty → `{}`) → `viewPr`
  every recorded branch (unreadable → refusal "… Nothing changed.") → drop
  leading MERGED slices (never the top) → any remaining non-OPEN → closed-slice
  refusal naming `GTD_SHIP_MODE=commits` → top guard, chain check,
  missing-branch list over the **remaining** uppers only → chain broken →
  `{ forget: true }` (log "dropped it" unless dry) → not dry → `branch -f` each
  missing remaining branch
- **Never recreate a merged slice's branch**
- Fallback offsets keep each slice's **original** index — merged slices still
  sit in history
- **No remaining uppers = valid one-link stack**; top targets the default
  branch, not a "no longer chains" drop
- **`floor` = commit of the highest merged slice, resolved by `<top>~n` at its
  original index, never its local ref** — resolves after the merged branch is
  deleted
- `resumable` replaces `resumable` + `resolveStack` + `settle`; `squash()`'s
  result gains `floor`, loses `resumed`; `ship()` passes `squashed.stack` +
  `squashed.floor` straight to `stackPreview` / `stackPullRequests`

### 4. `pullRequest` and `preview` read PRs through `viewPr`

- **No raw `JSON.parse` of a `gh pr view` reply outside `viewPr`** in `ship.ts`
- `viewPr` unchanged: non-zero exit = no PR; zero exit with unparseable (incl.
  empty) stdout = string
- `preview`: string → `fail(\`${view} Nothing changed.\`)` — nothing pushed
- `pullRequest`: string → `fail(\`${view} ${branch} is pushed; nothing else
  changed.\`)` — **no undo of the push**; a rerun refreshes
- Pass the current branch to `viewPr` explicitly

## Tasks

### Task 1: Quote- and backslash-transparent write-flag guard

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] `bad` list gains and refuses `git log "--output=x"`,
      `git log '--output' x`, `git log \--output=x`, `git show "-ox"`,
      `git log -"-"output=x`, `git diff ''--output=x`
- [ ] `ok` list gains and accepts `git log --format='%h %s'`,
      `git log --format="%H%n%B" a..b`
- [ ] Every existing `ok` and `bad` entry keeps its verdict

### Task 2: Route `pullRequest` and `preview` through `viewPr`

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] Real run, single PR path, `gh pr view feat/x --json …` returns `not json`:
      `ok: false`, text names the branch, no throw, no `gh pr create|edit` after
      the push
- [ ] Dry run, same reply: `ok: false`, text names the branch, no throw, no
      `git push`
- [ ] Scripted keys `gh pr view --json url` and branchless
      `gh pr view --json number,…` re-keyed to
      `gh pr view <branch> --json number,title,body,url,state,baseRefName`;
      tests that left the call unscripted get it scripted
- [ ] Grep of `ship.ts` finds no `JSON.parse` on a `gh pr view` reply outside
      `viewPr`

### Task 3: Merged-first `resumable`, ancestor top guard, `<top>~n` fallbacks

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] `resolveStack` and `settle` removed;
      `resumable(io, git, ok, branch,     isDry, at)` returns
      `{ links?, floor?, forget? } | string` in the fixed order above;
      `squash()` returns `floor`, no `resumed`
- [ ] `gh pr view` states read before any `git rev-parse refs/heads/<slice>` or
      `merge-base --is-ancestor` call (call order asserted)
- [ ] Bottom slice MERGED, branch missing locally, HEAD not the recorded top: no
      refusal, no `git branch -f` for it, lowest remaining targets the default
      branch, writer range starts at the merged slice's commit
- [ ] Every lower slice MERGED: top PR retargets to the default branch, stack
      not dropped as "no longer chains"
- [ ] Closed (not merged) lower slice refuses naming commits mode, nothing
      pushed
- [ ] Recorded top not an ancestor of HEAD (ancestor check scripted to fail)
      refuses, nothing changed; ancestor but not equal to HEAD rebuilds instead
      of refusing
- [ ] Chain fallback for a missing branch at recorded index i is
      `<top>~(recorded.length - 1 - i)`; last link's ancestor check runs against
      `at`

### Task 4: One-slice stack-mode re-ship resumes the stack

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

- [ ] Stack mode, one landed slice, live record chaining to the process base:
      squash commit on the top branch, no
      `git branch -f`/`gh pr edit --base     main` for any slice, top PR
      refreshed with its slice base, no `--unset` of gtdStack, no
      `git config … gtdStackTop` write
- [ ] Same, then a second no-process run with a lower branch deleted: rebuilt at
      `<recorded top>~n` (lower slice's commit), not `HEAD~n`
- [ ] Two one-slice re-ships in a row, then a lower branch deleted: still
      rebuilt at the lower slice's commit
- [ ] Record that no longer chains: retires, one PR to the default branch,
      forgets after the PR step
- [ ] `GTD_SHIP_MODE=commits`, one landed slice, live record: one commit,
      retarget to default, record forgotten; existing "defers the unset" and
      "retry after a failed single-squash" tests move to commits mode
- [ ] Dry run, stack mode, one landed slice, live record: lists every remaining
      slice, commit message only under the top, writes nothing
- [ ] Closed lower PR on a one-slice re-ship refuses before the history push,
      naming `GTD_SHIP_MODE=commits`

### Task 5: Update `docs/driver.md` stacked-ship paragraph

Paths: `docs/driver.md`, `README.md`

- [ ] "A single slice ships as one commit and one pull request in either mode"
      becomes: a single slice on a branch without a recorded stack ships as one
      commit and one PR; in `stack` mode a single slice on a stacked branch
      lands on the top branch and keeps the stack; `GTD_SHIP_MODE=commits` ships
      it alone
- [ ] Rebuild sentence becomes: a missing slice branch is rebuilt from the
      commits the stack was built at while the branch still contains them,
      otherwise the ship refuses and names `GTD_SHIP_MODE=commits`
- [ ] Prose names no `src/*.ts` module, internal function or private type; "A
      complete minimal driver" heading and its single fence untouched
- [ ] README line ~340 read; left unchanged (states no one-slice case)

### Task 6: Gate

- [ ] `npm test` green; `lint:boundaries`, typecheck and `format:check` clean

## Tests

- unit: `claude/hooks/ship.test.ts`
