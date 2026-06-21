# Refactor gtd into an xstate event-sourced state machine

## Context

Today `src/State.ts#detect()` takes a single git **snapshot** and emits a
`branches: Branch[]` array (multiple sections fire at once). It is memoryless —
it can't reason about how it got here, so it can't count iterations or escalate.

Make gtd **malleable**: ingest git history since the default branch + the
uncommitted working tree as an ordered **event stream**, fold it through an
**xstate** machine (used as a pure reducer) to compute one current state, and
derive the next prompt + the "re-run gtd" directive from that state. First
payoff: a test-fix loop that counts iterations from history and escalates to a
human after a cap.

Settled decisions (see Open Questions above for the three still-live points):

- **Sequential, single active state** (no concurrent branches).
- **Pure fold**: all git IO at the Effect edge → typed event array → synchronous
  xstate replay → read `snapshot.value` / `snapshot.hasTag(...)`. No xstate
  `invoke`/actors/delays.
- **No CLI ref argument.** Review is triggered entirely by the machine; the
  review base is always auto-computed (existing `computeReviewBase`). The
  separate `review-create` state and the `START_REVIEW` entry point are removed
  — the auto-computing `human-review` state is the sole REVIEW.md generator.
- **Auto-advance = an xstate `tag`**, replacing the hardcoded
  `AUTO_ADVANCE_BRANCHES` set.
- **`TODO:` markers leave the normal loop** — treated as ordinary code (future
  notes); marker→`TODO.md` extraction becomes a review-process concern only.
- **Test-fix iterations marked `fix(gtd): <desc>`**; counter = trailing run of
  such commits at HEAD (any other commit resets it).
- **New `escalate` halt state** when the counter hits the cap. The cap
  (`maxVerifyIterations`) is a **hardcoded constant `5` in `Machine.ts`** — no
  `AGENTS.md` parsing (none exists today); `README.md`/`SKILL.md` must say the
  machine-enforced cap is fixed at 5. `escalate.md` reports the N failed
  `fix(gtd):` attempts + latest failure output and asks the human to fix the
  root cause and commit it with any non-`fix(gtd):` prefix (which resets the
  counter to 0 and re-enters the gate) or amend/squash the chain, then STOP.

### The mixed-dirty / verify flow (the key behavior)

When the tree is dirty with BOTH non-TODO code changes and `TODO.md` edits:

1. **`code-changes`** commits only the non-TODO code; `TODO.md` is left dirty.
2. Re-run. The tree now has only `TODO.md` dirty. The machine routes into the
   next state, which **begins with a test gate**: run the suite; on failure,
   make ONE fix → commit **all** the fix changes into a single
   `fix(gtd): <desc>` commit (leaving only `TODO.md`/clean tree behind, so
   `escalate` stays reachable — a stray uncommitted file would route to
   `code-changes` and reset the counter) → re-run gtd. Each fix is a separate
   commit and a separate invocation; the machine counts the trailing run of
   `fix(gtd):` commits.
3. While tests are red and the count is below the cap, the gate keeps looping;
   at the cap it routes to **`escalate`** (halt, ask the human).
4. Once tests pass, the only change left is `TODO.md`, so it naturally
   progresses into planning (`new-todo`/`modified-todo`) → decompose → execute.

The test gate is a prefix of every state that follows code work (`new-todo`,
`modified-todo`, `human-review`, `verified`); `code-changes` itself just commits
and re-runs — the gate runs in the state it advances into. This is how "each fix
re-invokes gtd, counted, capped" works without the machine needing to observe
test results: only failures break the invocation (commit + re-run); the green
case proceeds inline within the same turn.

## Plan

### Event model

Two event kinds, fed in order to the machine:

1. `COMMIT` — one per commit `merge-base(default,HEAD)..HEAD`, first-parent,
   oldest→newest, with `kind` derived from the subject. Action updates the
   counter: `kind==="fixGtd"` (`fix(gtd):`) → `verifyIterations++`, else
   `verifyIterations=0` (yields the trailing run). Unknown subjects → reset, no
   state change.
2. `RESOLVE` — terminal working-tree payload: `codeDirty` (any non-`TODO.md`
   uncommitted change), `TODO.md` new/modified/finalized/simple, `.gtd`
   packages, REVIEW.md exists/modified, auto-computed review base + unreviewed
   `refDiff`, diffs, `lastCommitSubject`. Guarded transitions pick the single
   final leaf.

Machine context carries everything Prompt needs: `verifyIterations`,
`maxVerifyIterations` (default 5), `lastCommitSubject`, `workingTreeClean`,
`packages`, `diff`, `baseRef`, `refDiff`. Machine shape: `replaying` (initial) →
`COMMIT` (self-transition, update counter) → `RESOLVE` (guarded → leaf).

### Final states (single active; priority order)

1. REVIEW.md modified → **`review-process`** [auto-advance]
2. `codeDirty` → **`code-changes`** [auto-advance] — commit non-TODO code only;
   leave `TODO.md` dirty; re-run.
3. `.gtd` packages → **`execute`** [auto-advance]
4. empty `.gtd` → **`cleanup`** [auto-advance]
5. committed finalized `TODO.md` (not dirty) → **`decompose`** /
   **`execute-simple`** [auto-advance]
6. trailing `fix(gtd):` count ≥ `maxVerifyIterations` → **`escalate`** [halt]
7. `TODO.md` dirty (new/modified) → **`new-todo`** / **`modified-todo`**
   [auto-advance] — prompt runs the test gate first, then develops the plan.
8. else (clean) unreviewed diff → **`human-review`** [halt, test gate]; else →
   **`verified`** [halt, test gate]

Auto-advance is an xstate `tag`. `human-review` / `verified` / `escalate` are
**not** tagged — their re-run-on-test-failure is prompt-driven (the gate), and
on green they STOP. The tag governs only the generic unconditional re-run
partial.

**Removed:** the dead `verify` state (never emitted by `detect()` — only in the
SECTIONS map + unit tests), the normal-loop `todo-markers` state, and the
ref-arg `review-create` state.

### Files

New:

- `src/Machine.ts` — `xstate` v5
  `setup({ types, guards, actions }).createMachine`
  - a pure `resolve(events) → { value, context, autoAdvance }` helper
    (`createActor`, send events, read snapshot). Tags via
    `tags: ["auto-advance"]`.
- `src/Events.ts` — edge IO: gather git/FS data (reuse `GitService`,
  `FileSystem`) and build the typed event array. Houses the moved
  `computeReviewBase` + the working-tree probing currently in `detect()`, plus
  commit-list derivation.

Modified:

- `src/Git.ts` — add `commitSubjects(base?)` (subjects first-parent,
  oldest→newest; `base` given ⇒ `base..HEAD`, `base` omitted ⇒ whole history
  `git log --first-parent` — see Open Question 2). Reuse `resolveDefaultBranch`,
  `mergeBase`, `lastReviewCommit`, `isAncestor`, `commitCount`, `diffRef`,
  `diffHead`, `statusPorcelain`. Only a binary `fix(gtd):`-or-not distinction is
  needed from the subject — the `lastReviewCommit` grep stays at the edge, not
  in the event stream.
- `src/State.ts` — `detect()` becomes gather → `resolve()` → return
  `{ value, context, autoAdvance }`. Drop `branches: Branch[]`, the
  `diffAddsTodoMarker` helper, and all ref-arg handling.
- `src/Prompt.ts` — `SECTIONS` keyed by leaf id; emit one section (no array
  loop); auto-advance from the passed flag, not `AUTO_ADVANCE_BRANCHES`. Drop
  `todoMarkers`/`verify` imports; add `escalate`.
- `src/main.ts` — keep the `format` subcommand; remove ref-arg parsing
  (`detect()` no longer takes a ref); adapt to the new return type.
- `src/prompts/`: delete `todo-markers.md`, `verify.md`, `review-create.md`; add
  `escalate.md`; add the test-gate preamble (run tests → on fail one fix →
  commit `fix(gtd):` → re-run) to `new-todo.md`, `modified-todo.md`,
  `human-review.md`, `verified.md`; edit `review-process.md` to absorb
  `TODO:`-marker extraction. `code-changes.md` keeps "commit only non-TODO code,
  leave `TODO.md` dirty".
- `package.json` — add `xstate` (^5).
- `README.md`, `AGENTS.md`, `SKILL.md` — document the machine, the `fix(gtd):`
  convention + iteration cap (state the machine-enforced cap is **fixed at 5**,
  not AGENTS.md-configurable), the `escalate` state, markers-are-code, removal
  of the ref argument, and update the workflow-step/state-list notes.

### Tests

- `tests/integration/features/review.feature` — remove all ref-arg scenarios
  (`gtd <valid-ref>`, `<invalid-ref>`, ref+REVIEW.md conflict, ref+dirty-tree,
  ref==HEAD empty-diff). Keep review-process + REVIEW.md corruption/unmodified
  error scenarios (no ref arg involved).
- `tests/integration/features/branches.feature` — rewrite the "New TODO: markers
  compose with commit task" scenario: markers now yield **only**
  `## Task: Commit the uncommitted changes`. Keep the other scenarios green
  (parity proof).
- `tests/integration/features/auto-advance.feature` — drop the "Review-create
  prompt … with ref HEAD~1" scenario.
- New `tests/integration/features/verify-loop.feature` — mixed code+TODO dirty →
  code committed, TODO left dirty; chain of `fix(gtd):` commits below cap →
  gated state; at cap → `escalate` (assert no auto-advance); on green →
  planning.
- `src/Prompt.test.ts` — drop `verify`/`todo-markers`; add `escalate`; switch
  from `branches[]` to single-state input.
- New `src/Machine.test.ts` — fold unit tests: COMMIT sequences →
  `verifyIterations`; RESOLVE payloads → expected leaf + `hasTag`.
- One composable `Given` per commit (AGENTS.md).

### Verification

- `npm run typecheck && npm run lint`
- `npm test` (unit: Machine + Prompt + Git/Format)
- `npm run build` then `npm run test:e2e` (cucumber drives built
  `scripts/gtd.js`)
- Manual smoke: dirty code+TODO → code committed, TODO left dirty; re-run → test
  gate; chain of `fix(gtd):` commits → gated state until the 5th → `escalate`;
  green → planning → decompose; clean unreviewed history → human-review.

## Answered Questions

### Where does `maxVerifyIterations` (the escalate cap) come from — a hardcoded constant or parsed from `AGENTS.md`?

**Recommendation:** Hardcode `maxVerifyIterations = 5` in `Machine.ts`; no
`AGENTS.md` parser exists, so building one would balloon scope. Make
`README.md`/`SKILL.md` honest that the machine-enforced cap is fixed at 5.

**Answer:** hardcoded for now.

### What bounds the `COMMIT` event stream when there is no default branch / no merge-base (e.g. on `main` itself)?

**Recommendation:** `commitSubjects(base?)` first-parent; `base` given ⇒
`base..HEAD`, omitted ⇒ whole history. Use `merge-base(default,HEAD)` when
available, else fall back to full first-parent history. Trailing `fix(gtd):` run
ends at the first non-fix commit, so the counter stays correct in every repo
shape.

**Answer:** agreed.

### How does `escalate` resume, and what does `escalate.md` instruct?

**Recommendation:** Reset is purely "next non-`fix(gtd):` commit at HEAD."
`escalate.md` reports the failed attempts + latest failure, asks the human to
fix

- commit with a non-`fix(gtd):` prefix (or amend/squash the chain), then STOP.
  The gate must commit all its fix changes into the single `fix(gtd):` commit so
  `escalate` stays reachable.

**Answer:** agreed.
