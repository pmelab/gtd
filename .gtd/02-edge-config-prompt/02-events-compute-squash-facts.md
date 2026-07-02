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
- The Rule-1 review base is already computed: `firstGrilling` is
  `currentCycle.find(c => subject === GRILLING_SUBJECT)`, and `firstGrilling.hash`
  (or `EMPTY_TREE` when it is the root) is the first persisting cycle commit's
  hash. The **squash base is the PARENT of that commit** — one generation older
  than the review base, since the review base IS `firstGrilling` itself while the
  squash must fold in `gtd: grilling` too.

  IMPORTANT distinction: the Rule-1 *review base* is `firstGrilling.hash` (the
  grilling commit is the base, changes *after* it are reviewed). The *squash
  base* must be `firstGrilling`'s **parent** so that `gtd: grilling` and every
  later `gtd: *` commit (through `gtd: done`) are all inside `<squashBase>..HEAD`
  and collapse into one. Compute it as the parent of the first persisting cycle
  commit; when that commit is the repo root, fall back to `EMPTY_TREE` (mirror the
  existing `?? EMPTY_TREE` handling). Prefer resolving the parent via
  `git.resolveRef("<firstGrillingHash>~1")` with an `EMPTY_TREE` catch-all
  fallback, matching the `captureAndRevert` pattern
  (`git.resolveRef("HEAD~1").pipe(Effect.catchAll(() => Effect.succeed(EMPTY_TREE)))`).

## What to change in `src/Events.ts`

1. Add `squashEnabled: config.squash` to the `payload` object literal (next to
   `agenticReviewEnabled`).

2. Gate + compute `squashBase` / `squashDiff`: only when
   `lastCommitSubject === DONE_SUBJECT` AND `config.squash` is true AND a
   `firstGrilling` exists in the current cycle. In the existing
   `if (hasCommits) { … }` block you already have `firstGrilling` and
   `currentCycle` in scope. After the review-base computation, add:

   - Resolve the squash base = parent of `firstGrilling` (its hash), with
     `EMPTY_TREE` fallback when it is the root.
   - `squashDiff = git.diffRef(squashBase)` (NO exclude argument — pass no
     workflow-file excludes).
   - Set both only when the gate holds; otherwise leave them `undefined`.

   Note: `firstGrilling.hash` is the child; you need its parent. If `firstGrilling`
   is the root commit (no parent), use `EMPTY_TREE`.

3. Spread `squashBase` / `squashDiff` onto the payload with the same
   `...(x !== undefined ? { x } : {})` pattern used for `reviewBase` / `refDiff`.

Constraints:
- Do NOT add an interleaved-commit guard / range-walk / all-gtd check
  (Resolved Q3): squash the entire `<squashBase>..HEAD` range unconditionally.
- Do NOT exclude workflow files from `squashDiff`.
- Keep the edge thin — no LLM calls, no commit here (the agent runs the squash).

## What to change in `src/Events.test.ts`

`Events.test.ts` drives real temp git repos. Add scenarios (mirroring the
existing review-base tests) asserting the RESOLVE payload's squash fields:

- HEAD `gtd: done` after a `gtd: grilling … gtd: done` cycle, `squash` enabled →
  `squashEnabled: true`, `squashBase` = parent of the first `gtd: grilling`,
  `squashDiff` non-empty (contains the feature's code).
- HEAD `gtd: done` with an **interleaved** non-gtd commit
  (e.g. `feat: coworker`) between two `gtd: *` commits → `squashBase` still =
  parent of the first `gtd: grilling` (the coworker commit is INSIDE the range).
- `squash: false` in config → `squashEnabled: false`, `squashBase` / `squashDiff`
  unset.
- HEAD is NOT `gtd: done` (e.g. `gtd: building`) → `squashBase` / `squashDiff`
  unset even with squash enabled.
- Already-squashed: HEAD is a plain `feat:` boundary (no `gtd: done`, no
  `gtd: grilling` in cycle) → `squashBase` unset.

Check how `Events.test.ts` reads config in tests (it provides a `ConfigService`
layer / test config). Set `squash` there per scenario.

## Acceptance criteria

- [ ] `gatherEvents` sets `squashEnabled` from `config.squash`.
- [ ] `squashBase` = parent hash of the first `gtd: grilling` of the current
      cycle (EMPTY_TREE when root), set ONLY when HEAD is `gtd: done` AND squash
      enabled AND a `firstGrilling` exists.
- [ ] `squashDiff` = `git diff <squashBase> HEAD` with NO workflow-file exclusion,
      set under the same gate.
- [ ] No interleaved-commit guard / range-walk added.
- [ ] `Events.test.ts` covers: happy done-cycle, interleaved commit, squash
      disabled, non-done HEAD, already-squashed.
- [ ] `npx vitest run src/Events.test.ts` passes.
