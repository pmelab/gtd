# Architecture: concise agent prompts in `unified.yaml`

**One package. Every concern edits the same two files —
`src/workflows/unified.yaml` and `src/workflows/templates.test.ts` — and none of
them builds an interface a later one consumes, so the four merge.** The work is
a textual rewrite of agent-read blocks plus the assertion rewrites that rewrite
forces. There is no new module, no new dependency, and no engine change: a
workflow is data, and this changes the data.

## Open Questions

### What shape does a compressed block take — hard-wrapped telegraphic prose, or bullet lists?

- [ ] Telegraphic prose paragraphs, hard-wrapped at the file's current width —
      smallest diff, keeps blocks reading as continuous instruction, no risk of
      a bullet reading as an exhaustive checklist
- [x] `- ` bullet lists, one rule per line — highest signal-per-word and easiest
      for an agent to scan, but restructures every block and inflates the diff;
      note `templates.test.ts:581` bans `^\s*\d+\.\s` in `design.triage`, so
      numbered lists are out either way and only `-` bullets are available
- [ ] _your answer_

### How do the phrasing-pinned assertions in `templates.test.ts` get rewritten?

- [ ] Re-pin to the new terse literal — each regex updated to match the
      compressed wording, same tightness as today; the pin stays exact, and the
      next reword breaks the suite again exactly as it does now
- [x] Loosen to keyword/structural pins — assert the surviving concept (e.g.
      `Answered Questions` appearing after other `##` sections) rather than a
      sentence's phrasing, so the guard survives future rewordings; weaker at
      catching a rule silently dropped mid-sentence
- [ ] _your answer_

## Package footprint

`src/workflows/unified.yaml` — every `system:`, `prompt:` and shared `vars:`
block listed below, and nothing else in the file.

`src/workflows/templates.test.ts` — every assertion that matches prompt or var
text, rewritten to keep the same rule under guard at the new wording.

`src/ReviewDoc.test.ts:765` and `src/OpenQuestions.test.ts:604` — read-only
check. Both carry a "voice check" comment pointing at `styleBlock`; confirm they
still pass rather than assuming a comment cannot break a test.

Untouched, and any diff to them is a defect: every `message:` body, every edge
`describe:`, every `label:`, every `#` comment, every `script:` block, `docs/`,
`README.md`, `turbo.json`, `package.json`.

## Edit order inside the package

Shared vars and personas first, planning prompts second, review prompts third,
build and `summary` prompts last — the settled concern order. **Run `npm test`
after each of the four steps, not once at the end.** The four groups fail in
different ways (var compression reds `templates.test.ts` phrasing pins; planning
compression reds the digit-free slice assertions; review compression reds the
review-document e2e features), and a single end-of-work run makes four unrelated
failures arrive together.

## Blocks in scope, by group

**Shared vars and personas** (~1,700 words): `agentConduct`, `designPersona`,
`architectPersona`, `reviewerPersona`, `specReviewerPersona`, `builderPersona`,
`finisherPersona`, `stateFileRules`, `questionBar`, `questionBarReturn`,
`fixFeedbackPrompt`, `styleBlock`, `styleFormatContract`.

**Planning prompts** (~1,450 words): `designPlan.triage`, `archPlan.author`,
`archPlan.decompose`.

**Review prompts** (~1,200 words): `humanReview.reviewing`,
`humanReview.collecting`, `specReview.review`.

**Build prompts and summary** (~750 words): `packageItem.building`,
`packageItem.fix-suite`, `packageItem.fix-spec`, `buildTail.fix`, top-level
`summary`.

Target: roughly 4,900 agent-read words of the file's ~9,200.

## Verbatim-copy contracts

Three classes of content are machine-parsed and get copied
character-for-character into the compressed block — they are not prose and
compressing them breaks a parser:

- The `## Open Questions` / `## Answered Questions` section ordering and the
  literal checkbox template
  (`- [ ] <first option — a concrete answer, a few words of rationale>`,
  `- [ ] <second option>`, `- [ ] _your answer_`). `gtd check qa` enforces the
  ordering.
- The `REVIEW.md` shape in `humanReview.reviewing`: the `# Review: <sha>` first
  line, the `<!-- base: ... -->` marker, at least one `## <Chunk Title>`, the
  `- [ ] ./path#42 — note` pointer, the **exactly-two-space** continuation rule
  with its never-four-or-more warning, and the ban on a note starting with a
  bare `./path`. `src/ReviewDoc.ts` parses this.
- Every `<%= %>` and `<%~ %>` template tag, including `summary`'s `it.*` tags
  and its cost loop.

## Rules that must still be stated after the rewrite

Each is pinned by a test assertion or by a state-machine edge; dropping the
sentence that carries it is a behaviour change, not a compression.

`questionBar`: the three-part warrant test, the decide-it-yourself sink, the
literal checkbox template, "never tick a box yourself", and both ordering rules.
`questionBarReturn`: the `## Answered Questions`-after-every-other-`##` rule.

`agentConduct`: use tools without asking; no injected status block, so orient
with git yourself; the turn message names a commit to go inspect rather than
inlining a diff.

Personas: each keeps its distinct identity — reviewer as a separate mind from
the builder, spec reviewer's "silence is approval", builder's
stay-inside-this-package scope.

`styleBlock`: **never trim a risk, a number, a threshold, or a scoped condition
to save space — it outranks every other voice rule.** Compressing the block must
not compress that clause away.

`styleFormatContract`: the format contract outranks the voice rules; headings,
`- [ ]` rows and marker lines are kept literally.

`designPlan.triage`: vertical-not-horizontal slicing, "never by layer",
scaffolding folded into its first consumer, an observable check that fails
before and passes after, "prefer fewer, larger packages", the
`git rev-list --ancestry-path` recipe, and the review-loop-back rule that a red
suite becomes the first concern. `## First lap`, `## Return lap`,
`## Review loop-back` stay as literal headings in that order.

`archPlan.author`: the file-footprint merge rule, the interface-consumer
exception, merge-only-never-split, the `## Merged Concerns` heading carrying
both requirements verbatim, and that a merge stops for no human. `## First lap`
and `## Return lap` stay literal, in that order.

`archPlan.decompose`: one package file per concern, in settled order, under
`.gtd/packages/`, each carrying requirements plus `- [ ]` acceptance criteria;
no package file references another `.gtd/` file; `## Merged Concerns` never gets
a package of its own.

`humanReview.collecting`: three distinguishable actionability triggers, "a tick
means I read this hunk, never sign-off", "a hand-edit is a sketch, never final",
the raise-no-open-questions ban, and both failure modes — never invent
actionability, never dismiss a real note as approval.

`specReview.review`: "write nothing when it is clean — silence is approval", "do
not fix anything yourself", "do not delete the package file".

Build prompts: the `SATISFIED.md` early-exit with its per-criterion evidence
requirement, "never touch `.gtd/NEXT.md`", "do not delete the package file", the
fan-out-to-parallel-subagents instruction, "leave everything uncommitted",
`fix-suite`'s permission to implement a later package's work when that is the
only way to green the suite, and `fix-spec`'s
delete-`SPEC_FEEDBACK.md`-when-done step. `summary`: cold-read framing, the
motivation/decisions/trade-offs coverage list, the never-name-changed-files ban.

## Error handling and failure modes

**`templates.test.ts` pins phrasing, not behaviour, in several places.** It
asserts `vars.questionBar` matches ``/before every other `##`\s+section/`` and
matches four separate patterns on `styleFormatContract` — `/checkbox/`,
`/##.*###.*heading/`, `/renumber or\s+rename/`, `/refuses the turn|refused/`.
Those get rewritten. A prompt is never left verbose to satisfy a regex.

**Risk: the `styleBlock` rewrite must keep its four attribution lines.**
`templates.test.ts` matches the raw YAML for `attention-span`, the
`https://github.com/alexgreensh/attention-span` URL, `AGPL-3.0`, and
`version 0.6`. They live in the `#` comment above the var, which is out of scope
anyway — deleting them while tightening the block around them reds the suite and
drops a licence credit.

**Risk: two assertions forbid digits.** `templates.test.ts:559` slices
`design.triage` and `architecture.author` between `## First lap` and
`## Return lap` and asserts the slice matches no `[0-9]`. Terse rewriting
invites "3 rules"; that reds the suite. `templates.test.ts:581` separately bans
`^\s*\d+\.\s` anywhere in `design.triage`.

**Risk: oxfmt formats `.yaml` and reflows prose.** `.prettierignore` is empty
and `format:check` runs `oxfmt --check .` across the repo, so `unified.yaml` is
in scope. The file is a fixed point today. Run `npm run format` after the
rewrite and re-read the block scalars: a reflow that changes the two-space
continuation example in `humanReview.reviewing` breaks `src/ReviewDoc.ts`'s
parser contract while `format:check` stays green.

**Risk: the undefined-leak assertion is the only guard on var tags.** Eta
stringifies a missing `it.vars.<name>` lookup to the literal `undefined` with no
throw. `templates.test.ts:607` renders every prompt, system and script value
against the bundled defaults and asserts no `undefined` leaks. A mistyped tag
introduced while editing surfaces only there.

**Failure policy: when a test and a prompt disagree, the test gives way** —
rewritten to guard the same rule at the new wording. When a _parser_ and a
prompt disagree, the prompt gives way: the contract text is restored verbatim.

## Tech stack

Nothing added. YAML `|-` literal block scalars, Eta template tags, Vitest,
oxfmt, Turborepo — all already in place. No new `package.json` script, no new
`turbo.json` task, no new entry in the `test` task list.

## Merged Concerns

All four requirements below are carried verbatim so the per-package spec review
covers each independently.

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

## Answered Questions

### Do the four concerns collapse into one package?

Yes. Every one of them edits `src/workflows/unified.yaml` and
`src/workflows/templates.test.ts` and nothing else, and none creates an
interface a later one consumes — the interface-consumer exception does not
apply, so the merge rule is unconditional.

### Are new vars introduced to hoist the repeated verbatim contracts?

No. The requirements settle that var names, the persona set and the splice
points do not change; hoisting the `REVIEW.md` pointer shape or the checkbox
template into a new shared var would be exactly that change. Contracts stay
inline in the prompt that owns them.

### Are new test assertions added for contracts that currently have none?

Yes, a small number: the `REVIEW.md` two-space continuation rule and the
`# Review: <sha>` / `<!-- base: -->` shape in `humanReview.reviewing` are parser
contracts with no direct pin in `templates.test.ts` today, and compression is
precisely the risk they guard against. They go into the existing
`templates.test.ts` — no new script, no new `turbo.json` task.

### Are `docs/` or `README.md` updated?

No. The docs name var names and persona names, all of which survive unchanged,
and they describe no prompt wording. Under this repo's rules a document
describing prompt internals would be deleted, not written.

### Is the rewrite verified by anything beyond `npm test`?

No new tooling. `npm test` plus reading the diff is the check. A word-count gate
was already rejected upstream as a bad proxy that blocks legitimate additions.

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

### Does the injected output-voice block (`styleBlock` + `styleFormatContract`) get compressed too?

Yes. Both are agent-read like every other block, and the deliverables they
govern are judged by the rules' content, not their wording — so they compress
inside Concern 1, subject to that concern's two named risks.

### Does the repo gain a check that fails when a prompt grows verbose again?

No. No automated word budget ships: a word count is a bad proxy for verbosity
and would block legitimate additions. Nothing new is added to `turbo.json` or
the `test` task list.
