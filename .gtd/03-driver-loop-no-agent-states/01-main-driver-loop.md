# main.ts: pure driver loop over machine-emitted `EdgeAction`s

Replace the hard-coded `review-process` `if` block and the `TEST_GATED_LEAVES`
set with a single dumb driver loop that asks the machine for an `EdgeAction`,
executes it via the right service, re-feeds, and emits exactly ONE prompt at the
end. No status output. This package wires Part A's no-agent git ops AND the
folded test-gate / review-pre-render side-effect actions into the edge.

## Files (this task)

- `src/main.ts`

> File-disjoint from sibling task `02-retire-no-agent-prompts.md`
> (`src/Prompt.ts` + prompt `.md` files + `Prompt.test.ts`). No vitest file
> covers `main.ts`; its behavior is verified by e2e (package 07). `npm run test`
> stays green because no `*.test.ts` here changes.

## Driver loop (`src/main.ts`)

Keep the `format` subcommand and the unknown-command rejection unchanged. Replace
the body after `const config = yield* ConfigService` with the loop:

```
handle = yield* startDetect()          // gathers events, opens the live handle
loop:
  r = handle.current
  switch (r.edgeAction?.kind) {
    case "removeGtdDir":
      yield* git.removeGtdDir()
      handle.advance(yield* gatherEvents()); continue
    case "closeReview":
      yield* git.closeReview(r.edgeAction.base)
      handle.advance(yield* gatherEvents()); continue
    case "commitPending":
      yield* git.commitPending()
      handle.advance(yield* gatherEvents()); continue
    case "runTestGate":
      t = yield* runner.run()
      handle.advance([{ type: "TEST_RESULT", exitCode: t.exitCode, output: t.output }]); continue
    case "reviewPreRender":
      rec = yield* git.recordAndRevertReview(r.edgeAction.base)
      handle.advance([{ type: "REVIEW_RECORDED", diff: rec.diff, recordSha: rec.recordSha }]); continue
    case undefined:
      write(buildPrompt(r, overrideFromContext(r), config.resolveModel)); return
  }
```

Notes:

- `startDetect()` / the handle come from package 02's `State.ts`. `gatherEvents`
  is imported from `Events.js`.
- The `git` (`GitService`) and `runner` (`TestRunner`) services are acquired via
  `yield*` as today; keep the existing `Effect.provide(...)` composition root at
  the bottom unchanged (GitService.Live, TestRunner.Live, ConfigService.Live,
  NodeContext.layer, catchAll).
- `overrideFromContext(r)` builds the `PromptOverride` the FINAL render needs from
  context the machine left behind:
  - if `r.value === "fix-tests"` → `{ kind: "fix-tests", testOutput: r.context.testOutput }`
  - if `r.value === "review-process"` and `r.context.reviewDiff` is present →
    `{ kind: "review-process", reviewDiff: r.context.reviewDiff, recordSha: r.context.recordSha }`
  - else `undefined`.
  (Package 02 already exposes `testOutput`/`reviewDiff`/`recordSha` on context.)
- DELETE the `if (result.value === "review-process") { ... }` block
  (`main.ts:29-40`) and the `TEST_GATED_LEAVES` block (`main.ts:42-57`)
  entirely.
- **No status output**: the loop writes NOTHING to stdout until the single final
  `buildPrompt`. Respect the `ensureNewline`/stdout discipline (AGENTS.md): the
  only `process.stdout.write` is the final prompt, exactly as today.
- Loop guard: the machine bounds the loop via `MAX_NO_AGENT_HOPS`/stuck →
  `escalate` (no `edgeAction`), so the `undefined` tail also handles escalate.
  Do NOT add an imperative iteration cap in `main.ts` (Resolved q7 — the cap is
  machine logic).

## Acceptance criteria

- [ ] `TEST_GATED_LEAVES` and the `review-process` `if` are gone from `main.ts`.
- [ ] The driver switches on `r.edgeAction?.kind`, executing each via
      `GitService` / `TestRunner` / `recordAndRevertReview`, re-feeding events,
      and emits exactly one prompt on `undefined`.
- [ ] `human-review` no longer spawns `TestRunner` (it produces no `runTestGate`
      action).
- [ ] No stdout output other than the final prompt.
- [ ] `escalate` (cap / stuck / verify cap) is rendered via the same tail.
- [ ] `npm run test` green; `npm run typecheck` passes; `npm run lint` clean.

## Constraints / edge cases

- All git writes + the test spawn + REVIEW.md recording stay in
  `main.ts`/`GitService`/`TestRunner`; the machine performs none of them.
- `recordAndRevertReview` fails on revert conflict (existing behavior) — let the
  top-level `catchAll` print to stderr + exit 1 as today.
- Missing `base` for `closeReview`/`reviewPreRender` should never happen (machine
  only emits them when `baseRef` is set), but if `base` is empty, surface a clear
  error via `Effect.fail` rather than passing `undefined!`.
