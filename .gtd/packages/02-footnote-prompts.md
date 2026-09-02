# 02 — Agents read a footnote as a comment on its anchor

## Requirement

**A footnote is only worth writing if the agent that receives the file treats it
as a comment about the exact context it is attached to.** Every prompt and gate
message on the feedback path learns the shape:

- `build.review.await-review` — the human's instructions for how to comment on a
  hunk, alongside "a note on a line" and "a code edit"
- `build.review.collecting` — each footnote is a mandatory concern, described
  against its anchor's hunk, never flattened into a whole-file remark
- **Every prompt that folds a footnote in DELETES it in the same turn** — marker
  and definition together — the way a transient hand-written code comment is
  already treated. No lap ever re-reads a footnote that was already acted on
- **No prompt ever tells an agent to WRITE a footnote.** A footnote is human
  input only; an agent replies in `.gtd/REQUIREMENTS.md` prose and never
  annotates a review file
- `design.gate.answer` and `design.triage`'s loop-back read — a footnote in
  `.gtd/REQUIREMENTS.md`, and a footnote in the reverted review-round edit read
  back out of history
- `docs/configuration.md`'s steering-format section and `README.md` — the syntax
  a human types is user-facing, so it is documented; nothing about how the
  parser is built

## Settled decisions this package implements

**A workflow is DATA, not code.** Edit `src/workflows/unified.yaml`; there is no
engine-side wiring to trace. The tests that pin its shape tell you what you
broke.

Two new shared `vars:` entries, because the human-facing and agent-facing text
have different audiences and different content.

## Task 1 — the two shared prompt variables

Path: `src/workflows/unified.yaml`.

- `footnoteRules` — how a human types one, and where the body goes. Injected
  into exactly three human-gate messages: `build.review.await-review`,
  `design.gate.answer`, `architecture.gate.answer`. The two gate messages come
  from the shared question-gate machine's `$message` param, so each instance
  injects the tag in its own `with:` block
- `footnoteFoldIn` — a footnote is a comment about its exact anchor; it is a
  mandatory concern described against that anchor's hunk or paragraph, never
  flattened into a whole-file remark; it is DELETED marker-and-definition-
  together in the turn that folds it in; and it is human input the agent never
  writes. Injected into exactly three agent prompts: `build.review.collecting`,
  `design.triage`, `architecture.author`

**`build.review.reviewing` — the one state that WRITES a review file —
references neither tag.** That is how "no prompt ever tells an agent to write a
footnote" becomes enforceable rather than aspirational.

Acceptance criteria:

- [ ] Both variables are declared in `vars:`, each non-empty
- [ ] Every injection uses the raw (unescaped) tag form, matching how the
      existing voice variables are wired
- [ ] `footnoteRules` renders in the three human-gate messages named above
- [ ] `footnoteFoldIn` renders in the three agent prompts named above
- [ ] The workflow still compiles with no validation errors and no warnings

## Task 2 — pin the wiring in `src/workflows/templates.test.ts`

Path: `src/workflows/templates.test.ts`.

Table-driven by name AND count, matching the existing voice-variable pin
pattern, so a seventh injection site added later fails loudly.

Acceptance criteria:

- [ ] `footnoteRules` is wired into exactly those three human-message states and
      nowhere else — asserted by name and by count
- [ ] `footnoteFoldIn` is wired into exactly those three agent prompts and
      nowhere else — asserted by name and by count
- [ ] `build.review.reviewing`'s compiled content references NEITHER variable
- [ ] `footnoteFoldIn` carries the human-input-only rule and the
      delete-in-the-same-turn rule, checked structurally rather than by exact
      phrasing
- [ ] Every prompt and message value still renders against the bundled `vars:`
      defaults with no leaked `undefined`

## Task 3 — grade anchor-specific reading and consumption in `evals/`

Paths: `evals/cases/build-review-collecting.mjs`,
`evals/asserts/build-review-collecting.mjs`, `evals/cases/design-triage.mjs`,
`evals/asserts/design-triage.mjs`.

Two separate graded behaviours, because no single state demonstrates both.

**Anchor-specific reading** goes in the review-collecting case: a new variant
whose captured raw-review narrative quotes a footnote anchored on one named
hunk, in the same inline-quoted style the existing `violation` variant uses. Its
grader checks the written concern names that hunk's path, reusing the existing
planted-identifier machinery, rather than accepting a generic whole-file remark.

**Consumption** goes in the design-triage case: a variant that seeds a
footnote-bearing input file, whose grader asserts the file the turn WROTE
carries no `[^` left. Deletion is graded here and not in review-collecting,
because review-collecting never touches a footnote-bearing file it also
rewrites, so it cannot demonstrate consumption at all.

Acceptance criteria:

- [ ] The review-collecting case gains a footnote variant, and its grader fails
      a concern that describes the whole file instead of the anchored hunk
- [ ] The design-triage case gains a footnote variant, and its grader fails an
      output that still contains a footnote marker or definition
- [ ] Both new graders reuse the shared grading helpers rather than
      reimplementing the shared checks
- [ ] `npm run test:mutation` is NOT run for this — it is a deliberate user
      action only

## Task 4 — document the syntax a human types

Paths: `docs/configuration.md`, `README.md`.

`docs/configuration.md`'s built-in-steering-formats section gains the footnote
syntax: marker shape, definition shape, where the body goes, and the four
validator findings. `README.md`'s LSP paragraph gains a mention of the footnote
code action and the two-way jump.

**Nothing about how the parser is built.** No module name, no internal function,
no private type — this repo's documentation rule forbids it, and prose in
`docs/` and `README.md` must not name a `src/*.ts` module.

Acceptance criteria:

- [ ] `docs/configuration.md` documents the marker and definition syntax, the
      body's placement convention, and all four findings, as user-facing syntax
- [ ] `README.md` mentions the code action and the two-way jump
- [ ] Neither file names a `src/*.ts` module, an internal function, or a private
      type
- [ ] The pinned generated views in `docs/cli.md` — its commands block and its
      exit-code table — still match the rendered help output and exit-code set
- [ ] `npm test` is green, including the doc-tested driver feature
