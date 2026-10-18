# 02 — A settled refactor round with an unfolded change refuses

**Concern 2 alone** — centres on `src/workflow-kit/review.ts`'s `finish`.
Contract: `.gtd/ARCHITECTURE.md` "Changed contract of `review`".

**Risk: this package calls `collect` with today's one-argument
`p.collecting(capture)`** — package 03 adds the `CollectRound` argument to every
call, this one included. Keep the call shape identical to the others so 03
changes it mechanically.

## Requirements

### 2. Settled round refuses an unfolded change note or hand-edit

- **Applies only when the round is `settled`, not `folded`, and
  `refusals.dropped` is set.** Without `refusals.dropped` (feature review) the
  settled branch is unchanged: signs off unjudged, no triage.
- **Notes = `reviewNotes(review@reviewed, review now)`; edited = code hand-edits
  since `reviewed`.**
- **Notes non-empty → `triage(notes)`; change notes = verdict `edit`, `nit` or
  `defer`.**
- **No change note and no hand-edit → sign off, as today** (praise, questions,
  thread replies only).
- **Else close, then `collect`:** edited non-empty → `captures.edits(round)`;
  otherwise `captures.editNotes(round, changeNotes, undefined)`.
  `requested = { notes: changeNotes, paths: edited }`, so an empty collecting
  turn refuses through `refusals.dropped`; a turn that writes the feedback file
  turns the round into `feedback`.
- A note the in-gate turn deleted unfolded is not detected (out of scope).

## Tasks

### Task 1: Settled-branch triage and collect

Paths: `src/workflow-kit/review.ts`, `src/workflow-kit/review.test.ts`

- [ ] Settled ∧ ¬folded ∧ `refusals.dropped`: compute notes and edited paths
      since `reviewed`, triage notes, collect or sign off per the contract
- [ ] Test: settled, `dropped` set, `edit`-judged note since `reviewed`, empty
      collecting turn → refuses with `dropped`, `requested.notes` names the note
- [ ] Test: settled, `dropped` set, code hand-edit since `reviewed` →
      `requested.paths` names the path
- [ ] Test: settled, `dropped` set, closed collecting turn writes the feedback
      file → `feedback`, no refusal
- [ ] Test: settled, `dropped` set, only praise/question notes or only thread
      replies → signs off
- [ ] Test: settled without `dropped`, an `edit` note → signs off unjudged, no
      triage call

### Task 2: E2E scenarios

Paths: `src/workflows/feature/refactor-review.feature`

- [ ] Scenario: line note asking for a change plus a `- H:` thread question;
      in-gate collecting turn only replies; human lands only a concluding thread
      reply; closed collecting turn writes nothing → `gtd land` refuses with
      `refactor-feedback`, naming the note and `gtd abandon`
- [ ] Scenario: same round, human's code hand-edit precedes the thread → refusal
      names `hand-edited <path>`
- [ ] Scenario: praise line note plus a concluded thread on a settled round
      signs off; the feature slice follows
- [ ] All tagged `@inmem`

### Task 3: Docs

Paths: `docs/configuration.md`

- [ ] Refactor-review section: a settled round with an unfolded change note or
      hand-edit refuses (`refactor-feedback`), naming notes judged `edit`, `nit`
      or `defer` and hand-edited paths

## Tests

- unit: `src/workflow-kit/review.test.ts`
- e2e: `src/workflows/feature/refactor-review.feature`
