# Architecture

## Open Questions

### Does an ordering finding carry the offending heading's line number, or is it positionless like every other `qa` finding?

- [x] Positionless — keep `OpenQuestionsDoc.errors` a `readonly string[]` and
      `QA_FORMAT.validate` its current one-line map. Smallest change; the LSP
      shows the diagnostic at the top of the file.
- [ ] Line-anchored — widen `errors` to `readonly SteeringFinding[]` and point
      each finding at the misplaced `##` heading, so `gtd lsp` underlines the
      actual section. Costs a type change and a rewrite of the "always
      positionless" doc comment on `QA_FORMAT`.
- [ ] _your answer_

### Does a `##` heading inside a fenced code block count as a competing section?

- [x] Fence-blind — reuse the existing line scan, which already ignores fences
      everywhere else in this parser. Consistent with `splitQuestionBlocks`, but
      a plan that quotes a markdown example containing `## ` now fails.
- [ ] Fence-aware for the ordering scan only — track ``` / ~~~ runs and skip
      headings inside them. Kills the false positive; makes the ordering scan
      disagree with the block scan about what a heading is.
- [ ] _your answer_

## Concern 1 — Ordering rule for `qa` steering files: validator, prompt, docs

**One package.** All three changes land together — the checker, the prompt
wording, and the mode's user-facing description — because none has an acceptance
check on its own and shipping the checker alone red-lights files the prompt
still tells agents to write.

### File footprint

- `src/OpenQuestions.ts` — the ordering scan, the two findings, the corrected
  parser doc comment
- `src/OpenQuestions.test.ts` — unit coverage for the scan
- `src/workflows/unified.yaml` — `questionBar` and `questionBarReturn` wording
- `src/workflows/templates.test.ts` — the pins on that wording
- `docs/configuration.md` — the built-in-formats section, and the `questionBar`
  variable's own description
- `tests/integration/features/check.feature` — the two acceptance scenarios

### Module structure

**The ordering scan is a new private function in `src/OpenQuestions.ts`, not a
new module.** It reads the same lines and reuses the same `parseHeading` the
question parser already uses, and it has no consumer outside `QA_FORMAT`.
`src/SteeringFormat.ts` stays untouched — its `SteeringFinding` already carries
an optional `line`, so no vocabulary change is needed either way.

Shape: walk every line, keep the ones `parseHeading` reports at level 2, note
the first index of `## Open Questions` and of `## Answered Questions` among
them. Emit at most one finding per rule — not one per offending section — so a
file with six stray sections above the open block reports one problem, not six.

**`parseOpenQuestions` is where the findings originate**, not
`QA_FORMAT.validate`. That keeps `validate` the same one-line map it is today
and keeps every finding this format produces reachable from the parser, which is
the only entry point `gtd lsp`, `gtd validate`, and `gtd check` all share.

### Data model

`OpenQuestionsDoc` keeps its two fields. `questions` is untouched — ordering is
a document-level property and produces no question. `errors` either stays
`readonly string[]` or widens to `readonly SteeringFinding[]`, decided by the
first open question above. The widening is safe: `errors` has exactly one
non-test consumer today, `QA_FORMAT.validate`.

**A file with only one of the two sections, or neither, produces no ordering
finding.** The scan skips a rule whose anchor heading is absent.

**`## Answered Questions` placed above `## Open Questions` fires both
findings.** Each names a distinct rule and the second is not noise — the author
has to move one of them and the pair says which two positions are wrong.

### Library and tech-stack choices

**Nothing new.** The scan is a regex-free reuse of `parseHeading`, which is
already the module's only heading recogniser. No markdown library enters the
dependency tree for a rule this small — pulling one in would also change how
every existing finding is produced.

### Error-handling strategy

**Total and non-throwing, like the rest of the parser.** The scan returns
findings; it never throws and never rewrites the file. Exit behaviour is
inherited unchanged: `gtd check qa` prints each finding one per line on stderr
and exits non-zero, `gtd validate` folds them into its own report, `gtd lsp`
surfaces them as diagnostics. **No code action, no auto-reorder, no formatter
hook** — the author moves the section.

**The `qa` format's findings channel carries no severity, so a misplaced section
blocks the gate like every other structural problem.** No warning level is
invented for it.

### Prompt wording

`questionBar`'s "under a `## Open Questions` heading near the top" becomes the
exact rule — before every other `##` section — and gains the matching sentence
placing `## Answered Questions` after every other `##` section.
`questionBarReturn` gains the same destination rule, since the return lap is
where a question actually moves between the two sections and where getting the
destination wrong is most likely.

Both are `vars:` in `src/workflows/unified.yaml`, overridable via `.gtdrc`
`vars:` or `GTD_QUESTIONBAR` — no engine wiring to trace, and
`src/workflows/templates.test.ts` is what tells you which pins broke.

### Documentation

`docs/configuration.md`'s **"Built-in steering formats are ordinary modes"**
section gains the ordering rule, because it is now a thing a file can fail on.
The `questionBar` bullet under **Variables** gains it too, since that bullet
describes what the shared block says.

`docs/cli.md` needs no edit: its `## Commands` block is pinned to rendered help
output, and `gtd check`'s help text names modes, not a mode's rules.

**No new turbo task.** `docs/**` is already in `test:unit`'s and both e2e tasks'
`inputs`, so a docs edit invalidates the cache correctly.

### Test strategy

Unit, in `src/OpenQuestions.test.ts`: a section above the open block, a section
below the answered block, the reversed pair, each section missing, and a clean
file.

E2e, in `tests/integration/features/check.feature`, using composable
`Given a file "..." with:` steps that show the actual markdown in the scenario
text — one scenario where `## Answered Questions` precedes `## Open Questions`
and `gtd check qa` fails naming the ordering problem, one where the swap exits 0
silently.

### Risks

**One doc comment currently promises the opposite and must be rewritten in the
same change.** `parseOpenQuestions`'s comment says questions are returned in
document order "regardless of which section comes first" — false the moment
reverse order is a finding.

**`.gtd/REQUIREMENTS.md` and `.gtd/ARCHITECTURE.md` are themselves `qa`-mode
files this rule now judges**, and `.gtd/` is oxfmt-formatted and covered by
`format:check`. A prompt that produces a file failing the new rule deadlocks its
own gate — which is why the prompt wording ships in the same package.

**No existing fixture breaks.** All nine files carrying either heading put lead
prose, never a `##` section, above `## Open Questions`, and every file carrying
`## Answered Questions` puts it last. `QA_SAMPLE` — prose, then
`## Open Questions` — stays valid, so `src/SteeringFormats.test.ts`'s
clean-sample assertion holds.

## Answered Questions

### Where does the ordering check live — a new module, or inside the existing `qa` parser?

Inside `src/OpenQuestions.ts`. It reuses `parseHeading` and the same line split,
and has no consumer outside `QA_FORMAT`; a separate module would be a file that
only re-imports its neighbour.

### Does the check emit one finding per offending section, or one per broken rule?

One per broken rule, at most two per file. A file with several stray sections
has one problem to fix, and per-section findings would bury it.

### Does `SteeringFormat.ts` need a new vocabulary type for this?

No. `SteeringFinding` already carries an optional `line`, which covers both
answers to the position question above.

### Is any new dependency needed to recognise a heading?

No. `parseHeading` is already the module's heading recogniser; a markdown
library would change how every existing finding is produced for no gain.

### Does `docs/cli.md` need an edit?

No. Its `## Commands` block and exit-code table are pinned to generated output,
and `gtd check`'s help names the modes, not each mode's rules.

### Does this need a new turbo task or `inputs` entry?

No. `docs/**` and `src/**` are already declared inputs of `test:unit` and both
e2e tasks, so both edited surfaces invalidate the cache.
