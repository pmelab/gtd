# Task: Rewrite `src/Machine.ts` as the pure 16-state resolver

Replace the xstate actor in `src/Machine.ts` with a pure `resolve(events)`
reducer implementing the STATES.md precedence ladder + the two counter folds.
**No IO, no `xstate`.** This module **owns the shared contract** that the
sibling cutover tasks (Events, Prompt, main/driver, e2e) build against — keep the
type names and shapes below exact.

This package is the **atomic runtime cutover**: this file, `src/Events.ts`,
`src/Prompt.ts`, `src/main.ts`/`src/State.ts`, the dead-code cleanup, and the
e2e rewrite all land together. The tree may be red mid-package; it must be green
(`npm run test && npm run test:e2e`) when the package completes. The gtd loop
will iterate fixes until green.

Spec pointers (authoritative): `STATES.md` § Detection model, § Precedence, §
Illegal combinations, § States (all 16); `TODO.md` → "The `resolve()` precedence
ladder", "Counter folds", "Throw away (no backcompat)", "Modules to rewrite →
src/Machine.ts".

## Shared contract (all cutover tasks must match exactly)

**State ids** (`Result.state`, 16):
`"transport" | "new-feature" | "grilling" | "grilled" | "planning" | "building"
| "testing" | "fixing" | "escalate" | "agentic-review" | "close-package" |
"clean" | "await-review" | "accept-review" | "done" | "idle"`.

**Runtime commit subjects** (flat; written by edge actions, read by folds):
`gtd: transport | new task | grilling | grilled | planning | building | errors |
fixing | feedback | package done | awaiting review | done`.
Boundary bucket = subject NOT starting `"gtd: "`, **or** exactly `"gtd: done"`.
Any other `"gtd: …"` = mid-phase.

**`GtdEvent`:**
```
| { type: "COMMIT"; isErrors; isFeedback; isPackageStart; isWorkflowCommit; removedErrors }  // all boolean
| { type: "RESOLVE"; payload: ResolvePayload }
```
No `TEST_RESULT` / `REVIEW_RECORDED` events — the edge never re-enters the
machine (test result is handled at the edge; see Events task). COMMIT flag
meanings (set by the edge): `isErrors`=subject is `gtd: errors`;
`isFeedback`=`gtd: feedback`; `isPackageStart`=`gtd: planning` OR
`gtd: package done`; `isWorkflowCommit`=subject starts `gtd: `;
`removedErrors`=that commit's diff deleted `ERRORS.md`.

**`GtdPackageFact`** = `{ name: string; tasks: readonly string[]; taskContents:
readonly { name; content }[] }`. **Drop `hasCommitMsg`** entirely.

**`ResolvePayload`** (working-tree snapshot; presence + dirtiness; NO counts):
`todoExists, gtdDirExists, reviewPresent, feedbackPresent, errorsPresent: boolean`;
`gtdModified` (.gtd package files added/edited vs committed), `codeDirty`
(pending changes outside the steering set TODO/REVIEW/FEEDBACK/ERRORS/.gtd),
`todoMarkerPresent` (`<!-- user answers here -->` anywhere in TODO.md after
code-fence strip), `feedbackCommitted`, `feedbackEmpty` (whitespace-only
`!/\S/`), `reviewCommitted` (committed + clean), `reviewDirty` (REVIEW present
with pending edits or other pending changes alongside a committed REVIEW),
`pendingErrorsDeletion` (working tree deletes a committed ERRORS.md), all
boolean; `lastCommitSubject: string`; `workingTreeClean: boolean`; `packages:
readonly GtdPackageFact[]`; `diff: string` (git diff HEAD incl. untracked, for
prompt context); `reviewBase?: string`; `refDiff?: string`;
`agenticReviewEnabled: boolean`; `fixAttemptCap: number`;
`reviewThreshold: number`.

**`Result`:** `{ state; autoAdvance: boolean; edgeAction?: EdgeAction; context }`.
`context` carries what prompts need: `testFixCount`, `reviewFixCount`,
`packages`, `diff`, `refDiff?`, `reviewBase?`, `lastCommitSubject`,
`workingTreeClean`, and `grillingCase?: "stop" | "iterate"` (Grilling
sub-case; the converged case is `state:"grilled"`).

**`EdgeAction`** (driver performs it, then re-gathers + re-resolves until a
prompt-bearing or STOP state):
```
| { kind: "transportReset" }
| { kind: "seedNewFeature" }
| { kind: "seedAcceptReview" }
| { kind: "runTest"; errorCount: number; capReached: boolean }
| { kind: "commitPending"; prefix: string }   // grilling/grilled/planning/fixing/awaiting review
| { kind: "closePackage" }
| { kind: "commitReview" }                     // "gtd: awaiting review"
| { kind: "done" }
```
(Semantics live in the Events/driver tasks; this task just defines the union.)

## Counter folds (over `COMMIT[]`, oldest→newest, in the machine)

- **`testFixCount`** = number of `isErrors` commits since the most recent of
  `{ isPackageStart, isFeedback, removedErrors }`, walking through all other
  commits. `capReached` = `testFixCount >= fixAttemptCap`.
- **`reviewFixCount`** = number of `isFeedback` commits since the most recent
  `isPackageStart`.
Mirror the old verify-counter fold style (accumulate from event flags); the edge
stays thin. Drop all old counters (`verifyIterations`, `noAgentHops`,
`specReviewIterations`, `planEverGrilled`, etc.).

## Precedence ladder (first match wins) — implement exactly

First enforce the **illegal-combination hard-errors** (throw): REVIEW+`.gtd`,
REVIEW+TODO, FEEDBACK+REVIEW, FEEDBACK without `.gtd`, ERRORS+FEEDBACK, ERRORS
without `.gtd`. Then:

0. HEAD `gtd: transport` → **transport** (`transportReset`, auto).
1. `errorsPresent` → **escalate** (STOP, no edgeAction).
2. `feedbackPresent` → non-empty → **fixing**; empty → **close-package**
   (`closePackage`).
3. `.gtd` present → build lifecycle by tree + HEAD:
   - `gtdModified` → **planning** (`commitPending "gtd: planning"`)
   - `codeDirty` → **testing** (`runTest`)
   - clean + HEAD `gtd: fixing` (no-op fixer) → **testing** (`runTest`)
   - else clean by HEAD: `gtd: planning`/`gtd: package done` → **building**;
     `gtd: building` → **agentic-review**
   - `pendingErrorsDeletion` (committed ERRORS.md deleted in tree) → **testing**
     (human resume → fresh budget)
4. `reviewPresent` → uncommitted → **await-review** (`commitReview`);
   committed+clean → **done** (`done`); committed+dirty → **accept-review**
   (`seedAcceptReview`).
5. Boundary HEAD + pending changes (code and/or uncommitted TODO.md, no
   `.gtd`/REVIEW/FEEDBACK), **or** HEAD `gtd: new task` + clean tree →
   **new-feature** (`seedNewFeature`).
6. `todoExists` → **grilling** (marker present → `grillingCase:"stop"` STOP;
   no marker + pending → `grillingCase:"iterate"`; no marker + clean →
   **grilled**). Grilling/Grilled commit pending with their prefix.
7. Boundary / `gtd: package done` HEAD + clean tree → **clean** (when a review
   base yields a non-empty diff) or **idle** (HEAD `gtd: done`, nothing to
   review).

No match → **corruption hard-error** (throw). Fold from **first-parent** history
only; a merge commit at HEAD is unsupported (document, don't handle).

Map each state's `autoAdvance` + `edgeAction` per the `STATES.md` "Prompt:"
lines and the `TODO.md` state→action table. Edge-only/auto states (transport,
new-feature, accept-review, close-package, done) carry an `edgeAction` and
`autoAdvance:true` and **no** prompt. STOP states (grilling-stop, escalate,
await-review) have `autoAdvance:false`. `idle` has no edgeAction.

## Files

- Rewrite: `src/Machine.ts` (delete the xstate machine + all old exports:
  `start`, `Handle`, `MAX_*`, `PendingCommitIntent`, old `LeafState`,
  `EdgeAction`, the `resolveChain`/guards/actions, etc.). Export `resolve`, the
  16-state union, `GtdEvent`, `ResolvePayload`, `EdgeAction`, `Result`,
  `GtdPackageFact`, and the fold helpers.
- Rewrite: `src/Machine.test.ts` (delete old cases; unit-test the ladder, the
  illegal-combo hard-errors, both counter folds incl. `removedErrors`/cap, and
  the grilling 3-way + edge-only `autoAdvance`/`edgeAction` mapping). Build
  `GtdEvent[]` directly like the existing test's `basePayload`/`commit` helpers.

## Constraints

- Pure: no `effect`, no `xstate`, no fs/git imports. Construct `Result` from
  `events` only.
- `resolve([])` and degenerate inputs must not throw except the documented
  illegal-combination / corruption hard-errors.

## Acceptance criteria

- [ ] `src/Machine.ts` exports a pure `resolve(events): Result` with the exact
      type names/shapes above; no `xstate` import remains.
- [ ] All 16 states + the illegal-combo and no-match hard-errors are reachable
      and unit-tested.
- [ ] `testFixCount` resets on `isPackageStart` / `isFeedback` / `removedErrors`;
      `reviewFixCount` resets on `isPackageStart`; `capReached` uses
      `fixAttemptCap`.
- [ ] Grilling resolves 3 ways (`stop` / `iterate` / → `grilled`).
- [ ] `npm run test` passes; integrates green with the sibling cutover tasks at
      package completion.
