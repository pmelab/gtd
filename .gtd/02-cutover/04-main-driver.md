# Task: Rewrite `src/main.ts` + `src/State.ts` as the pure-resolve driver

Replace the xstate `Handle`/`advance` driver with a loop over the pure
`resolve()` + `edgeAction`: perform the action → re-gather → re-resolve until a
prompt-bearing or STOP state, then emit the single prompt. Part of the **atomic
cutover** package (shared contract in `01-machine-resolver.md`).

Spec pointers: `STATES.md` § States (each state's Actions + Prompt); `TODO.md` →
"Modules to rewrite → src/main.ts / src/State.ts", the state→action→commit table,
and Resolved Q5 (no `gtd transport` subcommand).

## Driver loop

Each turn: `events = gatherEvents()`; `r = resolve(events)`. If `r.edgeAction`
present, perform it (via `GitService` + `TestRunner`), then re-`gatherEvents` and
re-`resolve`; repeat until `r.edgeAction` is absent. Then
`process.stdout.write(buildPrompt(r, config.resolveModel))`. STOP states have no
edgeAction and `autoAdvance:false`, so the loop emits their prompt and exits.

Implement each `EdgeAction` (semantics from STATES.md + the TODO.md table):

- `transportReset` → `git.mixedResetHead()`.
- `seedNewFeature` → if HEAD ≠ `gtd: new task`: `git.commitAllWithPrefix("gtd:
  new task")` (durable capture); then `git.revertNoCommit("HEAD")`; then write a
  **deterministic, edge-built** seed `TODO.md` from the captured diff (any
  embedded TODO.md text verbatim, then the raw diff fenced under a "captured
  input" heading). No agent runs. Leave uncommitted.
- `seedAcceptReview` → write the seed `TODO.md` from the review changeset;
  `git.checkoutAll()` (discard the human's code edits); remove `REVIEW.md`. All
  uncommitted (no commit of its own).
- `runTest` → `git.commitAllWithPrefix("gtd: building")` (skip if nothing
  pending, e.g. the no-op-fixer case); `runner.run()`; exit 0 → return (loop
  re-gathers → Agentic Review); exit ≠ 0 → write the captured output to
  `FEEDBACK.md` when `!capReached`, else to `ERRORS.md`, then
  `git.commitAllWithPrefix("gtd: errors")`. (`errorCount`/`capReached` come from
  the action.)
- `commitPending` → `git.commitAllWithPrefix(action.prefix)` (grilling / grilled
  / planning / fixing / awaiting review use this with their own subject; fixing
  uses `gtd: feedback` when consuming uncommitted review FEEDBACK, `gtd: fixing`
  when consuming committed test FEEDBACK — the machine/edge picks the prefix).
- `closePackage` → remove the empty `FEEDBACK.md`; `git.removePackageDir(<lowest
  remaining .gtd/NN-…>)` (also removes a now-empty `.gtd/`);
  `git.commitAllWithPrefix("gtd: package done")`.
- `commitReview` → `git.commitAllWithPrefix("gtd: awaiting review")`.
- `done` → remove `REVIEW.md`; `git.commitAllWithPrefix("gtd: done")`.

## Subcommands

Keep `format` as the **only** non-default subcommand (unchanged). **No `gtd
transport` subcommand** (Q5) — the `gtd: transport` HEAD is hand-committed by the
user; the machine only consumes it. Reject any other subcommand as today.

## `src/State.ts`

Collapse to a thin `gatherEvents` + `resolve` shim (or fold into `main.ts`).
Remove the `start`/`Handle`/`advance` re-exports and the duplicated
`computeReviewBase`. Drop `TEST_RESULT`/`REVIEW_RECORDED` plumbing.

## Files

- Rewrite: `src/main.ts`
- Rewrite (or remove + fold): `src/State.ts`

## Constraints

- Import `resolve` + types from `./Machine.js`, `gatherEvents` from
  `./Events.js`, `buildPrompt` from `./Prompt.js`, `GitService` from `./Git.js`,
  `TestRunner` from `./TestRunner.js`, `ConfigService` from `./Config.js`,
  `Format` from `./Format.js`. Do **not** import `deriveCommitMessage` or any
  deleted Git/Prompt symbol.
- Keep the Effect composition root (`GitService.Live`, `TestRunner.Live`,
  `ConfigService.Live`, `NodeContext.layer`) and the top-level
  `Effect.catchAll` error → stderr + exit 1.
- Guard against an infinite edge loop (e.g. corruption hard-error surfaces as the
  resolver throwing, caught at the root).

## Acceptance criteria

- [ ] The driver performs each `EdgeAction`, re-gathers, and re-resolves until a
      prompt/STOP state, then prints exactly one prompt.
- [ ] `gtd format <file>` still works; unknown subcommands are rejected; there is
      no `transport` subcommand.
- [ ] No `xstate`/`Handle`/`TEST_RESULT`/`REVIEW_RECORDED` references remain.
- [ ] Builds via tsup (`npm run build`) and drives the new e2e features green at
      package completion.
