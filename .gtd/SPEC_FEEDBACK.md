# Spec feedback — package 01, concise agent prompts

**The compression this package exists to deliver did not happen.** Every
must-survive rule, every verbatim contract and every out-of-scope block is
correct, `npm test` is green, and `unified.yaml` is an oxfmt fixed point — but
the agent-read word count barely moved, and seven blocks came out the same
length or longer. The rewrite reflowed prose into `- ` bullets without cutting
words.

## 1 — Blocks that got LONGER or did not change (blocking)

Word counts, block body only, `27f20a4d` → working tree:

| Block                   | Before | After | Delta              |
| ----------------------- | -----: | ----: | ------------------ |
| `summary` (top level)   |    205 |   206 | **+1**             |
| `packageItem.building`  |    197 |   202 | **+5**             |
| `packageItem.fix-suite` |     59 |    61 | **+2**             |
| `buildTail.fix`         |     17 |    18 | **+1**             |
| `styleFormatContract`   |     69 |    71 | **+2**             |
| `finisherPersona`       |     60 |    60 | **byte-identical** |
| `stateFileRules`        |     28 |    28 | **byte-identical** |

`finisherPersona` and `stateFileRules` are named in Task 1's thirteen blocks and
were never touched — `git diff` shows them only as context lines. Task 1's first
criterion ("All thirteen blocks are visibly shorter") and Task 4's first
criterion ("All four prompts and `summary` are visibly shorter") both fail on
these rows.

## 2 — Blocks that shrank by a rounding error (blocking)

| Block                    | Before | After | Delta     |
| ------------------------ | -----: | ----: | --------- |
| `humanReview.reviewing`  |    295 |   293 | **−0.7%** |
| `archPlan.decompose`     |    206 |   204 | **−1%**   |
| `humanReview.collecting` |    453 |   446 | **−1.5%** |
| `archPlan.author`        |    415 |   400 | **−3.6%** |
| `specReview.review`      |    189 |   177 | **−6.3%** |
| `designPlan.triage`      |    795 |   725 | **−8.8%** |

`humanReview.reviewing`'s diff is **pure line rewrapping** — not one clause was
cut outside the verbatim contract. Its contract is copy-unchanged by design, but
the surrounding instructions (the "no diff, read it yourself" paragraph, the
chunk-grouping explanation) were only re-wrapped.

Total across every agent-read block: **~4,200 words → ~3,870, about −7%**. The
spec named **~4,900 agent-read words** as the target of the rewrite. Compressing
7% of them does not meet "visibly shorter" for the three review prompts (Task 3)
or the three planning prompts (Task 2).

**What to do:** cut clauses, not line breaks. The bullets currently carry the
original sentences whole — subordinate clauses, parentheticals and restatements
intact. One rule per line means one clause per line.

## 3 — `templates.test.ts` pins were never loosened (blocking)

**The only edit to `templates.test.ts` is the two new Task 5 assertions.** Task
1's criterion — "`templates.test.ts` phrasing pins on `vars.questionBar` and
`styleFormatContract` are loosened to keyword or structural pins, each still
guarding its rule" — was not done. These still pin literal phrasing:

- `templates.test.ts:305` — `/renumber or\s+rename/`
- `templates.test.ts:306` — `/refuses the turn|refused/`
- `templates.test.ts:655` — ``/before every other `##`\s+section/``
- `templates.test.ts:656`, `:659` — the `## Answered Questions` after-rule

**The prompt was left verbose to satisfy those regexes** — the exact failure the
spec's settled decisions forbid ("the prompt is never left verbose to satisfy a
regex"). `styleFormatContract` grew by two words in part because it preserved
"renumber or rename" and "refuses the turn" word-for-word.

**What to do:** compress the four blocks freely, then rewrite those five
assertions to pin the surviving concept — e.g. `/renumber|rename/` plus a
separate `/heading/` pin, `/refus/i`, and a structural pin that
`## Open Questions` is stated as preceding and `## Answered Questions` as
following the other `##` sections. Do not re-pin to the new literal.

## 4 — Personas and `stateFileRules` are still prose, not bullet lists (fix)

The settled decision is "every compressed block is a `- ` bullet list, one rule
per line", with prose surviving only where splitting would separate a condition
from what it scopes. All six `*Persona` blocks and `stateFileRules` remain
running prose. A single-identity persona statement is a defensible prose
exception; **`stateFileRules` is not** — it is a rule list, and it is unedited.

## 5 — One unwrapped line inside a compressed bullet (minor)

`src/workflows/unified.yaml:612` is **146 characters** while every neighbouring
line in the same block wraps at ~72:

    merge raises no open question and stops for no human — do not route it to `architecture.gate` for a veto; the human still sees every

oxfmt does not reflow inside a `|-` block scalar, so `format:check` stays green
and this survives. Re-wrap it to match the block.

## Confirmed correct — do not re-do

- Every must-survive rule in Tasks 1–4 is present: `questionBar`'s three-part
  warrant test, decide-it-yourself sink, literal checkbox template, never-tick
  ban and both ordering rules; `agentConduct`'s three facts; `styleBlock`'s full
  precedence clause including "a number, a threshold, or a scoped condition";
  `styleFormatContract`'s outranks-claim; triage's `--ancestry-path` recipe,
  "never by layer" and red-suite-first loop-back; author's footprint merge rule,
  interface exception, merge-only and stops-for-no-human; decompose's
  no-package-for-`## Merged Concerns`; `reviewing`'s full document contract;
  `collecting`'s three triggers as three bullets plus both failure modes;
  `specReview.review`'s silence-is-approval; `SATISFIED.md` per-criterion
  evidence, never-touch-`.gtd/NEXT.md`, fan-out, leave-uncommitted,
  `fix-suite`'s cross-package permission, `fix-spec`'s delete step; `summary`'s
  cold-read framing and never-name-changed-files ban.
- **Every out-of-scope block is byte-identical**: all `message:` and `script:`
  bodies, every edge `describe:`, every `label:`, every `#` comment. No diff to
  `docs/`, `README.md`, `turbo.json`, `package.json`.
- **Every `<%= %>`/`<%~ %>` tag survives**, `summary`'s `it.*` tags and cost
  loop included. Only one duplicate `<%= it.startCommit %>` occurrence was
  dropped with the parenthetical around it in `designPlan.triage` — no var lost.
- Task 5's two new assertions are correct and live in the existing
  `templates.test.ts`; no new script, task, or `test`-list entry was added.
- `npm test` green (9/9 turbo tasks), `oxfmt --check` clean on `unified.yaml`,
  `src/ReviewDoc.test.ts` and `src/OpenQuestions.test.ts` pass.
