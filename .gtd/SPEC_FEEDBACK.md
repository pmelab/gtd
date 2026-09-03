# Spec feedback — 02 `qa` format on the tree

Most of the package holds up: `CHECKBOX_RE`, `itemEndIndex`, `lines.findIndex`
and `raw.indexOf("[")` are gone from `src/OpenQuestions.ts`; the fenced
`## Open Questions` case, the exact box offset, the lazy-wrap `endLine`, the
footnote-definition span, the code actions and both cucumber scenarios are
covered and the full suite (`unit`, `e2e:inmem`, typecheck, lint, format,
deadcode) is green.

Two acceptance criteria of the strict-reading task are NOT met.

## 1. A 4+ space option written under a prose line is lost with NO finding

Spec: "a file relying on the loose reading loses that question or option and
says so with a positioned finding, not silently".

`strictReadingFindings` (`src/OpenQuestions.ts`) only inspects top-level `code`
nodes. A 4-space-indented `- [ ]` that directly follows a non-blank prose line
is a LAZY PARAGRAPH CONTINUATION, not a `code` node, so nothing fires.

Reproduce — `parseOpenQuestions` on:

```
## Open Questions

### Which API?

Pick one:
    - [ ] REST
```

gives `options: []` and `errors: []`. Under the loose reading (old
`CHECKBOX_RE`, indent-tolerant, line-based) that line WAS an option. The option
is gone and the file validates clean; the question just reads as unanswered.

The e2e scenario in `tests/integration/features/check.feature` misses this
because it puts a blank line above the indented option, which does make a `code`
node.

## 2. Same hole for a 4+ space `### ` heading

```
## Open Questions

### Real?

prose here
    ### four spaces

x
```

`errors: []`. The whole second question vanishes with no signal — the exact
outcome the criterion "a file relying on the loose reading loses that question …
and says so with a positioned finding" forbids.

Both cases need a check that does not depend on the dropped line having become a
`code` node (e.g. also scan `paragraph` nodes' own source lines inside a
questions section for `HEADING_SHAPE_RE`/`OPTION_SHAPE_RE` hits past column 3),
plus a unit test each and one `.feature` scenario with prose directly above the
indented option.

## Secondary — same defect class, outside the spec's literal criteria

- A 4-space `- [ ]` nested under a real option (`- [ ] REST` then
  `    - [ ] deep`) becomes a nested `listItem`, not a `code` node:
  `optionListItems` deliberately skips it, so it is silently not an option
  either. Loose reading counted it. Decide and record: signal, or documented as
  intentional.
- A 4-space-indented `## Open Questions` heading now parses to `code`, so the
  section is not found at all — every question in the file disappears and
  `unansweredQuestions` returns `[]`, i.e. the answer-completeness gate passes
  on a file full of unanswered questions. `strictReadingFindings` checks only
  `###` and `- [ ]` shapes, and only INSIDE an already-found section, so no
  finding is possible for this one by construction.
- `src/OpenQuestions.test.ts`'s "toggles the box, not a '[' in the option's own
  text" uses `- [ ] [priority] Ship it`, where the box is still the FIRST `[` on
  the line — old `raw.indexOf("[")` got that right too. The criterion's "the
  case `raw.indexOf("[")` gets wrong" is not exercised (and may not exist, since
  `CHECKBOX_RE` anchored the box as the first bracket). The implementation is
  exact; only the test's claimed intent overreaches.
