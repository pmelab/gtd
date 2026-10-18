# 03 — Closed collecting turn folds by round kind, drops reply rules

**One package for concerns 3 and 4** — both rewrite the closed variant of
`buildReviewCollectingPrompt` in `src/workflows/shared/text.ts`. Interfaces:
`.gtd/ARCHITECTURE.md` (`CollectRound`, `FeedbackTarget`, `refactorCollecting`,
`buildReviewCollectingPrompt`).

## Requirements

### 3. Closed variant folds what that round left

- **The kit passes the round:
  `ReviewPolicy.collecting(capture, round: CollectRound)`,
  `CollectRound = "reply" | "edits" | "notes" | "triaged"`.** The prompt never
  parses the capture.
- **`open` derives from `round === "reply"`, not from `.gtd/REVIEW.md`'s
  presence.**
- **`"edits"` → fold every hand-edit and every note the human left that round.**
- **`"notes"` → fold each note that asks for a change.**
- `"triaged"` → fold each `edit` note the capture lists, no other note (today's
  text).
- Refactor fence and the "must write `.gtd/REFACTOR.md`" rule unchanged. No
  `refactor` argument → prompt unchanged.

### 4. Closed variant drops the reply rules

- **Closed variants render neither `footnoteFoldIn` nor `codeThreadReplies()`.**
- Open variant and the feature (non-refactor) collecting prompt keep both,
  unchanged.

## Tasks

### Task 1: `CollectRound` through the kit

Paths: `src/workflow-kit/review.ts`, `src/workflow-kit/index.ts`,
`src/workflow-kit/review.test.ts`

- [ ] Export `type CollectRound`; `ReviewPolicy.collecting` takes
      `(capture, round)`
- [ ] Every call passes its round: in-gate `"reply"`, `captures.edits` →
      `"edits"`, `captures.notes` → `"notes"`, `captures.editNotes` →
      `"triaged"` — including package 02's settled-branch call
- [ ] Test: `collecting` receives `"reply"` in the gate, `"edits"` on a
      hand-edit round, `"notes"` on an unparsed-notes round, `"triaged"` after
      triage

### Task 2: Feature-side plumbing

Paths: `src/workflows/feature/review.ts`, `src/workflows/feature/steps.ts`,
`src/workflows/feature/refactor.ts`, `src/workflows/feature/refactor.test.ts`

- [ ] `FeedbackTarget.collecting: (capture, round) => Promise<void>`
- [ ] `refactorCollecting(capture, round, strays)` passes `{ strays, round }`;
      no `.gtd/REVIEW.md` probe
- [ ] `collecting(capture, round)` — round unused
- [ ] Test: in-gate turn renders the open variant, a closed round the closed
      one, decided by the round, not `.gtd/REVIEW.md`'s presence

### Task 3: `buildReviewCollectingPrompt` closed variants

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] `refactor?: { strays; round: CollectRound }` replaces `open: boolean`
- [ ] Closed variants fold per round kind; omit `footnoteFoldIn` and
      `codeThreadReplies`
- [ ] Test: closed `"edits"` says fold every hand-edit and every note the human
      left that round
- [ ] Test: closed `"notes"` says fold each note that asks for a change
- [ ] Test: closed `"triaged"` keeps "each `edit` note the capture lists, no
      other note"; fence and must-write rule present in every closed round
- [ ] Test: every closed round contains neither `footnoteFoldIn`'s text nor the
      code-thread reply text (waiting code thread seeded); open variant and
      feature prompt contain both

### Task 4: E2E scenario

Paths: `src/workflows/feature/refactor-review.feature`

- [ ] Scenario (`@inmem`): hand-edit round with a line note rests at
      `refactor.build.review.collecting`; content says fold every hand-edit and
      every note left that round; holds neither the footnote fold-in rule nor
      the code-thread reply rule

### Task 5: Docs

Paths: `docs/configuration.md`

- [ ] Refactor-review section: the closed collecting turn folds hand-edits and
      unparsed notes

## Tests

- unit: `src/workflow-kit/review.test.ts`
- unit: `src/workflows/feature/refactor.test.ts`
- unit: `src/workflows/shared/text.test.ts`
- e2e: `src/workflows/feature/refactor-review.feature`
