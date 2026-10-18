# 01 — Unbuildable refactor-review note refuses

## Requirement

**Concern 1.** A refactor-review round carrying an `edit` note or a code
hand-edit whose collecting turn writes no `.gtd/REFACTOR.md` and changes nothing
**must never sign off silently — it refuses the collecting landing**. The
refusal names every left-out note and edited path, and says the only way out is
`gtd abandon`, which **throws away the naive pass, the refactor and its
review**. The feature review keeps "change nothing to sign off". A praise-only
or unparsed-note round still signs off.

See `.gtd/ARCHITECTURE.md` — `ReviewPolicy`, `FeedbackTarget`,
`refactorDroppedRefusal`, call stack 1.

## Tasks

### 1. `Requested` and `refusals.dropped` in the workflow kit

Paths: `src/workflow-kit/review.ts`, `src/workflow-kit/review.test.ts`,
`src/workflow-kit/index.ts`

- [ ] `Requested` exported from `@pmelab/gtd/workflow-kit`;
      `ReviewPolicy.refusals.dropped?` added, additive only
- [ ] `collect(p, capture, requested?)` refuses with `dropped(requested)` only
      when: no `feedback` file written, nothing changed, `dropped` set,
      `requested` holds at least one note or path
- [ ] `routeNotes`' edits branch passes `{ notes: edits, paths: [] }`;
      `finish`'s hand-edit branch passes
      `{ notes: reviewNotes(baselineText, record), paths: edited.map((c) => c.path) }`;
      unparsed-notes branch passes nothing
- [ ] No new step and no new step name; the refusal refuses the landing
- [ ] Kit unit tests: edit-note round refuses; hand-edit round refuses with
      paths; praise-only and unparsed-note rounds sign off; no `dropped` signs
      off as today

### 2. `refactorDroppedRefusal` text

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] Message starts `gtd land: refactor-feedback:`, lists each note as
      `note-<n> (<anchor>): <text>` and each hand-edited path
- [ ] Names `gtd abandon` and says the naive pass, the refactor and its review
      are thrown away

### 3. Wire through `FeedbackTarget` and `reviewedRefactor`

Paths: `src/workflows/feature/review.ts`,
`src/workflows/feature/review.test.ts`, `src/workflows/feature/refactor.ts`,
`src/workflows/feature/refactor.test.ts`

- [ ] `FeedbackTarget.dropped?` passed through as `refusals.dropped`; feature
      review's default target sets none
- [ ] `reviewedRefactor` sets `feedback.dropped = t.refactorDroppedRefusal`
- [ ] Unit: feature review edit-note round collected to nothing signs off
- [ ] Unit: refactor edit-note round whose collecting turn writes nothing is
      refused naming the note, never a `signoff`

### 4. Scenarios

Paths: `src/workflows/feature/refactor-review.feature`

- [ ] Left-out `edit` note refuses the collecting landing with
      "refactor-feedback", naming the note and `gtd abandon`; never signs off
- [ ] Left-out code hand-edit refuses the same way, naming the edited path
- [ ] Praise-only refactor round still signs off and the feature slice follows

### 5. Docs

Paths: `docs/configuration.md`

- [ ] Refactor-review paragraph rewritten: an unbuildable note refuses the
      collecting landing; the only way out is `gtd abandon`, which throws away
      the naive pass, the refactor and its review

## Tests

- unit: `src/workflow-kit/review.test.ts`
- unit: `src/workflows/feature/review.test.ts`
- unit: `src/workflows/shared/text.test.ts`
- unit: `src/workflows/feature/refactor.test.ts`
- e2e: `src/workflows/feature/refactor-review.feature`
