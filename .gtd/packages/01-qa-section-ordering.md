# 01 — Ordering rule for `qa` steering files: validator, prompt, docs

## Requirement

**The rule:** `## Open Questions` comes before every other `##` section of a Q&A
steering file, and `## Answered Questions` comes after every other `##` section.
Everything else sits between them.

**A title and lead prose above `## Open Questions` are fine.** The rule
constrains section order, not the first line of the file — a `#` title, an intro
paragraph, or both may precede the open-questions heading. Only a competing `##`
section may not.

**gtd reports the violation and stops there — it never moves the section.**
`gtd check qa`, `gtd validate`, and the LSP each emit a finding; the author does
the move. No code action, no auto-reorder, no new formatter hook. This matches
every other built-in format, which validates and never rewrites.

**Today nothing states or checks this.** The shared `questionBar` prompt says
open questions go under a heading "near the top" — vague, and it says nothing at
all about where the answered section goes. The `qa` parser finds both sections
by scanning for their headings anywhere in the file and sorts questions by line
number, so any order parses clean.

**Three things change together.** They are one concern because none of them has
a useful acceptance check on its own, and shipping the checker without the
prompt wording would red-light documents the prompt still tells agents to write:

- The `qa` format's validator gains two ordering findings — one for a `##`
  section that precedes `## Open Questions`, one for a `##` section that follows
  `## Answered Questions`.
- The shared prompt text that describes the format is reworded from "near the
  top" to the exact rule, and gains the matching sentence for
  `## Answered Questions` at the bottom. Both the first-lap and the return-lap
  halves of that shared text need it — the return lap is where a question
  actually MOVES from one section to the other, so that is where getting the
  destination position wrong is most likely.
- The user-facing description of the `qa` mode is updated to state the ordering
  rule, since it is now a thing a file can fail on.

**Acceptance:** `gtd check qa` on a file whose `## Answered Questions` precedes
its `## Open Questions` exits non-zero and names the ordering problem; the same
file with the two sections swapped exits 0 silently. Today the first case
exits 0.

**Settled decisions carried in:**

- A misplaced section is an **error**, not a warning. The `qa` format's findings
  channel carries no severity and every other structural problem it reports
  blocks; no warning level is invented for this one rule.
- A file with only one of the two sections, or neither, **passes**. The rule
  constrains the two sections' positions relative to everything else; a file
  missing one has nothing to violate.
- The rule applies to `qa` only, **not** to the `review` format — a review file
  has no question sections to order.
- The phase prompts that forbid open questions do **not** change. They are about
  whether questions exist, not where they sit.

## Technical plan

**The ordering scan is a new private function in `src/OpenQuestions.ts`, not a
new module.** It reads the same lines and reuses the same `parseHeading` the
question parser already uses, and it has no consumer outside `QA_FORMAT`.

Shape: walk every line, keep the ones `parseHeading` reports at level 2, note
the first index of `## Open Questions` and of `## Answered Questions` among
them. Emit at most one finding per rule — not one per offending section — so a
file with six stray sections above the open block reports one problem, not six.

**`parseOpenQuestions` is where the findings originate**, not
`QA_FORMAT.validate`. That keeps `validate` the same one-line map it is today
and keeps every finding this format produces reachable from the parser, the only
entry point `gtd lsp`, `gtd validate`, and `gtd check` all share.

**The findings are positionless, like every other finding this format
produces.** `OpenQuestionsDoc.errors` stays a `readonly string[]`, no type
widens, `QA_FORMAT`'s "always positionless" doc comment stays true, and
`gtd lsp` shows the diagnostic at the top of the file rather than on the
misplaced heading.

**The scan is fence-blind: a `## ` line inside a fenced code block counts as a
competing section.** It reuses the existing line walk, which already ignores
fenced runs everywhere else in this parser, so the ordering scan and
`splitQuestionBlocks` agree on what a heading is.

**`src/SteeringFormat.ts` stays untouched.** `SteeringFinding` already carries
everything a positionless message needs.

**`## Answered Questions` placed above `## Open Questions` fires both
findings.** Each names a distinct rule and the second is not noise — the author
has to move one of them and the pair says which two positions are wrong.

**Nothing new enters the dependency tree.** No markdown library for a rule this
small; pulling one in would change how every existing finding is produced.

**Total and non-throwing, like the rest of the parser.** The scan returns
findings; it never throws and never rewrites the file. Exit behaviour is
inherited unchanged: `gtd check qa` prints each finding one per line on stderr
and exits non-zero, `gtd validate` folds them into its report, `gtd lsp`
surfaces them as diagnostics.

**No new turbo task and no new `inputs` entry.** `src/**` and `docs/**` are
already declared inputs of `test:unit` and both e2e tasks.

`docs/cli.md` needs no edit: its `## Commands` block is pinned to rendered help
output, and `gtd check`'s help text names modes, not a mode's rules.

## Risks

**One doc comment currently promises the opposite and must be rewritten in the
same change.** `parseOpenQuestions`'s comment says questions are returned in
document order "regardless of which section comes first" — false the moment
reverse order is a finding.

**Fence-blindness costs a real false positive: a `qa` file that quotes a
markdown example containing a `## ` heading now fails the ordering rule.** No
current fixture does this, but a future document that pastes a markdown snippet
will red its own gate with no way to escape the heading.

**The steering files this workflow itself writes are `qa`-mode files this rule
now judges**, and everything under the state directory is oxfmt-formatted and
covered by `format:check`. A prompt that produces a file failing the new rule
deadlocks its own gate — which is why the prompt wording ships in this same
package.

**No existing fixture breaks.** All nine files carrying either heading put lead
prose, never a `##` section, above `## Open Questions`, and every file carrying
`## Answered Questions` puts it last. `QA_SAMPLE` — prose, then
`## Open Questions` — stays valid, so `src/SteeringFormats.test.ts`'s
clean-sample assertion holds.

## Tasks

### Task 1 — Ordering findings in the `qa` parser

Paths: `src/OpenQuestions.ts`, `src/OpenQuestions.test.ts`

- [ ] `parseOpenQuestions` reports a finding when any `##` section precedes
      `## Open Questions`, naming the ordering problem
- [ ] `parseOpenQuestions` reports a finding when any `##` section follows
      `## Answered Questions`, naming the ordering problem
- [ ] At most one finding per rule, whatever the number of offending sections
- [ ] A file whose `## Answered Questions` precedes its `## Open Questions`
      reports both findings
- [ ] A file with only `## Open Questions`, only `## Answered Questions`, or
      neither reports no ordering finding
- [ ] Lead prose and a `#` title above `## Open Questions` report no finding
- [ ] `OpenQuestionsDoc.errors` is still `readonly string[]` and
      `QA_FORMAT.validate` is still its one-line map
- [ ] `parseOpenQuestions`'s doc comment no longer claims document order holds
      "regardless of which section comes first"
- [ ] `QA_SAMPLE` still validates clean, so `src/SteeringFormats.test.ts`'s
      clean-sample assertion passes

### Task 2 — `gtd check qa` acceptance scenarios

Paths: `tests/integration/features/check.feature`

- [ ] A scenario whose file has `## Answered Questions` before
      `## Open Questions`: `gtd check qa` fails, stdout is empty, stderr names
      the ordering problem
- [ ] A scenario with the same two sections swapped: `gtd check qa` succeeds and
      stdout is empty
- [ ] Both use the composable `Given a file "..." with:` step, with the actual
      markdown visible in the scenario text — no one-off setup step

### Task 3 — Shared prompt wording

Paths: `src/workflows/unified.yaml`, `src/workflows/templates.test.ts`

- [ ] `questionBar`'s "under a `## Open Questions` heading near the top" is
      replaced by the exact rule: before every other `##` section
- [ ] `questionBar` gains the matching sentence placing `## Answered Questions`
      after every other `##` section
- [ ] `questionBarReturn` states the same destination rule for the section a
      question moves into on the return lap
- [ ] `src/workflows/templates.test.ts` pins the new wording, and its existing
      checkbox few-shot pins still pass
- [ ] Both vars stay plain `vars:` entries, overridable via config or env — no
      engine-side wiring added

### Task 4 — User-facing `qa` mode description

Paths: `docs/configuration.md`

- [ ] The "Built-in steering formats are ordinary modes" section states the
      ordering rule as something a `qa` file can fail on
- [ ] The `questionBar` bullet under "Variables" states the ordering rule too
- [ ] `docs/cli.md` is unchanged, and its pinned `## Commands` block and
      exit-code table still match the rendered help
- [ ] `npm test` passes with no new `turbo.json` task or `inputs` entry
