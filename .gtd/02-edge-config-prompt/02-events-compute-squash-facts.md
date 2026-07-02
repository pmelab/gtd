# Events: compute `squashBase` / `squashDiff` / `squashEnabled` in `gatherEvents`

Populate the squash payload fields at the Effect edge. `squashEnabled` is read
from `ConfigService.squash`. `squashBase` reuses the existing cycle detection
(the Rule-1 review base: parent of the first persisting cycle commit,
`gtd: grilling`) and is set **only** when HEAD is `gtd: done` and squash is
enabled. `squashDiff` is `git diff <squashBase> HEAD` with NO workflow-file
exclusion (the squash commit represents the whole feature; TODO.md/REVIEW.md are
already removed by `gtd: done` so they don't appear anyway).

## Files

- `src/Events.ts` (edit)
- `src/Events.test.ts` (edit — add squash-facts coverage)

Depends on: Package 01 (the `ResolvePayload.squashBase/squashDiff/squashEnabled`
fields must exist) and Package 02 task 01 (`ConfigService.squash`). Do NOT touch
`src/Config.ts`, `src/Machine.ts`, or `src/Prompt.ts`.

## Key facts from the codebase (do not re-derive)

- `gatherEvents` already reads `const config = yield* ConfigService` and already
  passes `agenticReviewEnabled: config.agenticReview` etc. onto the payload. Add
  `squashEnabled: config.squash` the same way.

- **CRITICAL — the squash cycle is NOT `currentCycle`.** The existing
  review-base code defines `currentCycle = allHistory.slice(lastDoneIdx + 1)` —
  the commits _after_ the last `gtd: done`. But the squash fires **when HEAD IS
  `gtd: done`**, and in that case `lastDoneIdx` points at HEAD (the last
  element), so `currentCycle` is **empty** and its `firstGrilling` is
  **`undefined`**. Gating the squash on "`firstGrilling` exists in
  `currentCycle`" would therefore make squashing NEVER fire. Do NOT reuse
  `currentCycle`/`firstGrilling` for the squash base — they describe the _next_
  (post-done) cycle, not the cycle this `gtd: done` closes.

- The squash must find the first `gtd: grilling` of the cycle **that ends at the
  HEAD `gtd: done`** — i.e. the commits from _after the previous_ `gtd: done`
  (exclusive) up to and including HEAD. Compute a dedicated `squashCycle` for
  this:

  ```ts
  // HEAD is gtd: done → lastDoneIdx === allHistory.length - 1.
  // Find the PREVIOUS gtd: done before it (or -1 → start of history).
  let prevDoneIdx = -1
  for (let i = 0; i < lastDoneIdx; i++) {
    const subject = (allHistory[i]!.message.split("\n")[0] ?? "").trim()
    if (subject === DONE_SUBJECT) prevDoneIdx = i
  }
  const squashCycle = allHistory.slice(prevDoneIdx + 1, lastDoneIdx + 1)
  const squashGrilling = squashCycle.find(
    (c) => (c.message.split("\n")[0] ?? "").trim() === GRILLING_SUBJECT,
  )
  ```

- The **squash base is the PARENT of `squashGrilling`** so that `gtd: grilling`
  and every later `gtd: *` commit (through this `gtd: done` at HEAD) are all
  inside `<squashBase>..HEAD` and collapse into one. Compute it as the parent of
  `squashGrilling.hash`; when that commit is the repo root (no parent), fall
  back to `EMPTY_TREE`. Resolve the parent via
  `git.resolveRef("<squashGrillingHash>~1")` with an `EMPTY_TREE` catch-all
  fallback, matching the `captureAndRevert` pattern
  (`git.resolveRef("HEAD~1").pipe(Effect.catchAll(() => Effect.succeed(EMPTY_TREE)))`).

  (Contrast with the Rule-1 _review base_, which IS `firstGrilling.hash` itself
  — the review covers changes _after_ grilling. The squash base is one
  generation older so `gtd: grilling` is folded in too.)

## What to change in `src/Events.ts`

1. Add `squashEnabled: config.squash` to the `payload` object literal (next to
   `agenticReviewEnabled`).

2. Gate + compute `squashBase` / `squashDiff` — only when
   `lastCommitSubject === DONE_SUBJECT` AND `config.squash` is true. Do this
   inside the existing `if (hasCommits) { … }` block, AFTER the review-base
   computation, reusing `allHistory` and `lastDoneIdx` (both already in scope):
   - Compute `squashCycle` + `squashGrilling` as shown above (the cycle ENDING
     at the HEAD `gtd: done`, NOT `currentCycle`).
   - Only proceed when `squashGrilling !== undefined` (a well-formed process has
     a grilling commit; if somehow absent, leave the squash fields unset).
   - Resolve `squashBase` = parent of `squashGrilling.hash`, `EMPTY_TREE` when
     it is the root.
   - `squashDiff = git.diffRef(squashBase)` (NO exclude argument — pass no
     workflow-file excludes), with an `Effect.catchAll(() => "")` guard like the
     review-base diff.
   - Set both only when the gate holds AND the diff is non-empty; otherwise
     leave them `undefined`. (An empty diff can't be squashed meaningfully;
     keeping the "non-empty" guard mirrors the review-base handling and avoids
     emitting a squashing prompt with an empty diff.)

3. Spread `squashBase` / `squashDiff` onto the payload with the same
   `...(x !== undefined ? { x } : {})` pattern used for `reviewBase` /
   `refDiff`.

Constraints:

- Do NOT add an interleaved-commit guard / range-walk / all-gtd check (Resolved
  Q3): squash the entire `<squashBase>..HEAD` range unconditionally.
- Do NOT exclude workflow files from `squashDiff`.
- Keep the edge thin — no LLM calls, no commit here (the agent runs the squash).

## What to change in `src/Events.test.ts`

`Events.test.ts` drives real temp git repos. Add scenarios (mirroring the
existing review-base tests) asserting the RESOLVE payload's squash fields:

- HEAD `gtd: done` after a `gtd: grilling … gtd: done` cycle, `squash` enabled →
  `squashEnabled: true`, `squashBase` = parent of the cycle's first
  `gtd: grilling`, `squashDiff` non-empty (contains the feature's code).
- HEAD `gtd: done` with an **interleaved** non-gtd commit (e.g.
  `feat: coworker`) between two `gtd: *` commits → `squashBase` still = parent
  of the cycle's first `gtd: grilling` (the coworker commit is INSIDE the
  range), and `squashDiff` includes the coworker file.
- **Second process on the same branch:** a prior full
  `gtd: grilling … gtd: done` cycle, THEN a second `gtd: grilling … gtd: done`
  cycle at HEAD → `squashBase` = parent of the SECOND cycle's `gtd: grilling`
  (i.e. the commit right after the first `gtd: done`), NOT the first cycle's
  grilling. This pins the previous-`gtd: done` boundary (`prevDoneIdx`) — the
  exact case the empty- `currentCycle` bug would get wrong.
- `squash: false` in config → `squashEnabled: false`, `squashBase` /
  `squashDiff` unset.
- HEAD is NOT `gtd: done` (e.g. `gtd: building`) → `squashBase` / `squashDiff`
  unset even with squash enabled.
- Already-squashed: HEAD is a plain `feat:` boundary (no `gtd: done` at HEAD) →
  `squashBase` unset.

Check how `Events.test.ts` reads config in tests: `fakeConfig` (a
`ConfigOperations` helper) + `runGather(cfg)`. `fakeConfig`'s defaults gain
`squash: true` (Package 02 task 01 makes `squash` a REQUIRED field on
`ConfigOperations`, so this literal fails to compile without it — add it here in
this task). Override per scenario via `runGather({ squash: false })`.

## Acceptance criteria

- [ ] `gatherEvents` sets `squashEnabled` from `config.squash`.
- [ ] `squashBase` = parent hash of the first `gtd: grilling` of the cycle
      **ending at the HEAD `gtd: done`** (bounded below by the previous
      `gtd: done`; EMPTY_TREE when the grilling is the repo root), set ONLY when
      HEAD is `gtd: done` AND squash enabled AND that grilling exists AND the
      resulting diff is non-empty.
- [ ] `squashDiff` = `git diff <squashBase> HEAD` with NO workflow-file
      exclusion, set under the same gate.
- [ ] No interleaved-commit guard / range-walk added (the range is spanned
      unconditionally; only the cycle _lower bound_ is computed).
- [ ] `fakeConfig` in `Events.test.ts` includes `squash: true` in its defaults.
- [ ] `Events.test.ts` covers: happy done-cycle, interleaved commit, second
      process on the branch (prev-done boundary), squash disabled, non-done
      HEAD, already-squashed.
- [ ] `npx vitest run src/Events.test.ts` passes.
