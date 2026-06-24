# README + bundle rebuild for the machine-directed-action model

Reflect the new architecture in the README (per the user's standing rule that
every significant change is mirrored in the README) and rebuild the distributed
bundle so the installed skill / e2e run executes the current code.

## Files (this task)

- `README.md`
- the built bundle (run `npm run build` — `tsup`; outputs per `package.json` /
  `scripts/gtd.js`). Commit the regenerated bundle artifact(s).

> File-disjoint from sibling task 01 (feature files + step defs). Run AFTER 01's
> code is in place is not required — but the bundle MUST be rebuilt before
> `npm run test:e2e` (task 01) is executed, since e2e runs `scripts/gtd.js`.
> Sequence: rebuild bundle, then run e2e.

## README changes

- State table / decision tree (`README.md` ~lines 55-65, 200-216, 255-285):
  - `cleanup`, `close-review`, `code-changes` are now EDGE-DRIVEN no-agent
    actions (no prompt) — describe them as machine-directed `EdgeAction`s the
    edge executes, mirroring how `review-process` is already described as
    edge-driven.
  - Describe the unified machine-directed-action model: the machine resolves to a
    leaf and may emit a typed `EdgeAction` (`removeGtdDir`, `closeReview`,
    `commitPending`, `runTestGate`, `reviewPreRender`); `main.ts` is a driver
    loop that executes actions, re-feeds events, and emits exactly one prompt.
  - Test gate: now fires ONLY before `execute`; `human-review` and the planning
    steps are no longer test-gated.
  - The no-agent hop cap (`MAX_NO_AGENT_HOPS = 8`) + stuck guard → escalate,
    alongside the existing verify cap.
  - Part B: the post-agent commit is generalized — the agent leaves work
    uncommitted + an intent descriptor, and the NEXT cycle's edge commits it with
    the disambiguated message; only hunk grouping (human-review) and
    execute-simple's message stay LLM work.
- Remove/replace any README text implying those leaves emit an agent prompt.

## Bundle rebuild

- `npm run build` (tsup). Verify `scripts/gtd.js` (the e2e entrypoint per
  `tests/integration/support/world.ts`) reflects the new behavior.
- Commit the regenerated artifact so the installed skill is not stale (per the
  MEMORY note "the installed skill's gtd.js can be stale vs the repo build").

## Acceptance criteria

- [ ] README state table + decision-tree + prose describe the
      machine-directed-action model, the execute-only test gate, the no-agent hop
      cap, and the Part B generalized commit; no stale "agent commits / agent
      runs cleanup" wording.
- [ ] `npm run build` succeeds; the rebuilt bundle is committed.
- [ ] `npm run test` still green; `npm run typecheck` passes;
      `npm run format:check` clean (or run `npm run format`).
- [ ] `npm run test:e2e` passes against the rebuilt bundle (after task 01).

## Constraints / edge cases

- This package is the only place the bundle is rebuilt; do not rebuild it in
  earlier packages (keeps their diffs reviewable).
- README is documentation only — no behavior change.
