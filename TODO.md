# Refactor gtd into an xstate event-sourced state machine

## Open Questions

### Where does `maxVerifyIterations` (the escalate cap) come from — a hardcoded constant or parsed from `AGENTS.md`?

The machine now needs the cap as a real TypeScript value at fold time to decide
`escalate`. Today **no code reads `AGENTS.md`** — retry limits live only as
prompt text (`execute.md`/`execute-simple.md`: "retry limit reached (default: 5,
check AGENTS.md)"). `README.md`/`SKILL.md` advertise the retry limit as
AGENTS.md-configurable, but nothing enforces that in code.

**Recommendation:** Hardcode `maxVerifyIterations = 5` as a constant in
`Machine.ts` for this refactor. The machine cap is a structural backstop; a real
`AGENTS.md` parser doesn't exist yet and building one would balloon scope. Keep
the prompts' "check AGENTS.md" hint for the agent-level retry guidance, but make
`README.md`/`SKILL.md` honest that the **machine-enforced** cap is currently
fixed at 5. Track AGENTS.md-driven config as a follow-up.

<!-- user answers here -->

### What bounds the `COMMIT` event stream when there is no default branch / no merge-base (e.g. on `main` itself)?

`computeReviewBase` already degrades to `Option.none`, but the COMMIT stream
base (`merge-base(default,HEAD)`) is a separate concern, and `verifyIterations`
folds over it. On `main`, or with no resolvable default branch / merge-base,
`merge-base(default,HEAD)..HEAD` is empty → zero COMMIT events → counter stuck
at 0 → `escalate` unreachable.

**Recommendation:** The trailing `fix(gtd):` run always terminates at the first
non-fix commit, so the stream only needs to reach back far enough to include
that run. Use `merge-base(default,HEAD)..HEAD` (first-parent) when available;
when there is no default branch or no merge-base, fall back to the full
first-parent history (`git log --first-parent`, i.e. root..HEAD). Make
`commitSubjects(base?)` take an optional base where `undefined` ⇒ whole history.
Correct counter in every repo shape (including gtd's own `main`) at negligible
cost.

<!-- user answers here -->

### How does `escalate` resume, and what does `escalate.md` instruct?

`escalate` halts (not auto-advance tagged). The counter only resets when a
non-`fix(gtd):` commit lands at HEAD. So after the human intervenes, what
unsticks the loop?

**Recommendation:** `escalate.md` should (a) report that N consecutive
`fix(gtd):` attempts failed to get tests green, (b) surface the latest failure
output, (c) ask the human to fix the root cause and commit it with a normal
prefix (anything but `fix(gtd):`, which resets the counter to 0 and re-enters
the gate fresh) — or amend/squash the `fix(gtd):` chain — and (d) STOP. No
machine change needed: reset is purely "next non-`fix(gtd):` commit at HEAD."
Note the implication for the gate: it must commit **all** its fix changes into
the single `fix(gtd):` commit so the tree returns to clean/TODO-only and
`escalate` stays reachable (a stray uncommitted file would route to
`code-changes` and reset the counter).

<!-- user answers here -->

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
- **New `escalate` halt state** when the counter hits the cap (default 5).

### The mixed-dirty / verify flow (the key behavior)

When the tree is dirty with BOTH non-TODO code changes and `TODO.md` edits:

1. **`code-changes`** commits only the non-TODO code; `TODO.md` is left dirty.
2. Re-run. The tree now has only `TODO.md` dirty. The machine routes into the
   next state, which **begins with a test gate**: run the suite; on failure,
   make ONE fix → commit `fix(gtd): <desc>` → re-run gtd. Each fix is a separate
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
  convention + iteration cap, the `escalate` state, markers-are-code, removal of
  the ref argument, and update the workflow-step/state-list notes.

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

_(none yet)_
