# State.ts: expose the stepping handle, retire `selectPrompt`

Reconcile the edge-facing `State.ts` with the new stepping machine from the
sibling task. `detect()` opens the live handle; the `selectPrompt` /
`PromptSelection` green/fix/escalate logic is GONE (it now lives in the machine's
`TEST_RESULT` fold). Land the `State.test.ts` updates here so vitest stays green.

## Files (this task)

- `src/State.ts`
- `src/State.test.ts`

> File-disjoint from sibling task `01-machine-stepping-and-folds.md`
> (`Machine.ts` / `Machine.test.ts`). Do not touch those here. This task DEPENDS
> on the symbols that task adds (`start`, `advance`, `EdgeAction`,
> `ResolveResult.edgeAction`, `TEST_RESULT`/`REVIEW_RECORDED` events) — both
> tasks run in parallel against the same package branch, so import them as the
> sibling defines them.

## Changes (`src/State.ts`)

- DELETE `selectPrompt`, `PromptSelection`, and the `PromptOverride` re-export
  block (`State.ts:15-49`). The branching moved into the machine. (Keep the
  `TestResult` interface only if `main.ts`/package 04 still needs it; otherwise
  re-export `TestResult` from `TestRunner.ts`. Coordinate the canonical home —
  prefer re-exporting `TestRunner`'s `TestResult`.)
- Re-export `EdgeAction` from `Machine.js` (so `main.ts` can import it via
  `State.js` if convenient), alongside the existing `ResolveResult` re-export.
- Replace `detect()` so it gathers events and returns the OPEN HANDLE rather than
  a one-shot `ResolveResult`. Expose a function the driver can call:
  ```ts
  export const startDetect = (): Effect.Effect<
    Handle, Error, GitService | FileSystem.FileSystem
  > => Effect.gen(function* () {
    const events = yield* gatherEvents()
    return start(events)
  })
  ```
  where `Handle` is the type returned by `Machine.start`. Keep a `detect()` that
  returns the first `ResolveResult` (wrapper over `startDetect`) ONLY if other
  callers/tests still need it; otherwise remove it and update its callers. Pick
  whichever keeps `main.ts` (package 03) and tests cleanest — document the choice
  in the handle's doc comment.
- `gatherEvents()` import stays; `State.ts` still performs NO git writes — those
  are executed by `main.ts` (package 03).

## Acceptance criteria

- [ ] `selectPrompt` / `PromptSelection` removed from `src/State.ts`.
- [ ] `State.ts` exposes a way to obtain the live stepping handle after gathering
      events (`startDetect` or equivalent) returning the `Machine.start` handle.
- [ ] `EdgeAction` and `ResolveResult` are importable through `State.js`.
- [ ] No git writes in `State.ts`; `gatherEvents` still the only IO entry.
- [ ] `npm run test` green; `npm run typecheck` passes.

## Tests this task MUST update (`src/State.test.ts`)

- DELETE the `describe("selectPrompt", ...)` block and the
  `describe("test gate → buildPrompt integration", ...)` block that depend on
  `selectPrompt` (the green/fix/escalate coverage now lives in `Machine.test.ts`
  via the sibling task; the buildPrompt-integration coverage moves to
  `Prompt.test.ts` in package 03/04 — note that here so it is not lost).
- If `State.test.ts` would otherwise be empty, either remove the file or replace
  its body with a focused test of `startDetect`/the handle wiring that does NOT
  require git IO (e.g. assert the exported handle type/`current` shape via a
  hand-built event array fed through `Machine.start` — but that belongs in
  `Machine.test.ts`; prefer deleting `State.test.ts` if nothing IO-free remains).
- Ensure the suite imports compile (no dangling `selectPrompt` import).

## Constraints / edge cases

- Do not duplicate the test-gate branching here — it is machine logic now.
- Keep `State.ts` free of git writes and free of `TestRunner` spawns; those are
  the driver's job (package 03).
