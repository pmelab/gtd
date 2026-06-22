# Deterministic test execution in gtd.js

Today gtd never runs tests itself — every prompt that needs a test gate
(`human-review`, `execute`) instructs the _agent_ to determine and run the test
command. This is non-deterministic: the agent may pick the wrong command, skip
the run, or misread the result. Move test execution into `scripts/gtd.js` so the
pass/fail signal is authoritative and gtd emits a different prompt based on it.

## Design

### Test command

- Hardcode `npm run test` as the command for now (no env override, no config
  inference). A future plan can make it configurable.

### Where tests run — the Effect edge, not the machine

`src/Machine.ts` stays pure and IO-free (the `resolve` fold). Test execution is
IO, so it lives in the Effect edge (`src/State.ts` / `src/main.ts`), gated on
the resolved leaf state:

- The edge calls `resolve(events)` as today to get the leaf.
- If the leaf is `human-review` **or** `execute`, the edge runs `npm run test`
  (capturing stdout+stderr and exit code) **before** emitting a prompt.
- **Green (exit 0):** emit the leaf's normal prompt (REVIEW.md generation for
  `human-review`; next-package execution for `execute`).
- **Red (exit ≠ 0):** emit a new `fix-tests` prompt that embeds the captured
  failure output and instructs: make exactly ONE fix, commit it as
  `fix(gtd): <desc>`, then re-run gtd. This mirrors the current `human-review`
  test-gate behavior, so the `fix(gtd):` escalation cap still counts.

No new machine state — the `fix-tests` branch is a prompt-selection decision in
the edge, keyed off `(leafState, testExitCode)`.

### Escalation cap in both paths

Before emitting a `fix-tests` prompt, the edge reads the trailing `fix(gtd):`
count from the resolved context; if it has reached `MAX_VERIFY_ITERATIONS` (5),
the edge emits the `escalate` prompt instead. This keeps the cap working
uniformly without reordering the machine guards: `human-review` already sits
below `capReached`, but `execute` sits above it (`hasPackages` is checked
first), so without this edge check a failing-test package would loop forever.

### human-review path

- Remove the "Test gate (run first)" agent instructions from `human-review.md` —
  the edge now runs tests deterministically.
- Green → existing REVIEW.md-generation prompt, unchanged.
- Red → `fix-tests` prompt with the failure output.

### execute path — one package per cycle

Restructure `execute.md` so each gtd invocation executes **exactly one** work
package, not the whole `.gtd/` sequentially:

1. Edge resolves to `execute` (packages remain), runs `npm run test` first.
   - On a clean tree this verifies the _previously committed_ package's
     cumulative state. The very first execute cycle verifies the
     decompose/baseline commit (expected green).
   - Red → `fix-tests` prompt (a prior package broke tests).
   - Green → emit the execute prompt for the **next** (lowest-numbered) package.
2. The execute prompt: spawn parallel workers for that one package's tasks, then
   commit with its `COMMIT_MSG.md`, delete the package dir, and re-run gtd.
3. Next cycle repeats: edge runs tests (verifying the package just committed),
   then proceeds to the next package — until `.gtd/` is empty → `cleanup`.

This removes the in-prompt "testing subagent" step (Step 2 of `execute.md`):
verification now happens at the _start_ of the following cycle via the edge.

### Tests (e2e fixtures)

Because the command is hardcoded to `npm run test`, cucumber fixture repos that
reach `human-review`/`execute` must include a `package.json` whose `test` script
exits 0 or non-zero on demand — that's how scenarios drive green/red
deterministically (e.g. `{"scripts":{"test":"exit 1"}}` for a red run). Add
composable Given steps that write such a `package.json`. New `.feature`
coverage:

- human-review green → REVIEW.md emitted.
- human-review red → `fix-tests` prompt with embedded output; one `fix(gtd):`
  commit; re-run.
- execute one-package-per-cycle: package N committed, next cycle verifies then
  runs N+1.

## Answered Questions

### How should the escalation cap interact with the execute test-fix loop?

**Decision:** the edge checks the trailing `fix(gtd):` count before emitting a
`fix-tests` prompt and emits `escalate` at `MAX_VERIFY_ITERATIONS` (5). Machine
guard order is left untouched. (See "Escalation cap in both paths" above.)

### Should the first execute cycle skip the redundant baseline test run?

**Decision:** keep it. The edge runs `npm run test` at the start of every
`execute` cycle, including the first. It is stateless, and a red baseline is a
real signal (the plan was decomposed on top of an already-broken tree). No
first-vs-later-cycle special-casing.
