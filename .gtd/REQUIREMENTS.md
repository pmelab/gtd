# Requirements: concise agent prompts in `unified.yaml`

**Rewrite every agent-read block in `src/workflows/unified.yaml` into terse,
telegraphic instructions — drop articles, filler and connective prose, keep
grammar only where it carries meaning.** Roughly **4,900 of the file's ~9,200
words are agent-read** (persona `system:` blocks, `prompt:` bodies, the shared
`vars:` blocks those splice in, and the `summary` prompt). That is the target.

**Human-read text is out of scope and stays as it is**: every `message:` body,
every edge `describe:`, every `label:`, and every `#` comment in the YAML.

**Signal must survive byte-for-byte where it is machine-read.** Three classes of
content inside prompts are contracts, not prose, and are copied verbatim into
the compressed version: the `## Open Questions` / `## Answered Questions`
section ordering and checkbox shape, the `REVIEW.md` hunk-pointer shape (the
`- [ ] ./path#42 — note` line and its two-space continuation rule), and every
`<%= %>` / `<%~ %>` template tag. Compressing any of these breaks a parser, not
a paragraph.

## Open Questions

### Does the injected output-voice block (`styleBlock` + `styleFormatContract`) get compressed too?

- [ ] Yes — it is agent-read like everything else, and the deliverables it
      governs are judged by the rules' content, not their wording
- [ ] No — leave both verbatim; they set the voice of `REQUIREMENTS.md`,
      `ARCHITECTURE.md` and `REVIEW.md`, which humans actually read, and
      shortening the rules risks silently changing that output
- [ ] _your answer_

### Does the repo gain a check that fails when a prompt grows verbose again?

- [ ] Yes — add a test with a per-block word budget, so the compression cannot
      erode over time
- [ ] No — no automated budget; a word count is a bad proxy for verbosity and
      would block legitimate additions
- [ ] _your answer_

## Concern 1 — Compress the shared prompt vars and the six personas — TECHNICAL

**Every prompt in the file is mostly shared text, so this concern moves the most
words for the least risk.** In scope: `agentConduct` (~180 words), the six
`*Persona` blocks, `stateFileRules`, `questionBar`, `questionBarReturn`, and
`fixFeedbackPrompt` — about 1,450 words together.

Rules that must still be stated after the rewrite, because a state machine or a
validator depends on them:

- `questionBar`'s three-part warrant test, its decide-it-yourself sink, the
  literal checkbox template, the "never tick a box yourself" ban, and both
  section-ordering rules (`## Open Questions` before every other `##`,
  `## Answered Questions` after every other `##`) — `gtd check qa` enforces the
  ordering, so a prompt that stops stating it produces documents the gate
  rejects.
- `agentConduct`'s three facts: use tools without asking, no injected status
  block so orient with git yourself, and the turn message names a commit to go
  inspect rather than inlining a diff.
- Each persona's distinct identity — the reviewer being a separate mind from the
  builder, the spec reviewer's "silence is approval", the builder's
  stay-inside-this-package scope.

**Var names do not change.** `docs/configuration.md` and `docs/driver.md` name
`styleBlock`, `stateFileRules`, `questionBar` and all six personas in prose, and
`templates.test.ts` derives its persona set from the `*Persona` suffix. Renaming
or merging a var turns a prompt edit into a docs-and-tests change for no gain.

**Risk: `templates.test.ts` pins phrasing, not behaviour.** It asserts on
`vars.questionBar` matching `/before every other `##`\s+section/` and on
`styleFormatContract` matching `/renumber or\s+rename/` among others. Those
assertions get rewritten to pin the surviving concept in its new wording — the
prompt is never left verbose to satisfy a regex. The rule behind the assertion
must still hold; only the words it matches change.

Acceptance: the six personas and the shared vars are each visibly shorter,
`npm test` is green, and `gtd check qa` still rejects a document with
`## Answered Questions` in the wrong position.

## Concern 2 — Compress the planning prompts — TECHNICAL

`designPlan.triage` (~700 words) and `archPlan.author` + `archPlan.decompose`
(~750 words) are the two longest prompt bodies. Both are heavily structured and
that structure stays: `## First lap`, `## Return lap` and `## Review loop-back`
remain literal headings, in that order, because the prompts branch on them.

Facts that must survive, each pinned by an existing assertion or by a state
machine edge:

- Triage: vertical-not-horizontal slicing, "never by layer", scaffolding folded
  into its first consumer, an observable check that fails before and passes
  after, "prefer fewer, larger packages", the `git rev-list --ancestry-path`
  recipe for finding the entry commit, and the review-loop-back rule that a red
  suite becomes the first concern.
- Architecture: the file-footprint merge rule, the interface-consumer exception,
  merge-only-never-split, the `## Merged Concerns` heading carrying both
  requirements verbatim, and that a merge stops for no human.
- Decompose: one package file per concern, in settled order, under
  `.gtd/packages/`, each carrying requirements plus `- [ ]` acceptance criteria,
  no package file referencing another `.gtd/` file, and `## Merged Concerns`
  never getting a package of its own.

**Risk: two assertions forbid digits in a slice of these prompts** —
`templates.test.ts` checks the triage and author slices contain no numerals and
no ordered-list markers, to stop the prompt implying a package count. Terse
rewriting invites writing "3 rules"; that reds the suite.

Acceptance: both prompts are visibly shorter, `npm test` is green, and the
digit-free and heading assertions still pass.

## Concern 3 — Compress the review prompts — TECHNICAL

`humanReview.reviewing`, `humanReview.collecting`, and `specReview.review` —
roughly 1,200 agent-read words. The `await-review` and `review-missing`
`message:` bodies sit in the same machine and are **not** touched.

`reviewing` carries the heaviest contract in the file and it is copied over
unchanged: the `# Review: <sha>` first line, the `<!-- base: ... -->` marker, at
least one `## <Chunk Title>`, the `- [ ] ./path#line — note` pointer shape, the
exactly-two-space continuation rule with its never-four-or-more warning, and the
ban on a note starting with a bare `./path`. `src/ReviewDoc.ts` parses documents
written to this shape; a shortened restatement that drops the two-space rule
produces review files the parser mangles.

`collecting` keeps its three numbered actionability triggers as three
distinguishable items, keeps "a tick means I read this hunk, never sign-off",
keeps "a hand-edit is a sketch, never final", keeps the raise-no-open-questions
ban, and keeps both failure modes named: never invent actionability, never
dismiss a real note as approval.

`specReview.review` keeps "write nothing when it is clean — silence is
approval", "do not fix anything yourself", and "do not delete the package file".

Acceptance: the three prompts are visibly shorter, `npm test` is green including
the review-document e2e features.

## Concern 4 — Compress the build prompts and the `summary` prompt — TECHNICAL

`packageItem.building`, `packageItem.fix-suite`, `packageItem.fix-spec`,
`buildTail.fix`, and the top-level `summary` prompt — roughly 750 agent-read
words.

Must survive: the `SATISFIED.md` early-exit rule with its per-criterion evidence
requirement, "never touch `.gtd/NEXT.md`", "do not delete the package file", the
fan-out-to-parallel-subagents instruction, "leave everything uncommitted",
`fix-suite`'s permission to implement a later package's work when that is the
only way to green the suite, and `fix-spec`'s
delete-`SPEC_FEEDBACK.md`-when-done step. `summary` keeps its cold-read framing,
the motivation/decisions/trade-offs coverage list, the never-name-changed-files
ban, and every `it.*` template tag including the cost loop.

Acceptance: the four prompts and `summary` are visibly shorter and `npm test` is
green.

## Answered Questions

### Are the human-read `message:`, `describe:` and `label:` fields in scope?

No. The sketch scopes the work to prompts on the grounds that they "are never
read by humans but just by agents" — `message:` bodies and edge descriptions are
exactly the text a human reads at a gate, so they keep their full, explanatory
wording.

### Are the `#` comments in the YAML in scope?

No. They are read by a person maintaining the workflow, and several record
non-obvious invariants (edge-row ordering, the Eta autoTrim hoisting rule) that
live nowhere else.

### Do the persona `system:` blocks count as prompts?

Yes. They are agent-read text shipped in the same file and shaped by the same
complaint, and they account for about 600 words on their own.

### How terse is terse?

Telegraphic. The sketch says to sacrifice grammar for conciseness, so sentence
fragments, dropped articles, and imperative stubs are all correct — the only
floor is that an agent reading the block can still act on it.

### When a test pins a prompt's exact phrasing, which side gives way?

The test. Assertions in `templates.test.ts` are rewritten to match the new terse
wording, keeping the same rule under guard; a prompt is never left verbose just
to keep a regex green.

### Are the personas or shared vars merged or renamed?

No. Compression is textual only — same var names, same persona set, same splice
points, so `docs/configuration.md`, `docs/driver.md` and the persona-set
derivation in `templates.test.ts` stay correct.
