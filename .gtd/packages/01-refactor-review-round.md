# 01 — Refactor review round

Concerns 1, 2, 3. Interfaces and call stacks: `.gtd/ARCHITECTURE.md`
(`Requested`, `buildReviewCollectingPrompt`, `refactorCollecting`).

## Requirements

### 1. Refactor collecting turn may reply in `.gtd/REVIEW.md` threads

**The refactor collecting prompt forbids replying in `.gtd/REVIEW.md`, but the
review kit's in-gate conversation calls that same turn while the file is open
and then requires an `- A:` reply.** Any `- H:` thread at the refactor review
gate therefore refuses the turn.

- Allow exactly one `- A:` reply per waiting thread; drop the "already closed,
  do not reply" line for the in-gate turn
- Keep the end-of-round case: the file is closed before collecting, and a reply
  must not recreate it
- A reply-only turn must not trip the `refactor-feedback` "unmatched" refusal
- A concluded thread folds into `.gtd/REFACTOR.md` only when it asks for a
  change; otherwise the turn just deletes it
- The in-gate turn leaves one-shot footnotes and notes untouched: the round's
  triage judges them

### 2. Footnotes are judged like line notes; an `edit` footnote left undone refuses

**Today a round carrying only footnotes reaches the no-line-notes path with
nothing marked as requested, so a collecting turn that writes nothing silently
signs off.** Footnotes go through the same triage judge as line notes.

- **Kit-wide fix: the settled check strips only THREAD footnotes**; one-shot
  footnotes count as notes and reach `triage`, one question per footnote, anchor
  included
- **Praise and question footnotes sign off, exactly as line notes do**
- A footnote judged `edit` joins `Requested.notes`; a collecting turn that
  writes no `.gtd/REFACTOR.md` for it refuses with `refactor-feedback`, naming
  its anchor line
- `reviewToHandOff` uses the same rule: a footnote-only edit hands off, never
  closes as a sign-off
- The feature review still gets no `dropped` refusal

### 3. The `dropped` refusal lists edit notes only

**On a hand-edit round the refusal lists every note of the round, praise and
questions included.** It must name only what asked for a change.

- Hand-edit path runs no triage: `finish` passes `{ notes: [], paths }` — the
  refusal names edited paths only
- Notes-only path passes the notes judged `edit`, footnotes included

## Tasks

### Task 1: Kit settles on thread footnotes only; hand-edit passes no notes

Paths: `src/workflow-kit/review.ts`, `src/workflow-kit/review.test.ts`

- [ ] `notesOf` / settled check strips thread footnotes (definition plus
      markers) only; one-shot footnotes route to `triage`
- [ ] `reviewToHandOff`: footnote-only edit hands off
- [ ] `finish` hand-edit path calls `collectWith(…, { notes: [], paths })`
- [ ] `Requested.notes` doc comment updated
- [ ] Unit tests below in `review.test.ts` pass

### Task 2: In-gate vs closed refactor collecting prompt

Paths: `src/workflows/shared/text.ts`, `src/workflows/feature/steps.ts`,
`src/workflows/feature/steps.test.ts`, `src/workflows/feature/refactor.test.ts`

- [ ] `buildReviewCollectingPrompt` takes `refactor.open`; open variant asks for
      exactly one `- A:` per waiting thread, folds a concluded thread into
      `.gtd/REFACTOR.md` only when it asks for a change, leaves one-shot
      footnotes and notes untouched, runs `gtd check review .gtd/REVIEW.md`, and
      lacks "already closed"
- [ ] Closed variant renders as today (do not recreate, do not reply)
- [ ] `refactorCollecting` sets `open` from `read(REVIEW) !== undefined` at
      prompt time; signature unchanged
- [ ] Feature `collecting` prompt matches pinned `feature-collecting-prompt.txt`

### Task 3: Scenarios in `refactor-review.feature`

Paths: `src/workflows/feature/refactor-review.feature` (plus its step
definitions only if a generic step is missing)

- [ ] `@inmem`: `- H:` thread question at the refactor gate gets one `- A:`
      reply from `refactor.build.review.collecting`, no `.gtd/REFACTOR.md`,
      rests at `refactor.build.review.await-review` again
- [ ] `@inmem`: after that reply, a no-change landing signs off the refactor and
      the feature slice follows; no `refactor-feedback` refusal
- [ ] `@inmem`: praise-only one-shot footnote round, judged `praise`, signs off
      and the feature slice follows
- [ ] `@inmem`: one-shot footnote judged `edit`, collecting writes no
      `.gtd/REFACTOR.md` → `refactor-feedback` refusal naming the footnote's
      anchor line
- [ ] `@inmem`: one-shot footnote landed after an in-gate thread reply is judged
      at `refactor.build.review.triage`, not signed off unjudged
- [ ] Existing hand-edit refusal scenario: praise line note on a hand-edit round
      → refusal names the edited path only, never the note

### Task 4: Docs

Paths: `docs/configuration.md`

- [ ] Naive-pass refusal paragraph: hand-edit refusal names edited paths; the
      notes-only refusal names the `edit` notes, footnotes included, never
      praise or questions (replaces "naming every left-out note")
- [ ] In-gate threads at the refactor review get a reply; footnotes are judged
      like line notes
- [ ] No `src/*.ts` module name in prose

## Tests

- unit: `src/workflow-kit/review.test.ts`
- unit: `src/workflows/feature/refactor.test.ts`
- unit: `src/workflows/feature/steps.test.ts`
- e2e: `src/workflows/feature/refactor-review.feature`

Test cases:

- [ ] review.test: one-shot footnote added after an in-gate collecting turn
      routes through `triage`, not the settled sign-off
- [ ] review.test: only a thread reply after an in-gate collecting turn still
      settles
- [ ] review.test: hand-edit round with notes → `refusals.dropped` gets
      `notes: []` and the edited paths
- [ ] review.test: notes-only round → `refusals.dropped` gets only notes judged
      `edit`, footnotes included
- [ ] review.test: `reviewToHandOff` with a footnote-only edit hands off
- [ ] refactor.test: in-gate collecting prompt asks for one `- A:` per waiting
      thread, says leave one-shot footnotes and notes untouched, lacks "already
      closed"
- [ ] refactor.test: end-of-round collecting prompt still says closed, must not
      be recreated
- [ ] steps.test: feature `collecting` prompt unchanged (pinned fixture
      `feature-collecting-prompt.txt`)
- [ ] steps.test: `refactorCollecting` renders open variant when
      `.gtd/REVIEW.md` present, closed when absent
