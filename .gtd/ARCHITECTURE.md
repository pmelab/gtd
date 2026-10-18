# Architecture: fix PR #391 review findings on stacked ship

**Two packages.** Package A (concerns 1-4, merged) changes
`claude/hooks/ship.ts` and its tests; package B (concern 5) rewrites the
`/gtd ship` bullet in `docs/driver.md` to describe what package A ships.

Package A, per concern:

- **Concern 1 + 3: the stack record is read once, up front, and forgotten only
  after the single-branch pull-request step succeeds.** `ship()` reads
  `branch.<branch>.gtdStack` before squashing and hands the names to the
  single-branch PR step. The three early unsets (single-slice squash,
  commits-mode squash, "no longer chains" drop) become a `forget` flag on the
  squash result; no-process commits mode sets the same flag. `ship()` runs the
  unset after that PR step returns ok, never on a dry run. A failed retarget
  therefore keeps the record, and the retry retargets.
- **The single-branch PR step retargets only a base in `<branch>-<name>` for a
  recorded `<name>`.** Any other non-default base is left alone: no
  `gh pr edit --base`, no stack-line strip, and the refresh proceeds as for any
  open PR. The `Stacked on #N` line is stripped only together with that
  retarget.
- **Concern 2: in stack mode, the retarget runs before the thrown/not-thrown
  split.** An open PR whose base differs from the slice's target is retargeted
  first; a failure stops the slice at step `retarget` with nothing rewritten and
  the THROWN marker intact. Then a thrown draft is rewritten and marked ready,
  any other PR refreshed.
- **Concern 4: a new key, `branch.<branch>.gtdStackTop`, holds the commit HEAD
  was at when the stack was built.** Written beside the names (a failed write
  undoes the squash, like a failed names write), unset with them. On resume, a
  missing slice branch is rebuilt only when `rev-parse HEAD` equals the recorded
  top; otherwise — including a record with no top — ship refuses with nothing
  changed, naming the missing branch and
  `git config --local --unset branch.<branch>.gtdStack`. The missing check runs
  before the chain check. With every branch present, today's chain check alone
  decides.
- **Risk: a stack-mode retry after a failed single-slice PR step resumes the old
  stack when its slice branches still chain to HEAD.** The record is kept for
  the retarget retry, so the resume path sees it. Accepted: a still-chaining
  stack is exactly what a resume is for, and only a failed PR step reaches it.

## Interfaces

`ship` — exported signature unchanged; its behaviour changes as above.

```ts
// claude/hooks/ship.ts
export async function ship(
  io: ShipIo,
  isDry: boolean,
  rawMode?: string,
): Promise<Shipped>
```

Stack record — local git config, written and read only by ship. One new key.

```ts
// branch.<branch>.gtdStack     "<slice> … <top slice>"  unchanged
// branch.<branch>.gtdStackTop  "<full sha>"              NEW: HEAD when the stack was built
const STACK_KEY = (branch: string) => `branch.${branch}.gtdStack`
const STACK_TOP_KEY = (branch: string) => `branch.${branch}.gtdStackTop`

// Both keys go together: set by the stack build, unset by every forget.
// A record carrying names but no top is pre-change: it never authorises a rebuild.
```

## Call Stacks

Single-branch ship (one slice, commits mode, or no process):

- `ship` → `git config --local --get branch.<b>.gtdStack` (names, read before
  any squash)
- `ship` → `squash` → `plan` / `squashOne` / `commitChain` → result
  `{ forget: true }` (no unset here)
- `ship` → `pullRequest(…, names)` → `gh pr view` → base in `<b>-<name>`? →
  `gh pr edit --base <default>` → strip stack line → `updatePr` / `createPr`
- `ship` → PR step ok, not dry → `forgetStack` → `git config --local --unset`
  both keys

Stack resume (no process, stack mode, record present):

- `ship` → `squash` → `plan` → `resumable` → `chain` (finds missing branches)
- `resumable` → missing and `rev-parse HEAD` ≠ `gtdStackTop` → refusal, nothing
  changed
- `resumable` → missing and HEAD = top, not dry →
  `git branch -f <b>-<slice> HEAD~n`
- `resumable` → chain invalid → `{ forget: true }`, ship alone (unset deferred
  to `ship`)

Fresh stack build:

- `ship` → `squash` → `commitChain` → `recordStack` → `git config` top key, then
  names key → `git branch -f` per lower slice

Stack PR step:

- `ship` → `stackPullRequests` → `sliceStep` → `gh pr view` → base ≠ target →
  `gh pr edit --base` → THROWN? `createPr(…, view)` : `updatePr`

## E2E Scenarios

No e2e change. Ship runs only inside the Claude Code mod; no e2e harness drives
it, and `claude/hooks/ship.test.ts` pins it through a scripted `ShipIo`.

## Unit Tests

### ship

- unit: claude/hooks/ship.test.ts — a single-branch PR whose base is a recorded
  slice branch is retargeted to the default branch and loses its stack line (the
  "stacked PR shipped as a single branch" fixture gains the record) (covers 1)
- unit: claude/hooks/ship.test.ts — a PR on an unrecorded non-default base
  (`release/1`, and a slice-looking base absent from the record) keeps base and
  body: no `gh pr edit --base`, no `--body-file` edit of its stack line
  (covers 1)
- unit: claude/hooks/ship.test.ts — a single-slice ship with a record retargets
  the PR off the recorded slice branch, and the unset runs after the retarget
  (covers 1)
- unit: claude/hooks/ship.test.ts — a recorded stack that no longer chains
  retargets the PR off its slice branch and unsets the record only after the PR
  step (covers 1)
- unit: claude/hooks/ship.test.ts — a failed retarget keeps the record (no
  `--unset`), and a second run with the same record retargets (covers 1)
- unit: claude/hooks/ship.test.ts — "taking a PR off a stack with nothing new"
  and "a failed retarget of a once-stacked PR" keep passing with the record
  scripted (covers 1)
- unit: claude/hooks/ship.test.ts — stack mode: a thrown draft on the wrong base
  gets `gh pr edit <n> --base <lower>` before `gh pr ready <n>` and its rewrite
  (covers 2)
- unit: claude/hooks/ship.test.ts — stack mode: a thrown draft whose retarget
  fails stops at step `retarget`; no `gh pr ready`, no title/body edit
  (covers 2)
- unit: claude/hooks/ship.test.ts — "a thrown draft on the upper slice is
  rewritten with the stack line and marked ready" keeps passing (covers 2)
- unit: claude/hooks/ship.test.ts — no-process commits ship unsets both record
  keys after its PR step (covers 3)
- unit: claude/hooks/ship.test.ts — no-process commits dry run unsets nothing
  (covers 3)
- unit: claude/hooks/ship.test.ts — no-process stack ship with no record ships
  the branch alone: one PR into main, no `git branch -f` (covers 3)
- unit: claude/hooks/ship.test.ts — resume with a missing slice branch and
  `gtdStackTop` = HEAD rebuilds it and resumes (the "failed git branch -f"
  second run gains the top) (covers 4)
- unit: claude/hooks/ship.test.ts — resume with a missing slice branch and HEAD
  moved refuses naming the branch and
  `git config --local --unset branch.feat/x.gtdStack`; no `git branch -f`, no
  push, no `gh pr` write, no unset (covers 4)
- unit: claude/hooks/ship.test.ts — resume with a missing slice branch and no
  top recorded refuses the same way (covers 4)
- unit: claude/hooks/ship.test.ts — dry run with a missing branch at the
  recorded top never runs `git branch -f` (covers 4)
- unit: claude/hooks/ship.test.ts — resume with every slice branch present and
  HEAD moved keeps today's chain check: chaining resumes, non-chaining ships
  alone (covers 4)

### Stack record

- unit: claude/hooks/ship.test.ts — a fresh stack build writes
  `branch.feat/x.gtdStackTop <top commit>` and the names key (covers 4)
- unit: claude/hooks/ship.test.ts — a failed top-key write undoes the squash
  (`git reset --soft ORIG_HEAD`), no branch, push or `gh` call (covers 4)
- unit: claude/hooks/ship.test.ts — every forget (single-slice, commits mode,
  chain dropped) unsets both keys (covers 1, 3, 4)

### Chores

- chore: docs/driver.md — the merged/closed refusal sentence offers
  `GTD_SHIP_MODE=commits` only for a lower slice's PR; a merged or closed top PR
  needs a renamed branch (covers 5)
- chore: docs/driver.md — squash-merge caveat: squash-merging a lower stacked PR
  rewrites its commit, so the PR above shows the lower slice's changes again
  until rebased or resumed; a rebase merge (or a merge commit) keeps the stack
  clean (covers 5)
- chore: docs/driver.md — stale lower PR caveat: a commits-mode re-ship of a
  stacked branch retargets its PR to the default branch and leaves the lower
  slice PRs open; close them by hand (covers 5)
- chore: docs/driver.md — one short clause each: a PR on a base that is not a
  slice branch keeps its base; a thrown draft in a stack is retargeted; a
  missing slice branch is rebuilt only at the commit the stack was built at,
  else the ship refuses and names the unset (covers 5)
- chore: README.md — check line ~340 against the fix; no edit unless a sentence
  contradicts it (covers 5)

## Merged Concerns

Concerns 1, 2, 3 and 4 merged into package A: all four center on
`claude/hooks/ship.ts` and `claude/hooks/ship.test.ts`, and 1 and 3 share the
record read and the deferred unset. Concern 5 stays package B: it centers on
`docs/driver.md` and only describes what A builds.

#### 1. Single-branch ship retargets only a PR based on a recorded slice branch — TECHNICAL

Today a single-branch ship (one slice, commits mode, or no process) moves
**any** open PR whose base is not the default branch onto the default branch.
That silently undoes a base the human picked on purpose (a release branch, a
hand-made stack).

- **Retarget only when the PR's base is `<branch>-<name>` for a `<name>` in
  `branch.<branch>.gtdStack`.** Any other base stays untouched, with no retarget
  and no `gh pr edit --base` call
- The `Stacked on #N — merge that first` line is stripped only together with
  that retarget
- **Risk: the record is unset before the PR step runs today** — the single-slice
  squash, the commits-mode squash, and the "no longer chains" drop in a stack
  resume all unset `gtdStack` first. Read the recorded names before any unset
  and hand them to the PR step, or the fix retargets nothing
- **Risk: a retarget that fails after the unset leaves no record**, so a retry
  never retargets. Unset the record only after the retarget succeeds, or keep
  the names otherwise recoverable for the retry
- Tests: a PR on a recorded slice branch is retargeted and loses its stack line
  (existing "a stacked PR shipped as a single branch" case keeps passing); a PR
  on an unrecorded non-default base is left alone, base and body; the
  single-slice and chain-dropped paths still retarget

#### 2. Stack mode retargets a thrown draft too — TECHNICAL

In stack mode a slice's PR that is a thrown draft (`<!-- gtd:thrown -->`) goes
straight to the rewrite and keeps its old base. Only the non-thrown branch runs
`gh pr edit --base`.

- **A thrown draft whose base differs from the slice's target base is retargeted
  before it is rewritten and marked ready**
- A failed retarget stops that slice at step `retarget` with nothing rewritten,
  same as the non-thrown path; the THROWN marker stays, so a retry comes back
- Tests: thrown draft on the wrong base is retargeted then rewritten; failed
  retarget leaves the draft untouched; the existing "thrown draft on the upper
  slice" case keeps passing

#### 3. A commits-mode ship with no process unsets `gtdStack` — TECHNICAL

With no gtd process at HEAD, commits mode returns early and leaves an old stack
record behind. A later stack-mode ship then resumes a stack the human already
shipped away from.

- **No-process commits ship unsets `branch.<branch>.gtdStack` (not on a dry
  run)**, matching what commits mode already does with a process
- It reads the record first, so concern 1 can still retarget the PR off a
  recorded slice branch
- Tests: no-process commits ship removes the record; its dry run keeps it; a
  following stack-mode ship ships the branch alone

#### 4. A resume rebuilds a missing slice branch only when HEAD is the recorded top — TECHNICAL

A resume that finds a recorded `<branch>-<slice>` branch missing rebuilds it
from `HEAD~n`. **If HEAD moved since the stack was built (new commits, an amend,
a rebase), `HEAD~n` is the wrong commit**, and ship force-moves a slice branch
onto it and pushes.

- **Record the top commit the stack was built at** alongside the slice names
  (local git config, set and unset with the names)
- On resume with any slice branch missing: **rebuild only when HEAD equals the
  recorded top; otherwise refuse with nothing changed**, naming the missing
  branch and the way out (`git config --local --unset branch.<branch>.gtdStack`
  to ship the branch alone)
- A resume with every slice branch present keeps today's chain check
- A record written before this change carries no top: treat it as "HEAD is not
  the recorded top" when a branch is missing
- Tests: missing branch at the recorded top is rebuilt and the ship resumes;
  missing branch after HEAD moved refuses and changes nothing (no branch -f, no
  push, record kept); dry run never rebuilds

## Answered Questions

### Where does the stack's top commit live?

A second local key, `branch.<branch>.gtdStackTop`. Folding it into the names
value is ambiguous: a hex sha can match the slice-name pattern.

### When does a single-branch ship forget the stack record?

After its pull-request step returns ok, never on a dry run. That keeps the names
for a retry when the retarget fails, which the requirements flag as a risk.

### Which check runs first on resume: a missing slice branch or a broken chain?

The missing branch. A missing branch with HEAD off the recorded top refuses even
when the chain would also be broken, matching the settled "refuse, never drop"
answer.

### Does a dry run refuse on a missing branch with HEAD moved?

Yes, with the same text. The check only reads, so the preview tells the truth
about the real run.

### Does the way-out command in the refusal also unset `gtdStackTop`?

No. It names only `gtdStack`; a leftover top is never read without names, and
the next stack build overwrites it.

### Does the single-branch PR step strip a stack line when it does not retarget?

No. The requirements tie the strip to the retarget; a PR on a base the human
chose keeps its body.

### Does concern 5 merge into package A?

No. Its footprint is `docs/driver.md`, not `ship.ts`, and it only describes what
A builds.

### Does any of this need an e2e scenario?

No. Ship runs only inside the Claude Code mod; no e2e harness drives it, and the
requirements pin every test in `claude/hooks/ship.test.ts`.
