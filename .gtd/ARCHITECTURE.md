# Architecture: PR 391 review 3 fixes

**Concerns 1, 2 and 3 merge into one package** — all three live in
`claude/hooks/ship.ts` with tests in `claude/hooks/ship.test.ts` (see
`## Merged Concerns`). **Concern 4 builds nothing**: `.gtd/TODO.md`'s three
deferred-note sections stay byte for byte.

**Ship is tested only through `ship()` with the scripted `ShipIo`** (the
in-memory port: every argv answers from a script, every call is recorded). Every
unit test below drives `ship()`, never a private helper.

### Concern 1 — a failing `gh pr view` refuses

- **`viewPr` returns `undefined` only when `gh pr view` exits non-zero AND its
  stderr contains `no pull requests found`.** Case-sensitive substring, gh's own
  wording. Any other non-zero exit returns the refusal string
  `gh pr view <branch> failed: <stderr, trimmed>`. Unreadable JSON keeps its
  current refusal.
- **Pre-squash callers already refuse before any write**: `stackPrecheck` (fresh
  stack) and `mergedSlices` (resume, one-slice re-ship) run inside
  `stackReads`/`plan`, before the history push. No change beyond the new string
  reaching them.
- **`pullRequest` reads the PR before `pushBranch`, not after.** Today it pushes
  first, so a gh failure leaves the branch pushed. The `mergeBase` checks stay
  first (reads); the refusal reads `<viewPr refusal> Nothing was pushed.`
- **`stackPullRequests` reads each slice's PR before `pushLink`, then hands the
  view to `sliceStep`.** A failure stops at step `pull request` with that slice
  unpushed; lower slices already landed stay and are listed. `sliceStep` no
  longer calls `viewPr` itself.
- **Risk: `pullRequest` and the slice loop run after the squash.** The squash
  (and `retireStack`'s config move) stays; `/gtd ship` resumes.
- **Dry runs**: `preview` already refuses on a string. **`stackPreview` today
  drops a string view into "would open" — a bug.** It returns the refusal
  instead (`<viewPr refusal> Nothing changed.`), and `ship()` fails with it.
- **`claude/hooks/ship.test.ts` fixtures change**: every scripted "no PR" reply
  (`{ code: 1 }` on `gh pr view …` in `feature` and the `ship stack` `sbase`)
  gains `err: 'no pull requests found for branch "<b>"'`; without it they now
  read as gh failures. `handoff.ts`'s own `gh pr view` call is out of scope.

### Concern 2 — fresh multi-slice stack refuses over a live record

- **`stackPrecheck` reads `branch.<branch>.gtdStack` first and refuses when it
  holds any name.** It runs only for `mode === "stack"` with more than one
  landed slice, before the history push and on dry runs too — exactly the scope
  the requirement names. `gtdStackRetired` is never read here.
- **`takenSlice` drops its "named in the record is not a collision" skip.** With
  a live record refusing first, that branch is dead. The existing test "a branch
  named in gtdStack is not a collision" asserts the now-refused ship; it is
  replaced by the refusal test.
- Refusal text, pinned:
  `<branch> already has a recorded stack (<names, comma-separated>); nothing changed. Ship with GTD_SHIP_MODE=commits, or run git config --local --unset branch.<branch>.gtdStack and git config --local --unset branch.<branch>.gtdStackTop, then ship again.`
- Unaffected paths need no code: one slice goes through `resumable`, no process
  goes through `plan`'s probe branch, commits mode skips `stackReads`.

### Concern 3 — `sinceHead` floors at `from`

- **`sinceHead` adds a third check:
  `git merge-base --is-ancestor <from> <synced>`.** All three must hold to use
  the synced head; otherwise `from`. `from` equal to the synced head passes (a
  commit is its own ancestor) and yields the same range.
- One function serves both call shapes: single PR (`from` = merge-base) and
  stacked slices (`from` = lower slice commit or the floor).

## Interfaces

```ts
// claude/hooks/ship.ts — private helpers; contracts change, export surface does not.

/**
 * undefined: gh exited non-zero with stderr containing "no pull requests found".
 * string: refusal — `gh pr view ${branch} failed: ${stderr.trim()}`, or the
 * existing unreadable-JSON refusal. Never undefined for any other failure.
 */
async function viewPr(
  io: ShipIo,
  branch: string,
): Promise<View | undefined | string>

/**
 * Fresh stack precheck. First read: the live record. Any name there refuses,
 * naming GTD_SHIP_MODE=commits and both `git config --local --unset` commands.
 * Then the taken-branch check (no record skip) and the per-slice PR states.
 */
async function stackPrecheck(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  groups: Group[],
): Promise<string | undefined>

/** Takes the view its caller read before pushing; no longer calls viewPr. */
async function sliceStep(
  io: ShipIo,
  git: Git,
  ok: Ok,
  l: Link,
  view: View | undefined,
  base: string,
  lowerRef: string,
  ctx: Ctx,
): Promise<Pr | { step: string; why: string }>

/** Refusal string when any slice's viewPr refuses; ship() fails with it. */
async function stackPreview(
  io: ShipIo,
  links: Link[],
  baseBranch: string,
  messages: string[] | undefined,
  history?: string,
): Promise<{ text: string } | { refusal: string }>

/**
 * prSyncHead only when it resolves to a commit, is an ancestor of `to`,
 * and `from` is an ancestor of it; otherwise `from`.
 */
async function sinceHead(
  git: Git,
  ok: Ok,
  branch: string,
  from: string,
  to: string,
): Promise<string>
```

## Call Stacks

- `ship()` → `squash` → `plan` → `stackReads` → `stackPrecheck` →
  `git config --get gtdStack` → refusal (concern 2)
- `ship()` → `squash` → `stackReads` → `stackPrecheck` → `viewPr` (per slice) →
  refusal before history push (concern 1)
- `ship()` → `squash` → `plan`/`stackReads` → `resumable` → `mergedSlices` →
  `viewPr` → refusal before any write (concern 1)
- `ship()` → `pullRequest` → `viewPr` → refusal → (no `pushBranch`, no
  `gh pr create/edit`) (concern 1)
- `ship()` → `stackPullRequests` → `viewPr` → `pushLink` → `sliceStep(view)` →
  `createPr`/`updatePr` (concern 1)
- `ship()` (dry) → `preview` / `stackPreview` → `viewPr` → refusal (concern 1)
- `pullRequest`/`sliceStep` → `updatePr` → `sinceHead` →
  `git config --get prSyncHead` → `rev-parse` →
  `merge-base --is-ancestor synced to` → `merge-base --is-ancestor from synced`
  (concern 3)

## E2E Scenarios

No e2e change. `/gtd ship` is the Claude Code mod's hook in `claude/`, which no
cucumber tier drives; its in-memory port is the scripted `ShipIo` in
`claude/hooks/ship.test.ts`, where every behaviour below is pinned.

## Unit Tests

### viewPr

- unit: claude/hooks/ship.test.ts — gh stderr
  `no pull requests found for branch "feat/x"` → ship opens the PR with
  `gh pr create` as today (covers 1)
- unit: claude/hooks/ship.test.ts — single branch, no gtd process, `gh pr view`
  exits 1 with stderr `HTTP 401: Bad credentials` → ship fails, text names
  `feat/x` and the stderr; no `git push`, no `gh pr create/edit`, no
  `git config` write (covers 1)
- unit: claude/hooks/ship.test.ts — single-slice process, `gh pr view` fails
  after the squash → ship fails naming the branch and stderr; the squash stays,
  no `git push`, no `gh pr create/edit` (covers 1)
- unit: claude/hooks/ship.test.ts — fresh two-slice stack, lower slice's
  `gh pr view` fails → ship fails naming `feat/x-refactor` and the stderr; no
  history push, `commit-tree`, `reset`, `git branch -f`, `git config` write,
  `git push` or gh write (covers 1)
- unit: claude/hooks/ship.test.ts — same setup as a dry run → same refusal,
  nothing written (covers 1)
- unit: claude/hooks/ship.test.ts — resume of a recorded stack (no gtd process),
  a slice's `gh pr view` fails → refusal, nothing written: no `git branch -f`,
  `--unset`, push or gh write (covers 1)
- unit: claude/hooks/ship.test.ts — stacked PR step, upper slice's `gh pr view`
  fails after the lower slice landed → fails at `pull request`, lists `refactor`
  as landed, never pushes `feat/x` (covers 1)
- unit: claude/hooks/ship.test.ts — the existing unreadable-JSON test on a real
  single-branch ship now asserts no `git push` (covers 1)

### stackPrecheck

- unit: claude/hooks/ship.test.ts — stack mode, two landed slices,
  `branch.feat/x.gtdStack` set → ship fails, text contains
  `GTD_SHIP_MODE=commits` and
  `git config --local --unset branch.feat/x.gtdStack`; no history push,
  `commit-tree`, `reset`, `git branch -f`, `git config` write, `git push` or gh
  call (covers 2)
- unit: claude/hooks/ship.test.ts — same setup as a dry run → same refusal,
  nothing written (covers 2)
- unit: claude/hooks/ship.test.ts — same setup with `GTD_SHIP_MODE=commits` →
  ships one PR as today (covers 2)
- unit: claude/hooks/ship.test.ts — only `gtdStackRetired` set → ships a fresh
  stack (existing "a fresh stack shipped over a leftover retired record keeps
  its own record" keeps passing) (covers 2)
- unit: claude/hooks/ship.test.ts — replace "a branch named in gtdStack is not a
  collision" with the refusal above; one-slice re-ship onto the stack and
  no-process resume tests pass unchanged (covers 2)

### sliceStep

- unit: claude/hooks/ship.test.ts — each slice's `gh pr view` runs before that
  slice's `git push` (call order in `ran()`) (covers 1)

### stackPreview

- unit: claude/hooks/ship.test.ts — dry-run stack whose `gh pr view` succeeds in
  the precheck then fails on the preview read (stateful `io.run`) → ship fails
  with the refusal, never prints "would open" (covers 1)

### sinceHead

- unit: claude/hooks/ship.test.ts — single PR, `prSyncHead` S with
  `git merge-base --is-ancestor <merge-base> S` exiting 1 → count and log use
  `<merge-base>..HEAD`, never `S..HEAD` (covers 3)
- unit: claude/hooks/ship.test.ts — single PR, S between merge-base and HEAD →
  count and log use `S..HEAD` (covers 3)
- unit: claude/hooks/ship.test.ts — S missing, or `is-ancestor S HEAD` exiting 1
  → `<merge-base>..HEAD` (covers 3)
- unit: claude/hooks/ship.test.ts — stacked upper slice, its `prSyncHead` below
  the lower slice commit C1 → range `C1..C2` (covers 3)

### Chores

- chore: docs/driver.md — ship paragraph, beside the merged/closed-PR refusals:
  one sentence that a fresh multi-slice stack ship on a branch with a recorded
  stack refuses and names `GTD_SHIP_MODE=commits` or unsetting
  `branch.<branch>.gtdStack` and `gtdStackTop`; one clause that a `gh pr view`
  failure other than "no pull request" refuses before that step's writes (covers
  2, 1)
- chore: .gtd/TODO.md — no package edits, reorders or deletes the three
  `## Deferred review notes` sections (836985b, daed27f, eda53bb); they match
  their current text byte for byte after the process (covers 4)

## Merged Concerns

**Concerns 1, 2 and 3 → one package on `claude/hooks/ship.ts` +
`claude/hooks/ship.test.ts`.** Same footprint; none only consumes an interface
another creates.

### 1. A failing `gh pr view` refuses instead of reading as "no PR" — PRODUCT

**Today `viewPr` treats every non-zero `gh pr view` exit as "no pull request".**
A network error, an auth failure or a rate limit therefore lets ship open a
second pull request, or skip the closed/merged-PR refusals in the stack checks.

- **Only a non-zero exit whose stderr reads `no pull requests found` means "no
  PR".** Match that phrase in stderr; nothing else counts as absence.
- **Any other `gh pr view` failure refuses before any write** — no squash, no
  history push, no branch move, no `git config` write. The refusal names the
  branch and carries gh's stderr.
- Every caller already treats a string from `viewPr` as a refusal
  (`stackPrecheck`, `mergedSlices`, `stackPreview`, `sliceStep`, `preview`,
  `pullRequest`); keep that, and check each one returns the refusal before its
  first write.
- **Risk: `sliceStep` and `pullRequest` run after the squash has landed.** There
  "before any write" means before that step's own writes (push,
  `gh pr create/edit`); the squash already made stays, and `/gtd ship` resumes.
- Dry runs refuse the same way.

Acceptance:

- gh stderr `no pull requests found for branch "x"` → ship creates the PR as
  today.
- gh exits non-zero with any other stderr → ship fails, names the branch, shows
  gh's stderr, and the repository (HEAD, branches, git config, remote) is
  unchanged when the failure hits in a pre-squash read.

### 2. A fresh multi-slice stack ship refuses over a live recorded stack — PRODUCT

**Today a multi-slice ship in `stack` mode on a branch that already has a
recorded stack overwrites the record** (`recordStack` writes new
`gtdStack`/`gtdStackTop` keys) and orphans the old slice branches and their pull
requests.

- **Refuse when `branch.<branch>.gtdStack` is set and the process has more than
  one landed slice, in `stack` mode.** "Live" means the `gtdStack` key, the same
  value `ship()` reads as `live`; a retired record (`gtdStackRetired`) alone
  does not refuse.
- **The refusal changes nothing and names both ways out:** ship with
  `GTD_SHIP_MODE=commits`, or unset the record with
  `git config --local --unset branch.<branch>.gtdStack` (and
  `branch.<branch>.gtdStackTop`), then ship again.
- Runs inside `stackPrecheck`, before the history push, so it shares the
  "refusal changes nothing" property and also fires on a dry run.
- Unaffected: a single-slice ship onto the stack (`squashOntoStack`), a resume
  with no gtd process at HEAD, and `GTD_SHIP_MODE=commits`.
- **Docs: `docs/driver.md`'s ship paragraph gets one sentence for this
  refusal**, next to the existing merged/closed-PR refusals.

Acceptance:

- stack mode, two landed slices, `gtdStack` set → ship fails with a message
  naming `GTD_SHIP_MODE=commits` and the `git config --unset` command; HEAD,
  branches, config and remote unchanged.
- same setup with `GTD_SHIP_MODE=commits` → ships as today.
- same setup with only `gtdStackRetired` set → ships a fresh stack as today.

### 3. `sinceHead` uses the synced head only when it sits above `from` — TECHNICAL

**Today `sinceHead` trusts `prSyncHead` whenever it exists and is an ancestor of
`to`.** A synced head below `from` (a stacked slice whose floor moved up, a
lower slice that merged) widens the "commits since the last ship" range past the
PR's own base, so the description update weighs commits that are not this PR's.

- **Use `prSyncHead` only if it resolves to a commit, is an ancestor of `to`,
  AND `from` is an ancestor of it.** Otherwise fall back to `from` (the
  `mergeBase`/floor passed in), as today's fallback does.
- Covers both `updatePr` call shapes: single PR and per-slice stacked PRs.

Acceptance:

- synced head below `from` → range is `from..to`.
- synced head between `from` and `to` → range is `synced..to` (unchanged).
- synced head missing or not an ancestor of `to` → `from..to` (unchanged).

## Answered Questions

### Does "live recorded stack" include a stale record whose top HEAD no longer contains?

Yes. The sketch says "live recorded stack" and `ship()` already names the
unretired `gtdStack` record `live`; refusing on any such record is the safe
reading, and the refusal itself names the one-line unset that clears a stale
one.

### Does the new stack refusal also fire on a dry run?

Yes. Every other stack precheck refuses on a dry run too, so a dry run keeps
predicting the real ship.

### Should an unexpected `gh pr view` failure retry before refusing?

No. The sketch asks for a refusal; ship's other gh failures refuse and leave
`/gtd ship` to retry, and a silent retry hides auth problems.

### Are the three deleted deferred review notes still to be built?

No, and they are not dropped either: the deletion was scratch, so the notes stay
parked in `.gtd/TODO.md` verbatim.

### Should `pullRequest` and the slice loop read the PR before pushing?

Yes. The requirement puts the refusal before the step's own push; a `gh pr view`
needs no pushed branch, so moving the read ahead of the push costs nothing.

### How is "no pull requests found" matched?

Case-sensitive substring of stderr, gh's own wording; anything else is a
failure, which is the safe direction.

### Does the live-record check run before the taken-branch and PR-state checks?

Yes. It is one config read, needs no network, and makes `takenSlice`'s
record-name skip dead code, so that skip goes.

### Does the `gh pr view` refusal also get a line in `docs/driver.md`?

Yes, one clause beside the new stack-refusal sentence: the ship paragraph
already lists every refusal, and a user hitting this one should find it there.
