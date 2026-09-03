# Spec feedback — 02 The `qa` format on the tree

Two problems. The first is a false validation failure on a legitimate file; the
second is a code-action insertion point that does not match the criterion.

## 1. `strictReadingFindings` fires inside a `footnoteDefinition` body — a false refusal

`src/OpenQuestions.ts`: `recognizedStructureLines` excludes only top-level
depth-2/3 headings and top-level task items. Lines inside a `footnoteDefinition`
are excluded by nothing, and this repo's own footnote style indents definition
bodies four spaces (see `QA_SAMPLE`). So any `- [ ]`- or `### `-shaped line a
human writes inside their own footnote comment is reported as a dropped
option/heading.

Reproduce — `QA_FORMAT.validate` returns one finding at line 10, so
`gtd check qa` / `gtd validate` fails:

```
## Open Questions

### Q?

- [ ] A[^fn1]
- [ ] _your answer_

[^fn1]:
    I considered writing it as

    - [ ] a checkbox

    but decided against it.
```

Message emitted:
`An indented (4+ space) "- [ ] a checkbox" is markdown indented code (or a lazy paragraph continuation), not an option — it is silently dropped otherwise`.

Both halves are wrong. It is neither indented code nor a lazy continuation — it
parses as a real `listItem` inside a real `footnoteDefinition` — and it was
never an option under any reading, so nothing is being "silently dropped". The
refusal exists to catch content lost from the format's output; a footnote body
is not that. Every existing test stays green because no fixture puts a checkbox
or `###` shape inside a footnote body.

Note the blast radius: footnotes are the human's comment channel on an option,
the one place a person is likely to quote the option syntax back, and a finding
here reds every gate that runs `validate`.

## 2. "add a footnote" span is not the contiguous list's

The criterion says the insertion point is "the whole contiguous list's own
span", and that prose above a list resolves to the containing block node.
`footnoteBlockEnd` instead uses `question.options[0].sourceLine` through
`options[last].endLine` — one range over EVERY option in the question,
regardless of how many separate lists they came from.

With two option lists in one question, a cursor in the prose between them
resolves to the end of the SECOND list rather than to that prose paragraph:

```
## Open Questions

### Q?

- [ ] A
- [ ] B

prose between

- [ ] C
- [ ] _your answer_
```

Cursor on `prose between` (line 7) plants the definition after line 11. It
should resolve to the containing block node, per the second criterion of "Task —
code actions off the tree". Resolve the span from the `list` node the cursor is
actually inside, not from the question's option range. No test covers a question
with two lists.
