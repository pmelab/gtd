# Review: 8442fb8

<!-- base: 8442fb8b690672ca3fc64509a769786da69e0492 -->

This branch offloads mechanical git/fs work from the agent to the deterministic
edge under one **machine-directed-action** model: the pure machine resolves to a
leaf and may emit a typed `EdgeAction`; `main.ts` is a driver loop that executes
the action via `GitService`/`TestRunner`, re-feeds events, and emits exactly one
prompt. Part A moves `cleanup`/`close-review`/`code-changes`, the test gate, and
the review pre-render into the machine; Part B generalizes the post-agent
commit.

## EdgeAction + no-agent GitService ops

The `EdgeAction` union and three fire-and-re-gather git ops (`removeGtdDir`,
`closeReview` extracted from `recordAndRevertReview`'s tail, `commitPending`).
Pure additions; `recordAndRevertReview` now delegates its close step.

- [ ] ./src/Machine.ts#13
- [ ] ./src/Git.ts#35
- [ ] ./src/Git.test.ts#1

## Machine: stepping handle + no-agent loop

The pure one-shot fold becomes a long-lived stepping machine: `start`/`advance`
over a live actor, `ResolveResult.edgeAction?`, `MAX_NO_AGENT_HOPS=8` +
`noAgentHops`/`lastAdvancedLeaf` context, no-agent leaves lose `type:"final"`
and loop back to `replaying`, `noAgentCapReached`/`stuck` → escalate.

- [ ] ./src/Machine.ts#99
- [ ] ./src/Machine.ts#78
- [ ] ./src/Machine.test.ts#1

## Test gate + review pre-render folded into the machine

The test-gate branching moves out of `selectPrompt` into a `runTestGate` action

- `TEST_RESULT` fold (gated to `execute` ONLY; `human-review` no longer gated);
  the review-process pre-render becomes a `reviewPreRender` action +
  `REVIEW_RECORDED` fold. `fix-tests` becomes a `LeafState`.

* [ ] ./src/Machine.ts#99
* [ ] ./src/State.ts#2
* [ ] ./src/main.ts#44

## main.ts driver loop

`main.ts` becomes a pure driver: it opens the handle via `startDetect`, switches
on `edgeAction.kind`, executes each via the right service, re-feeds events, and
emits exactly one prompt. `TEST_GATED_LEAVES` and the review-process `if` are
gone. No status output.

- [ ] ./src/main.ts#1
- [ ] ./src/main.ts#44

## Retire no-agent prompts + Prompt.ts wiring

`cleanup.md`/`close-review.md`/`code-changes.md` deleted; `SECTIONS` re-typed
with `Exclude` so the compiler proves those action leaves are never rendered;
fix-tests/review-process still render via their override paths.

- [ ] ./src/Prompt.ts#4
- [ ] ./src/Prompt.test.ts#1

## Strip test-gate blocks from non-execute prompts

The "Test gate (run first)" block removed from `new-todo`/`modified-todo`/
`verified` (the gate is machine-modeled and execute-only now).

- [ ] ./src/prompts/new-todo.md#1
- [ ] ./src/prompts/modified-todo.md#1
- [ ] ./src/prompts/verified.md#1

## Part B: generalized post-agent commit

The post-agent `git commit` moves out of the 7 agent prompts into the next
cycle's edge as a generalized `commitPending` action. The agent leaves work
uncommitted + a `.gtd-commit-intent` marker (repo root); `Events.ts` reads it
into `pendingCommitIntent`; the machine routes it to a disambiguated commit
AHEAD of the generic `code-changes`; the edge computes the message and commits
(execute → COMMIT_MSG.md + removes the consumed `.gtd/NN-…`; decompose → count;
human-review → base short-sha; fix-tests → preserved `Gtd-Test-Fix:` trailer).

- [ ] ./src/Machine.ts#99
- [ ] ./src/Events.ts#20
- [ ] ./src/Git.ts#141
- [ ] ./src/main.ts#44

## Part B: prompts drop the commit step

The 7 agent prompts now leave output uncommitted + write the intent marker;
residual LLM work kept (execute package exec, decompose `.gtd/` authoring,
human-review hunk grouping, plan dev + `gtd format`, simple impl, fix loop).

- [ ] ./src/prompts/execute.md#1
- [ ] ./src/prompts/decompose.md#1
- [ ] ./src/prompts/human-review.md#1
- [ ] ./src/prompts/fix-tests.md#1
- [ ] ./src/prompts/execute-simple.md#1

## e2e suite + README + bundle

Cucumber suite reworked to assert post-loop observables (git-log subjects + next
prompt) for the now edge-driven states, proves `human-review` skips the suite,
adds Part A loop + Part B commit coverage (`edge-loop.feature`). README + bundle
refreshed. (e2e: 113 scenarios pass.)

- [ ] ./tests/integration/features/edge-loop.feature#1
- [ ] ./tests/integration/features/test-gate.feature#1
- [ ] ./tests/integration/support/steps/common.steps.ts#1
- [ ] ./README.md#1

## !! Risks flagged during implementation (please scrutinize)

1. **`restorePaths` per intent** — the machine passes `restorePaths: []` for
   most intents (not the generic `["TODO.md","REVIEW.md"]`), because the default
   would un-stage decompose's/execute-simple's TODO.md deletion and
   human-review's REVIEW.md, leaving a permanently dirty tree. Verify this
   reasoning per intent.
2. **human-review semantics shift** — REVIEW.md is no longer committed by the
   agent; it's left uncommitted + marker, and the NEXT run commits whatever
   REVIEW.md looks like then. If the user edits REVIEW.md before that run, edits
   fold into the initial review commit. Confirm this matches intent.
3. **hop-cap/stuck not CLI-reachable** — every edge action always clears its
   trigger, so `noAgentCapReached`/`stuck` can't be tripped via real git
   fixtures; they're purely defensive (no e2e covers them). Escalation is
   covered via the reachable verify-cap / execute-gate / ERRORS.md paths.

- [ ] ./src/Machine.ts#99
- [ ] ./src/prompts/human-review.md#1
