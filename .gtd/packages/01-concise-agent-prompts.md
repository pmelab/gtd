# Package 01 — Concise agent prompts in `unified.yaml`

**Rewrite every agent-read block in `src/workflows/unified.yaml` into terse,
telegraphic instructions, and rewrite the assertions that pinned the old
wording.** Roughly **4,900 of the file's ~9,200 words are agent-read** — persona
`system:` blocks, `prompt:` bodies, the shared `vars:` blocks those splice in,
and the top-level `summary` prompt. That is the target.

**Human-read text is out of scope and stays byte-for-byte as it is**: every
`message:` body, every edge `describe:`, every `label:`, and every `#` comment
in the YAML.

**Four concerns were merged into this one package** because all four edit only
`src/workflows/unified.yaml` and `src/workflows/templates.test.ts`, and none
creates an interface a later one consumes. All four requirements are carried
below verbatim and are reviewed independently.

## Files

- `src/workflows/unified.yaml` — every `system:`, `prompt:` and shared `vars:`
  block named below, and nothing else in the file
- `src/workflows/templates.test.ts` — every assertion matching prompt or var
  text, loosened to keep the same rule under guard at the new wording
- `src/ReviewDoc.test.ts:765` and `src/OpenQuestions.test.ts:604` — read-only
  check; both carry a "voice check" comment pointing at `styleBlock`, so confirm
  they still pass rather than assuming a comment cannot break a test
- Untouched, and any diff to them is a defect: every `message:` body, every edge
  `describe:`, every `label:`, every `#` comment, every `script:` block,
  `docs/`, `README.md`, `turbo.json`, `package.json`

## Settled decisions

- **Every compressed block is a `- ` bullet list, one rule per line.** Prose
  survives only where a rule spans more than one clause and splitting it would
  separate a condition from what it scopes.
- **Numbered lists are banned outright.** `templates.test.ts:581` asserts
  `design.triage` matches no `^\s*\d+\.\s`; `templates.test.ts:559` asserts the
  `## First lap`-to-`## Return lap` slice of both `design.triage` and
  `architecture.author` matches no `[0-9]` at all. `-` bullets are the only
  marker available.
- **Every rewritten assertion is loosened to a keyword or structural pin, never
  re-pinned to the new terse literal.** Assert the surviving concept, not a
  sentence's exact words, so the guard survives the next reword.
- **Risk: a loosened pin cannot catch a rule dropped mid-sentence.** A keyword
  pin passes when the keyword survives but its qualifier does not — for example
  `styleBlock` keeping "never trim a risk" while losing "a number, a threshold,
  or a scoped condition". Pin the qualifier list itself where a rule has one,
  and read every compressed block against this file's acceptance criteria before
  calling a task done.
- **Var names, the persona set and the splice points do not change.** No new
  var, no rename, no merge — `docs/configuration.md` and `docs/driver.md` name
  them in prose and `templates.test.ts` derives its persona set from the
  `*Persona` suffix.
- **No new tooling.** No new `package.json` script, no new `turbo.json` task, no
  new entry in the `test` task list. YAML `|-` block scalars, Eta tags, Vitest,
  oxfmt and Turborepo are all already in place.
- **No `docs/` or `README.md` change.** They name var names and persona names,
  all of which survive unchanged, and describe no prompt wording.
- **When a test and a prompt disagree, the test gives way** — loosened to guard
  the same rule at the new wording. **When a parser and a prompt disagree, the
  prompt gives way** — the contract text is restored verbatim.

## Verbatim-copy contracts

Three classes of content are machine-parsed and are copied
character-for-character into the compressed block. Compressing any of these
breaks a parser, not a paragraph.

- The `## Open Questions` / `## Answered Questions` section ordering and the
  literal checkbox template
  (`- [ ] <first option — a concrete answer, a few words of rationale>`,
  `- [ ] <second option>`, `- [ ] _your answer_`). `gtd check qa` enforces the
  ordering.
- The review-document shape in `humanReview.reviewing`: the `# Review: <sha>`
  first line, the `<!-- base: ... -->` marker, at least one `## <Chunk Title>`,
  the `- [ ] ./path#42 — note` pointer, the **exactly-two-space** continuation
  rule with its never-four-or-more warning, and the ban on a note starting with
  a bare `./path`. `src/ReviewDoc.ts` parses documents written to this shape.
- Every `<%= %>` and `<%~ %>` template tag, including `summary`'s `it.*` tags
  and its cost loop.

## Task 1 — Compress the shared vars and the six personas

Blocks (~1,700 words): `agentConduct`, `designPersona`, `architectPersona`,
`reviewerPersona`, `specReviewerPersona`, `builderPersona`, `finisherPersona`,
`stateFileRules`, `questionBar`, `questionBarReturn`, `fixFeedbackPrompt`,
`styleBlock`, `styleFormatContract` — all in `src/workflows/unified.yaml`.

**Risk: the `styleBlock` rewrite must keep its four attribution lines.**
`templates.test.ts` matches the raw YAML for `attention-span`, the
`https://github.com/alexgreensh/attention-span` URL, `AGPL-3.0`, and
`version 0.6`. They live in the `#` comment above the var, which is out of scope
anyway — deleting them while tightening the block around them reds the suite and
drops a licence credit.

**Risk: the undefined-leak assertion is the only guard on var tags.** Eta
stringifies a missing `it.vars.<name>` lookup to the literal `undefined` with no
throw. `templates.test.ts:607` renders every prompt, system and script value
against the bundled defaults and asserts no `undefined` leaks. A mistyped tag
surfaces only there.

- [ ] All thirteen blocks are visibly shorter and each is a `- ` bullet list
      except where a rule spans clauses that must not be split
- [ ] `questionBar` still states the three-part warrant test, the
      decide-it-yourself sink, the literal checkbox template, the "never tick a
      box yourself" ban, and both ordering rules (`## Open Questions` before
      every other `##`, `## Answered Questions` after every other `##`)
- [ ] `questionBarReturn` still states the
      `## Answered Questions`-after-every-other-`##` rule
- [ ] `agentConduct` still states all three facts: use tools without asking; no
      injected status block, so orient with git yourself; the turn message names
      a commit to go inspect rather than inlining a diff
- [ ] Each persona keeps its distinct identity — reviewer as a separate mind
      from the builder, spec reviewer's "silence is approval", builder's
      stay-inside-this-package scope
- [ ] `styleBlock` still carries its precedence clause with every item intact:
      never trim a risk, a number, a threshold, or a scoped condition to save
      space, and that rule outranks every other voice rule
- [ ] `styleFormatContract` still states that the format contract outranks the
      voice rules, and that headings, `- [ ]` rows and marker lines are kept
      literally
- [ ] The four attribution strings still match in the raw YAML:
      `attention-span`, `https://github.com/alexgreensh/attention-span`,
      `AGPL-3.0`, `version 0.6`
- [ ] Var names, persona set and splice points are unchanged
- [ ] `templates.test.ts` phrasing pins on `vars.questionBar` and
      `styleFormatContract` are loosened to keyword or structural pins, each
      still guarding its rule
- [ ] `src/ReviewDoc.test.ts` and `src/OpenQuestions.test.ts` still pass
- [ ] `npm test` is green after this task, before starting Task 2
- [ ] `gtd check qa` still rejects a document with `## Answered Questions` in
      the wrong position

## Task 2 — Compress the planning prompts

Blocks (~1,450 words): `designPlan.triage`, `archPlan.author`,
`archPlan.decompose` in `src/workflows/unified.yaml`.

**Risk: two assertions forbid digits.** `templates.test.ts:559` slices
`design.triage` and `architecture.author` between `## First lap` and
`## Return lap` and asserts the slice matches no `[0-9]`. Terse rewriting
invites writing "3 rules"; that reds the suite. `templates.test.ts:581`
separately bans `^\s*\d+\.\s` anywhere in `design.triage`.

- [ ] All three prompts are visibly shorter
- [ ] `## First lap`, `## Return lap` and `## Review loop-back` remain literal
      headings in that order in `designPlan.triage`; `## First lap` and
      `## Return lap` remain literal and in that order in `archPlan.author`
- [ ] `designPlan.triage` still states vertical-not-horizontal slicing, "never
      by layer", scaffolding folded into its first consumer, an observable check
      that fails before and passes after, "prefer fewer, larger packages", the
      `git rev-list --ancestry-path` recipe for finding the entry commit, and
      the review-loop-back rule that a red suite becomes the first concern
- [ ] `archPlan.author` still states the file-footprint merge rule, the
      interface-consumer exception, merge-only-never-split, the
      `## Merged Concerns` heading carrying both requirements verbatim, and that
      a merge stops for no human
- [ ] `archPlan.decompose` still states one package file per concern in settled
      order, each carrying requirements plus `- [ ]` acceptance criteria, that
      no package file references another state file, and that
      `## Merged Concerns` never gets a package of its own
- [ ] The digit-free slice assertions and the no-`^\s*\d+\.\s` assertion still
      pass unchanged
- [ ] `npm test` is green after this task, before starting Task 3

## Task 3 — Compress the review prompts

Blocks (~1,200 words): `humanReview.reviewing`, `humanReview.collecting`,
`specReview.review` in `src/workflows/unified.yaml`. The `await-review` and
`review-missing` `message:` bodies sit in the same machine and are **not**
touched.

**Risk: `humanReview.collecting` carries three numbered actionability
triggers.** They become three `-` bullets, still three distinguishable items —
never a merged sentence, and never `1.`/`2.`/`3.`.

- [ ] All three prompts are visibly shorter
- [ ] `humanReview.reviewing`'s document contract is copied over unchanged: the
      `# Review: <sha>` first line, the `<!-- base: ... -->` marker, at least
      one `## <Chunk Title>`, the `- [ ] ./path#line — note` pointer shape, the
      exactly-two-space continuation rule with its never-four-or-more warning,
      and the ban on a note starting with a bare `./path`
- [ ] `humanReview.collecting` keeps its three actionability triggers as three
      distinguishable `-` bullets, keeps "a tick means I read this hunk, never
      sign-off", keeps "a hand-edit is a sketch, never final", keeps the
      raise-no-open-questions ban, and names both failure modes — never invent
      actionability, never dismiss a real note as approval
- [ ] `specReview.review` keeps "write nothing when it is clean — silence is
      approval", "do not fix anything yourself", and "do not delete the package
      file"
- [ ] `npm test` is green after this task including the review-document e2e
      features, before starting Task 4

## Task 4 — Compress the build prompts and `summary`

Blocks (~750 words): `packageItem.building`, `packageItem.fix-suite`,
`packageItem.fix-spec`, `buildTail.fix`, and the top-level `summary` prompt in
`src/workflows/unified.yaml`.

- [ ] All four prompts and `summary` are visibly shorter
- [ ] The `SATISFIED.md` early-exit rule survives with its per-criterion
      evidence requirement intact
- [ ] "never touch `.gtd/NEXT.md`", "do not delete the package file", the
      fan-out-to-parallel-subagents instruction and "leave everything
      uncommitted" all survive
- [ ] `fix-suite` keeps its permission to implement a later package's work when
      that is the only way to green the suite
- [ ] `fix-spec` keeps its delete-`SPEC_FEEDBACK.md`-when-done step
- [ ] `summary` keeps its cold-read framing, the motivation/decisions/trade-offs
      coverage list, and the never-name-changed-files ban
- [ ] Every `it.*` template tag in `summary`, including the cost loop, is
      byte-for-byte unchanged
- [ ] `npm test` is green

## Task 5 — Pin the review-document contract and re-check formatting

The review-document two-space continuation rule and the `# Review: <sha>` /
`<!-- base: ... -->` shape in `humanReview.reviewing` have no direct assertion
in `templates.test.ts` today, and compression is precisely the risk they guard
against.

**Risk: oxfmt formats `.yaml` and reflows prose.** `.prettierignore` is empty
and `format:check` runs `oxfmt --check .` across the repo, so `unified.yaml` is
in scope. The file is an oxfmt fixed point today. A reflow that changes the
two-space continuation example breaks `src/ReviewDoc.ts`'s parser contract while
`format:check` stays green.

- [ ] `templates.test.ts` gains an assertion pinning the exactly-two-space
      continuation rule text in `humanReview.reviewing`
- [ ] `templates.test.ts` gains an assertion pinning the `# Review: <sha>` first
      line and the `<!-- base: ... -->` marker in `humanReview.reviewing`
- [ ] Both new assertions live in the existing `templates.test.ts` — no new
      script, no new `turbo.json` task, no new entry in the `test` task list
- [ ] `npm run format` has been run and `src/workflows/unified.yaml` is an oxfmt
      fixed point
- [ ] The block scalars have been re-read after formatting and no reflow altered
      any verbatim-copy contract
- [ ] `npm test` is green

## Requirements

All four merged requirements below are carried verbatim and are reviewed
independently.

### Concern 1 — Compress the shared prompt vars and the six personas — TECHNICAL

**Every prompt in the file is mostly shared text, so this concern moves the most
words for the least risk.** In scope: `agentConduct` (~180 words), the six
`*Persona` blocks, `stateFileRules`, `questionBar`, `questionBarReturn`,
`fixFeedbackPrompt`, **and the output-voice pair `styleBlock` +
`styleFormatContract` (~250 words)** — about 1,700 words together.

**`styleBlock` and `styleFormatContract` are compressed like everything else.**
They are agent-read, and the deliverables they govern are judged by the rules'
content, not by the rules' wording.

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
- `styleBlock`'s own precedence rule: **never trim a risk, a number, a
  threshold, or a scoped condition to save space — it outranks every other voice
  rule.** Compressing the block must not compress that clause away, or every
  generated deliverable loses the one rule that protects its numbers.
- `styleFormatContract`'s claim that the format contract outranks the voice
  rules, and that headings, `- [ ]` rows and marker lines are kept literally.

**Var names do not change.** `docs/configuration.md` and `docs/driver.md` name
`styleBlock`, `stateFileRules`, `questionBar` and all six personas in prose, and
`templates.test.ts` derives its persona set from the `*Persona` suffix. Renaming
or merging a var turns a prompt edit into a docs-and-tests change for no gain.

**Risk: `templates.test.ts` pins phrasing, not behaviour.** It asserts on
`vars.questionBar` matching ``/before every other `##`\s+section/`` and on
`styleFormatContract` matching four separate patterns — `/checkbox/`,
`/##.*###.*heading/`, `/renumber or\s+rename/`, and `/refuses the turn|refused/`
— among others. Those assertions get rewritten to pin the surviving concept in
its new wording — the prompt is never left verbose to satisfy a regex. The rule
behind the assertion must still hold; only the words it matches change.

**Risk: the `styleBlock` rewrite must keep its four attribution lines.**
`templates.test.ts` matches the raw YAML for `attention-span`, the
`https://github.com/alexgreensh/attention-span` URL, `AGPL-3.0`, and
`version 0.6`. Those live in the `#` comment above the var, which is out of
scope anyway — deleting them while tightening the block around them reds the
suite and drops a licence credit.

**Risk: two unit tests read `styleBlock` as the definition of gtd's voice.**
`src/ReviewDoc.test.ts:765` and `src/OpenQuestions.test.ts:604` carry "voice
check" comments pointing at it. Check both still pass on the compressed wording
rather than assuming a comment cannot break a test.

Acceptance: the six personas and the shared vars — output-voice pair included —
are each visibly shorter, `npm test` is green, and `gtd check qa` still rejects
a document with `## Answered Questions` in the wrong position.

### Concern 2 — Compress the planning prompts — TECHNICAL

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

### Concern 3 — Compress the review prompts — TECHNICAL

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

### Concern 4 — Compress the build prompts and the `summary` prompt — TECHNICAL

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
