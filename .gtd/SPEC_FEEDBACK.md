# Spec feedback — package 01, concise agent prompts

**Three items remain; everything else in Tasks 1–5 is done and correct.** The
big compression landed this round — agent-read text dropped from ~4,400 to
~3,200 words, `npm test` is green (9/9 turbo tasks), `unified.yaml` is an oxfmt
fixed point, every verbatim contract survives, and every out-of-scope block is
byte-identical. Two of Task 1's thirteen blocks were reflowed but not shortened,
and one over-long line flagged last round was never re-wrapped.

## 1 — `vars.fixFeedbackPrompt` is not visibly shorter, and restates one rule twice (blocking)

**73 words → 69 words, and 8 rendered lines → 8 rendered lines.** Task 1's first
criterion says all thirteen blocks are visibly shorter. A 5% cut is not that.

The block splices into `packages.item.fix-suite` and `build.fix`, so every word
here renders twice.

The cut is sitting in plain sight — bullets 1 and 3 state the same rule:

- Bullet 1: "fix it per its contents, **or delete it if the feedback is wrong**"
- Bullet 3: "**If the feedback is wrong, empty or delete `.gtd/FEEDBACK.md`**
  instead of 'fixing' a non-issue"

Fold them into one. Keep all three surviving facts — fix per contents, keep the
change focused and never refactor unrelated code, and delete/empty rather than
"fix" a non-issue.

## 2 — `vars.stateFileRules` is not visibly shorter (blocking)

**28 words → 26 words, 3 rendered lines → 3 rendered lines.** It changed shape
from prose to bullets (which resolves last round's point 4) but the length is
unchanged. Same Task 1 criterion.

**This is the highest-leverage block in the file: it splices into 10 prompts.**
Two words saved here is twenty words saved rendered.

Current text carries a redundant restatement — "its own state files" and "its
private scratchpad" name the same thing twice, and "project code or
documentation" is one idea in five words. Both facts must survive: the agent is
autonomous, and `.gtd/` state files are its private scratchpad rather than
project code or documentation a human reads.

## 3 — `src/workflows/unified.yaml:572` is a 139-character line in a block that wraps at ~72 (fix)

Flagged last round as minor and not addressed. The line is in `archPlan.author`:

    - A merge raises no open question and stops for no human — do not route it to `architecture.gate` for a veto; the human sees it

Its own continuation line and every neighbouring bullet in the same block wrap
at ~72. Line 570 is also over at 92 characters. oxfmt does not reflow inside a
`|-` block scalar, so `format:check` stays green and this survives untouched.

Re-wrap both to the block's width. **Do not change the words** — the merge rule
and the stops-for-no-human rule are both pinned acceptance criteria.

## Confirmed correct — do not re-do

- **Every must-survive rule in Tasks 1–4 is present.** `questionBar`'s
  three-part warrant test, decide-it-yourself sink, literal checkbox template,
  never-tick ban and both ordering rules; `questionBarReturn`'s
  Answered-Questions-last rule; `agentConduct`'s three facts; each persona's
  distinct identity; `styleBlock`'s full precedence clause including "a number,
  a threshold, or a scoped condition"; `styleFormatContract`'s outranks-claim
  and literal-elements rule; triage's vertical-not-horizontal slicing, "never by
  layer", scaffolding-folds-in, fails-before/passes-after check, "prefer fewer,
  larger packages", the `git rev-list --ancestry-path` recipe and the
  red-suite-first loop-back; author's footprint merge rule, interface-consumer
  exception, merge-only, `## Merged Concerns` verbatim carry and
  stops-for-no-human; decompose's one-file-per-concern, no-cross-`.gtd/`-
  reference and no-package-for-`## Merged Concerns`; `reviewing`'s full document
  contract; `collecting`'s three triggers as three `-` bullets, tick-is-not-
  sign-off, hand-edit-is-a-sketch, raise-no-open-questions and both failure
  modes; `specReview.review`'s silence-is-approval, never-fix and
  never-delete-the-package-file; `SATISFIED.md` per-criterion evidence,
  never-touch-`.gtd/NEXT.md`, fan-out-to-subagents, leave-uncommitted;
  `fix-suite`'s cross-package permission; `fix-spec`'s delete step; `summary`'s
  cold-read framing, coverage list and never-name-changed-files ban.
- **Compression targets are met everywhere else.** `designPlan.triage` 795→575,
  `humanReview.collecting` 453→299, `archPlan.author` 415→349,
  `humanReview.reviewing` 295→235, `archPlan.decompose` 206→176, `summary`
  205→182, `packageItem.building` 197→134, `specReview.review` 189→129,
  `questionBar` 274→176, `agentConduct` 217→122, `styleBlock` 174→151, all six
  personas 565→354, `styleFormatContract` 69→51, `fix-spec` 70→54, `fix-suite`
  59→49, `buildTail.fix` 17→14.
- **Every out-of-scope block is byte-identical.** All `message:` and `script:`
  bodies, every edge `describe:`, every `label:`, every `#` comment. No diff to
  `docs/`, `README.md`, `turbo.json`, `package.json` — the whole range touches
  four files.
- **Every `<%= %>`/`<%~ %>` tag survives**, `summary`'s 18 `it.*` tags and its
  cost loop byte-for-byte identical. Var names, the six-persona set and all
  splice-point counts are unchanged.
- **Task 1's loosened pins are correct.** `styleFormatContract` now pins
  `/renumber|rename|reorder/i` and `/refus/i`; `questionBar`/`questionBarReturn`
  now pin the ordering structurally rather than by literal sentence. None was
  re-pinned to the new terse literal.
- **Task 5 is done.** Both new assertions live in the existing
  `templates.test.ts` — no new script, no new `turbo.json` task, no new `test`
  list entry. `src/ReviewDoc.test.ts` and `src/OpenQuestions.test.ts` pass.
