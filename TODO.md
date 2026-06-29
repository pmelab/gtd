# Implement the new gtd state machine

Hard cutover to the design in **STATES.md** (visual: STATES.html). No backwards
compatibility — delete every shipped concept the new design replaces. We are
**not** preserving recognition of old-prefix commits; this is a clean break on a
fresh branch. Where this file and STATES.md disagree, **STATES.md wins**.

STATES.md is authoritative for all 16 states, the 3-layer detection (transport
pre-pass → steering-file precedence → HEAD bucket), the 2-bucket commit
taxonomy, the test/review fix loops, escalation, package close, and the
replay/distribute invariants. The body below is the implementation projection of
that spec; the questions above it are the decisions that change the shape of the
implementation.

## Open Questions

### Drop `xstate` and rewrite `Machine.ts` as a plain pure reducer?

**Recommendation:** **Drop it.** The new machine is a strict first-match-wins
precedence ladder (STATES.md § Precedence) plus two `reduce`-style counters over
the `COMMIT[]` stream — no parallel states, no history states, no spawned
actors, no `always` escalations. The shipped machine only needs `xstate`'s
stepping-actor for the two side-effect gates (`runTestGate`, `reviewPreRender`)
that feed `TEST_RESULT`/`REVIEW_RECORDED` back into the _same_ actor. In the new
design both gates dissolve: Testing exposes the folded `errorCount` +
`capReached` on its result, the edge runs the test, writes
`FEEDBACK.md`/`ERRORS.md` by that count, commits `gtd: errors`, and
**re-gathers** — the test result never has to re-enter the machine. Accept
Review / Clean are edge-only or agent-writes-file, so no pre-render feedback
either. So `resolve(events): Result` becomes a pure function the `main.ts`
driver calls in a loop (perform `edgeAction` → re-gather → re-resolve), and
`xstate` leaves `dependencies`. Net: smaller bundle, simpler mental model, and
the counter folds still live "in the machine" per AGENTS.md. Keep the
`start()/Handle/advance()` _shape_ in `State.ts` only if the driver still
benefits from a long-lived object; otherwise collapse to `resolve()`.

<!-- user answers here -->

### How does the test-fix counter detect the **ERRORS.md-removal** reset boundary?

**Recommendation:** Tag each `COMMIT` event with `removedErrors: boolean` and
fold the `gtd: errors` count to **0** whenever the fold sees `removedErrors`, a
package-start (`gtd: planning` / `gtd: package done`), or `gtd: feedback`. The
human-resume commit is a `gtd: building` (Testing commits the pending ERRORS.md
deletion), which is otherwise indistinguishable from a normal `gtd: building`
and from the interleaved fixer-output `gtd: building`s — so a prefix-only fold
cannot find the reset, and a trailing-run count is wrong (the loop interleaves
`gtd: errors` / `gtd: fixing` / `gtd: building`). The edge therefore needs
per-commit file info: extend the history probe to one
`git log --first-parent --reverse --name-status` pass, zip name-status blocks to
messages, and set `removedErrors` when the commit deletes `ERRORS.md`. The
review-fix counter (`gtd: feedback` since package-start) needs **no** file probe
— it is a clean prefix fold. _(Reason this is high-stakes: it changes the
`COMMIT` event shape and the edge's git probing, and getting it wrong either
re-escalates immediately on resume or never escalates at all.)_

<!-- user answers here -->

### New Feature / Accept Review seed: deterministic edge-built `TODO.md`, and revert vs. checkout?

**Recommendation:** The seed is **deterministic and edge-built** — both states
list `Prompt: none` and New Feature is explicitly "regenerable from the
`gtd: new task` commit", so no agent runs during seeding; the **Grilling** state
(which _does_ have a prompt) develops the seed into a real plan on the next
invocation. Concretely: write `TODO.md` from the captured diff (any embedded
`TODO.md` text verbatim, then the raw diff fenced under a heading as "captured
input"). The two states use **different primitives** — do not unify them:

- **New Feature**: the raw input is _committed_ as `gtd: new task`, so undo it
  with `git revert --no-commit HEAD` (inverse staged into the tree), then write
  the seed `TODO.md`. HEAD stays at `gtd: new task`, tree dirty; next run is
  Grilling, which commits revert+seed as the first `gtd: grilling`.
- **Accept Review**: the human's edits are _uncommitted_, so discard with
  `git checkout -- .` (back to the reviewed baseline — nothing to revert), seed
  `TODO.md` from the review changeset, and `rm REVIEW.md`. Removing REVIEW.md is
  what stops Accept Review re-firing.

No interaction with the test gate (Grilling never tests) and no interaction with
any "commit dirty code first" inference (that whole layer is deleted — see body;
each state commits its own pending tree with its own prefix). Confirm the seed
content shape.

<!-- user answers here -->

### What literally is a `?` marker for the Grilling convergence gate?

**Recommendation:** Keep the shipped unanswered-question placeholder
`<!-- user answers here -->` as the concrete "`?` marker", but **drop** the
`## Open Questions` / `### `-section requirement — a marker may sit anywhere in
`TODO.md`. Convergence (Grilling case 3 → Grilled) = **no marker present AND
clean tree**; case 1 (STOP for answers) = marker present; case 2 (iterate) = no
marker but pending changes. A literal `?` character is unusable (matches every
prose question mark); an HTML-comment token is unambiguous, survives the
code-fence stripping already in `Events.ts`, and matches the existing
`answer questions inline in TODO.md` convention (global memory). The Grilling
prompt instructs the agent to leave one placeholder per open question and to
write the sentinel "no open questions — run gtd to plan" when converged. _(Gate
is load-bearing: it decides STOP-for-human vs. auto-advance-to-build.)_

<!-- user answers here -->

### `gtd: transport` producer — CLI subcommand surface, and does it push?

**Recommendation:** Add a `gtd transport` subcommand alongside `format` in
`main.ts` (the only two non-default commands). It does **`git add -A` +
`git commit -m "gtd: transport"`** and **nothing else — no push**. Pushing is a
separate, explicit user/agent step ("commit it, push, reset on the far side" in
STATES.md § Detection are three operations, not one); baking a network push into
the command is surprising and untestable in the e2e harness. The **Transport
state** (precedence 0) does the far-side half: `git reset HEAD~1` (mixed reset,
keeping changes in the tree) then re-derive from scratch — no prompt. So the
machine never _produces_ `gtd: transport`; it only _consumes_ it.

<!-- user answers here -->

### Caps as config or hardcoded, and keep the `agenticReview` kill-switch?

**Recommendation:** Make both **config**, keep the kill-switch. Replace the
hardcoded `MAX_VERIFY_ITERATIONS` with `fixAttemptCap` (default 3) and reuse the
existing `agenticReviewMaxCycles` as `reviewThreshold` (default 3); keep
`testCommand` and the `agenticReview` boolean (default true). When
`agenticReview` is false, Agentic Review immediately force-approves (writes
empty `FEEDBACK.md`, skips the review) — same path as hitting `reviewThreshold`.
Drop `MAX_NO_AGENT_HOPS` entirely (no no-agent hop loop in the new design). Keep
the cosmiconfig walk-up/merge and the `models` tiers unchanged except for the
state-name remap (see the models question).

<!-- user answers here -->

### `.gtd/` package shape — keep `NN-name/` task dirs, and drop `COMMIT_MSG.md`?

**Recommendation:** Keep `NN-name/NN-task.md` ordered dirs as the package unit;
**delete `COMMIT_MSG.md` entirely.** In the new design the package commit is
always `gtd: building` (Testing commits it), so there is no per-package subject
to store, and the awaiting-review signal is the HEAD bucket (`.gtd` clean + HEAD
`gtd: building` → Agentic Review), not a sentinel file. Building selects the
lowest-numbered dir; Close package `git rm -r`s that dir (plus the now-empty
`.gtd/` when it was the last). This removes `hasCommitMsg`, `isTaskFile`'s
`COMMIT_MSG.md` exclusion, the `removeLastPackage` / `approveSpecReview` dance,
and the COMMIT_MSG step from the decompose prompt.

<!-- user answers here -->

### Empty `FEEDBACK.md` — zero bytes, or whitespace-only?

**Recommendation:** **Whitespace-only counts as empty** (`!/\S/.test(content)`),
matching the shipped detector and robust to editors appending a trailing
newline. Empty = approval → Close package; any non-whitespace = Fixing. Low
stakes; just confirm.

<!-- user answers here -->

### Default-branch detection for the Clean review base?

**Recommendation:** Reuse the shipped `resolveDefaultBranch` cascade unchanged:
`origin/HEAD` → local `main` → local `master` → none. STATES.md § Clean: feature
branch → merge-base with default; default branch → last commit that deleted
REVIEW.md, else root. Already settled by existing code; keep it. _(See body for
the "last REVIEW.md deletion" base computation, which replaces the shipped
frontier logic.)_

<!-- user answers here -->

### Migration ordering — one branch, and module build order?

**Recommendation:** One hard-cutover branch (already on `states-redesign`), not
a staged compat path. Build order so each layer compiles against the next:

1. `Machine.ts` pure `resolve()` + unit tests (the 16-state ladder + 2 counter
   folds) — the spec made executable, no IO.
2. `Git.ts` primitives (merge-base already there; add `revert --no-commit`,
   `lastDeletionOf(path)`, name-status history, package-dir delete, mixed-reset)
   - `Git.test.ts`.
3. `Events.ts` edge: build `COMMIT[]` (with `removedErrors`) + `RESOLVE` in the
   new payload shape; seed/transport/empty-FEEDBACK probes + `Events.test.ts`.
4. `Prompt.ts` + new `src/prompts/*` + `Prompt.test.ts`.
5. `Config.ts` (caps + model-state remap), `main.ts` driver + `gtd transport`,
   `State.ts`.
6. `tests/integration` rewrite (cucumber features per the 16 states).
7. `README.md` / `SKILL.md` / `example.md` rewrite.

Consider dogfooding by decomposing this into `.gtd/` packages along these
boundaries once the questions resolve. Confirm the order / whether to dogfood.

<!-- user answers here -->

### Which new states are subagent-spawning (`{{MODEL}}`), and keep per-state model overrides?

**Recommendation:** Remap `ModelState` from the old leaf names to the new agent
states: **planning tier** = `grilling`, `decompose` (Grilled+Planning),
`agentic-review`, `clean` (REVIEW authoring); **execution tier** = `building`,
`fixing`. Keep the `models.planning` / `models.execution` tiers and
`models.states.*` per-state overrides (rejecting unknown keys), just over the
new key set. Edge-only / human-gate states (New Feature, Transport, Testing,
Escalate, Await Review, Accept Review, Done, Close package, Idle) carry no
`{{MODEL}}`.

<!-- user answers here -->

## Plan body

### State → action → commit-prefix map (the spec, tabulated)

Every `gtd:` subject the new machine reads or writes (boundary bucket =
non-`gtd:` or `gtd: done`; everything else is mid-phase):

| State                                  | Deterministic action                                         | Commit(s) written                        | Advance                            |
| -------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- | ---------------------------------- |
| Transport                              | `git reset HEAD~1` (mixed), re-derive                        | —                                        | re-derive                          |
| New Feature                            | capture raw input; `revert --no-commit HEAD`; seed `TODO.md` | `gtd: new task`                          | auto (edge-only)                   |
| Grilling — open marker                 | commit pending                                               | `gtd: grilling`                          | **STOP** (human)                   |
| Grilling — adjustment                  | commit pending                                               | `gtd: grilling`                          | auto (agent iterate)               |
| Grilled                                | commit pending                                               | `gtd: grilled`                           | auto (prompt: decompose)           |
| Planning                               | commit `.gtd` edits                                          | `gtd: planning`                          | auto (prompt: continue/none)       |
| Building                               | select first package                                         | —                                        | auto (prompt: subagents build)     |
| Testing                                | commit pending; run test; on red write FEEDBACK/ERRORS       | `gtd: building` then (red) `gtd: errors` | auto / **STOP** at cap             |
| Fixing — test FEEDBACK (committed)     | commit FEEDBACK removal                                      | `gtd: fixing`                            | auto (prompt: fixer)               |
| Fixing — review FEEDBACK (uncommitted) | commit FEEDBACK removal                                      | `gtd: feedback`                          | auto (prompt: fixer)               |
| Escalate                               | none (ERRORS.md already committed)                           | —                                        | **STOP** (human gate)              |
| Agentic Review                         | (force-approve writes empty FEEDBACK)                        | —                                        | auto (prompt: review→FEEDBACK)     |
| Close package                          | rm empty FEEDBACK + first pkg dir (+ empty `.gtd/`)          | `gtd: package done`                      | auto                               |
| Clean                                  | compute review base                                          | —                                        | not-auto (prompt: write REVIEW.md) |
| Await Review                           | commit REVIEW.md                                             | `gtd: awaiting review`                   | **STOP** (human)                   |
| Accept Review                          | seed `TODO.md`; `checkout -- .`; rm REVIEW.md                | —                                        | auto (edge-only)                   |
| Done                                   | rm REVIEW.md                                                 | `gtd: done`                              | terminal                           |
| Idle                                   | none                                                         | —                                        | nothing-to-do                      |

Testing can emit **two** commits in one invocation (`gtd: building` for the
landed code, then `gtd: errors` for the failure record). Escalate writes no
commit — the ERRORS.md was committed by the `gtd: errors` that hit the cap.

### Commit-prefix cutover — flat `gtd: <phase>`, no trailers

| shipped                                                                              | new                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `plan(gtd): grilling`                                                                | `gtd: grilling`                                                     |
| `plan(gtd): ready complete`                                                          | `gtd: grilled`                                                      |
| `plan(gtd): decompose …`                                                             | `gtd: planning`                                                     |
| `chore(gtd): commit work package` / `commit pending changes`                         | `gtd: building`                                                     |
| `fix(gtd): apply test fix` + `Gtd-Test-Fix:` trailer                                 | `gtd: errors` (failure record) + `gtd: fixing` (consume)            |
| `fix(gtd): apply spec review fix` + `Gtd-Spec-Review:` trailer                       | `gtd: feedback` (consume of agentic FEEDBACK)                       |
| `chore(gtd): approve spec review`                                                    | folded into `gtd: package done`                                     |
| `review(gtd): create review for …`                                                   | `gtd: awaiting review`                                              |
| `chore(gtd): record raw feedback` / `close approved review` / `synthesize TODO.md …` | seed (no commit; folds into first `gtd: grilling`) / `gtd: done`    |
| — (new)                                                                              | `gtd: new task`, `gtd: transport`, `gtd: package done`, `gtd: done` |

Counters fold from prefixes + the `removedErrors` flag + history boundaries — no
trailers (`Gtd-Test-Fix:` / `Gtd-Spec-Review:` / `Gtd-Agentic-Review:` all
gone).

### The `resolve()` precedence ladder (replaces the 18-state actor)

`resolve(events)` folds `COMMIT[]` into the two counters + sticky facts, then
runs STATES.md § Precedence as a first-match-wins chain on the `RESOLVE`
payload:

0. HEAD `gtd: transport` → **Transport** (edge mixed-resets, re-derives).
1. `ERRORS.md` present → **Escalate** (STOP).
2. `FEEDBACK.md` present → non-empty → **Fixing**; empty → **Close package**.
3. `.gtd` present → build lifecycle, routed by tree + HEAD:
   - `.gtd` modified (package files added/edited) → **Planning**
   - code changes present → **Testing**
   - clean + HEAD `gtd: fixing` (no-op fixer) → **Testing** (re-test)
   - else clean by HEAD: `planning` / `package done` → **Building**; `building`
     → **Agentic Review**
4. `REVIEW.md` present → review lifecycle: uncommitted → **Await Review** commit
   path; committed+clean → **Done**; committed+dirty → **Accept Review**.
5. Boundary HEAD + pending changes (code and/or uncommitted `TODO.md`, no
   `.gtd`/REVIEW/FEEDBACK), **or** HEAD `gtd: new task` + clean tree → **New
   Feature**.
6. `TODO.md` present → **Grilling** (marker/pending) / **Grilled** (clean, no
   marker).
7. Boundary / `package done` HEAD + clean tree → **Clean** (base..HEAD
   non-empty) or **Idle** (HEAD `gtd: done`, nothing to review).

No match → **corruption hard-error** (replaces the old `stuck`/`capReached`
no-progress escalations). Enforce the § Illegal-combinations set (REVIEW+`.gtd`,
REVIEW+TODO, FEEDBACK+REVIEW, FEEDBACK without `.gtd`, ERRORS+FEEDBACK, ERRORS
without `.gtd`) as explicit hard-errors before the ladder.

State is folded from **first-parent** history only (single writer, linear
branch). A merge commit at HEAD is unsupported (breaks the folds) — document, do
not try to handle.

### Counter folds (from prefixes + `removedErrors`, not trailers)

- **Test-fix count** = number of `gtd: errors` since the most recent of
  {`gtd: planning`, `gtd: package done`, `gtd: feedback`, commit with
  `removedErrors`}, walking _through_ any non-gtd and `gtd: building` /
  `gtd: fixing` commits. `< fixAttemptCap` → Testing writes `FEEDBACK.md`;
  `>= cap` → writes `ERRORS.md`. (Both commit `gtd: errors`.)
- **Review-fix count** = number of `gtd: feedback` since {`gtd: planning`,
  `gtd: package done`}. `>= reviewThreshold` → Agentic Review force-approves
  (empty `FEEDBACK.md`, skip review). Pure prefix fold.

Per AGENTS.md, fold both _in the machine_ from `COMMIT` flags (`isErrors`,
`isFeedback`, `isPackageStart`, `removedErrors`), mirroring the old
verify-counter fold; the edge stays thin.

### Throw away (no backcompat)

- **All 18 shipped leaf states** in `Machine.ts` → the 16 in STATES.md.
- **`xstate`** + the stepping actor, `Handle`/`advance`, `runTestGate` /
  `reviewPreRender` gates, `REVIEW_RECORDED` / `TEST_RESULT` feedback events,
  `MAX_NO_AGENT_HOPS` / `noAgentHops` / `lastAdvancedLeaf` / all `stuck*`
  guards, `capReached`/`noAgentCapReached`.
- **`PendingCommitIntent` + the whole commit-intent inference layer**
  (`deriveCommitMessage`, `CommitMessageInputs`, the intent guards,
  `commitPending` `intent`/`removeLastPackage`/`restorePaths` plumbing) — each
  state now commits its own pending tree with a fixed prefix; no separate
  "commit dirty code first" pre-step and no content-derived subject derivation.
- **REVIEW.md checkboxes** (`- [ ]`, `computeReviewHasUncheckedBoxes`,
  `reviewHasUncheckedBoxes`, `reviewHasRealFeedback`, `review-incomplete`,
  `close-review`, the tick-vs-feedback split) → replaced by human-edited-or-not
  (Accept Review / Done) on a committed REVIEW.md.
- **`## Open Questions` / `## Resolved` section parsing** → marker-anywhere
  detection (see the `?`-marker question).
- **spec-review / spec-fix / `COMMIT_MSG.md` / `approveSpecReview` /
  `recordAndRevertReview`** → Agentic Review with empty-FEEDBACK approval;
  package dirs are the awaiting-review signal via HEAD bucket.
- **`Gtd-Test-Fix:` / `Gtd-Spec-Review:` / `Gtd-Agentic-Review:` trailers**,
  `parsePlanPhase`, `computeReviewBase` frontier logic, the
  `plan|review|chore(gtd):` workflow-subject regexes → flat `gtd:` taxonomy.
- **Old prompts**: `await-answers`, `decompose`(rewrite), `execute`(→building),
  `fix-tests`(→fixing), `human-review`(→clean), `modified-todo`, `new-todo`,
  `review-incomplete`, `review-process`, `spec-fix`(→fixing), `spec-review`
  (→agentic-review), `verified`(→idle). Keep `header.md` +
  `partials/auto-advance.md`.
- **Old features**: every `spec-*`, `review-frontier`, `execute-gate`,
  `verify-loop`, `test-gate`, `commit-intent`, `edge-loop`, `branches`,
  `review`, `auto-advance` cucumber feature → rewrite to the new states.

### Modules to rewrite

- **src/Machine.ts** — drop `xstate`; export pure `resolve(events): Result` (the
  ladder above) + the two counter folds. `Result` carries: `state` (16-state
  union), `autoAdvance`, optional `edgeAction` (`transportReset` |
  `seedNewFeature` | `seedAcceptReview` | `runTest` (with
  `errorCount`,`capReached`) | `commitPending`(prefix) | `closePackage` |
  `commitReview` | `done`), and the prompt context (packages, diffs, base ref,
  grilling sub-case, review-fix/test-fix counts). No IO.
- **src/Events.ts** — edge IO. Build `COMMIT[]` over first-parent history with
  `{ isErrors, isFeedback, isPackageStart, isWorkflowCommit, removedErrors }`
  (one extra `git log --name-status` pass to set `removedErrors`). `RESOLVE`
  payload in the new shape: steering-file presence (TODO/REVIEW/FEEDBACK/ERRORS/
  `.gtd`), committed-vs-uncommitted FEEDBACK + empty-FEEDBACK, REVIEW
  committed-vs-dirty, `.gtd`-modified-vs-clean, todo marker presence, pending
  ERRORS.md deletion, HEAD bucket, review base. Delete `parsePlanPhase`,
  `hasOpenQuestions` section logic (→ marker probe), the checkbox/realFeedback
  probes, the whole `commitIntent` block, `countTrailing` (replaced by the
  machine folds).
- **src/Git.ts** — add: `revertNoCommit("HEAD")`, `mixedResetHead()`,
  `checkoutAll()`, `lastDeletionOf(path)`
  (`git log --first-parent --diff-filter=D --format=%H -- <path>` — used for the
  Clean base **and** as the source of the `removedErrors` flag),
  `commitHistory(base?)` returning `{message, removedErrors}` per first-parent
  commit, `removePackageDir(dir)` + empty-`.gtd/` cleanup,
  `commitAllWithPrefix(prefix)`. Keep `mergeBase`, `resolveDefaultBranch`,
  `statusPorcelain`, `diffHead`, `diffRef`, `hasCommits`. Delete
  `recordAndRevertReview`, `approveSpecReview`, `closeReview`,
  `diffRefExcludingGtd`, `lastReviewCommit`, `lastCloseCommit`, the intent-aware
  `commitPending`.
- **src/Prompt.ts + src/prompts/** — one section per agent/human-facing state.
  New/rewritten files: `grilling.md` (ask-questions + STOP-for-answers tail +
  iterate tail), `decompose.md` (Grilled+Planning, no COMMIT_MSG step),
  `building.md` (ex-`execute`, subagents build first package, leave
  uncommitted), `fixing.md` (ex-`fix-tests`+`spec-fix`, reads FEEDBACK.md, one
  fix, leave uncommitted), `agentic-review.md` (ex-`spec-review`, review pkg
  diff → empty/ content FEEDBACK), `clean.md` (ex-`human-review`, write
  REVIEW.md for base..HEAD), `await-review.md` (STOP, review via REVIEW.md),
  `escalate.md` (surface ERRORS.md, STOP), `idle.md` (nothing to do). New
  Feature / Transport / Accept Review / Close package / Done emit no agent
  prompt.
- **src/Config.ts** — `fixAttemptCap` (default 3) + `reviewThreshold`
  (rename/keep `agenticReviewMaxCycles`, default 3) + keep `agenticReview`,
  `testCommand`, `models`. Remap `ModelState`/`stateTier` to the new state
  names.
- **src/main.ts / src/State.ts** — driver loop over `resolve()` + `edgeAction`
  (perform → re-gather → re-resolve until a prompt-bearing or STOP state). Add
  the `gtd transport` subcommand next to `format`. Collapse `State.ts` to a thin
  `detect()` if `Handle` is dropped.
- **README.md / SKILL.md / example.md** — full rewrite to the 16-state machine,
  flat taxonomy, `gtd transport`, steering-file model. Per global instruction,
  reflect every significant change here in the README.

### Tests (AGENTS.md: cucumber per feature, small composable Given steps)

Rewrite `tests/integration/features` to the 16 states. New Given steps will need
flat-`gtd:` commit builders (replace the `fix(gtd)` + `Gtd-Test-Fix:` trailer
steps; drop the `COMMIT_MSG.md` package-dir step → plain task-file dirs) and a
"pending `ERRORS.md` deletion" step. Coverage:

- **New Feature**: seed from dirty tree on boundary HEAD; **regenerate after
  checkout** (HEAD `gtd: new task` + clean tree re-seeds); revert leaves
  baseline.
- **Grilling 3-way**: marker present → STOP; no marker + pending → iterate; no
  marker + clean → Grilled.
- **Grilled → Planning → Building**: decompose, `.gtd` modified →
  `gtd: planning`, clean → Building selects lowest package.
- **Testing**: green → Agentic Review; red below cap → `gtd: errors` + Fixing;
  cap → ERRORS.md + Escalate; **reset-on-resume** (rm ERRORS.md → fresh budget);
  **no-op fixer re-test** (clean tree + HEAD `gtd: fixing`).
- **Fixing**: committed FEEDBACK → `gtd: fixing`; uncommitted FEEDBACK →
  `gtd: feedback`.
- **Agentic Review**: empty FEEDBACK → Close package; content → Fixing; pending
  (no FEEDBACK yet) → re-review (never skipped); threshold → force-approve;
  `agenticReview:false` → force-approve.
- **Close package**: one `gtd: package done` per package; last package also rm
  `.gtd/`.
- **Clean → Await → Accept(seed)/Done → Idle**; coworker/feature-branch review
  entry (merge-base base); default-branch base = last REVIEW.md deletion.
- **Replay**: checkout any committed point resumes deterministically.
- **Illegal-combo hard-error**; **Transport reset**.

Delete the spec-\*/checkbox/verify-loop/commit-intent/branches features.

## Resolved
