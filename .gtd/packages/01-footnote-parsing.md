# 01 — Footnotes are structure in the `qa` and `review` steering formats

## Requirement

**Both formats parse a footnote as an anchored comment, not as prose they
swallow.** A marker (`[^name]`) sits inline after a word or sentence; its
definition (`[^name]: …`, plus indented continuation lines) sits below the
paragraph, list, or hunk that carries the marker.

- A marker is anchored by line AND column, so the comment attaches to the word
  or sentence it follows, not just to the line
- Markers are recognised anywhere a human writes prose in either format: a
  question option, an answered-question paragraph, a chunk heading or
  description, a hunk pointer line, and a hunk's note
- **A definition is no longer absorbed into the thing above it** — a hunk's
  `note` and a question option's `text` both exclude it today only by accident,
  and must exclude it by rule
- Validation reports, positioned at the offending line: a marker with no
  definition, a definition no marker references, and a duplicate name. The
  orphan-definition finding is load-bearing, not cosmetic: footnotes are
  CONSUMED once folded in, so a half-deletion that drops the marker and leaves
  the definition must be caught by the validator, not left to rot
- The outline shows each footnote as a leaf under the node it annotates

**Risk: everything under `.gtd/` is oxfmt-formatted and covered by
`format:check`.** A footnote definition that is not an oxfmt fixed point reds
`start-gate`, `review-gate`, and `fix-precheck` alike, and past experience is
that a markdown reflow of a steering file deadlocks the review loop rather than
failing the agent. Pin a footnote-bearing sample through oxfmt in a test —
`SteeringFormat.sample` already exists for exactly this round-trip.

## Settled decisions this package implements

- The anchor is line plus column, nothing more. Never extract the annotated word
  or sentence — the agent that reads the file reads the prose itself
- A definition may sit anywhere in the document; marker and definition are
  matched by NAME alone. "Directly below the annotated block" is a convention,
  never a rule the parser enforces, so a hand-placed footnote can never refuse a
  turn. **There is deliberately no placement finding**
- Findings are blocking through the existing path — `validate` findings make
  `gtd check` exit non-zero, and a driver runs that ahead of `gtd land`. No new
  severity concept
- Footnotes do not nest, and scanning skips code
- Markers are stripped from every extracted text field

## Task 1 — the `src/Footnotes.ts` parsing module

Paths: `src/Footnotes.ts` (new), `src/Footnotes.test.ts` (new).

Import only `SteeringFinding` as a type from `src/SteeringFormat.ts`, so this
module stays as dependency-free as that one.

```ts
interface FootnoteMarker {
  readonly name: string
  readonly line: number       // 0-based
  readonly character: number  // 0-based column of the `[` — the anchor
}
interface FootnoteDefinition {
  readonly name: string
  readonly line: number       // 0-based line of the `[^name]:` line
  readonly endLine: number    // last continuation line; equals `line` when single-line
  readonly body: string       // continuation lines joined with a single space
}
interface Footnotes {
  readonly markers: readonly FootnoteMarker[]
  readonly definitions: readonly FootnoteDefinition[]
  readonly findings: readonly SteeringFinding[]
}
parseFootnotes(content: string): Footnotes
```

Also export the two helpers the format modules need: a predicate for "this line
is a footnote definition line" and a marker-stripping function for extracted
text.

Recognition rules:

- Marker: `[^name]` where `name` contains no whitespace and no `]`. Scanned per
  line
- Definition: `[^name]:` at COLUMN 0 only, then an optional same-line body, then
  the run of following indented non-blank lines. A blank line or an unindented
  line ends it
- Scanning skips fenced code blocks and inline-code spans
- A `[^name]` inside a definition's own body is ordinary text, not a marker

Acceptance criteria:

- [ ] `parseFootnotes` is total and side-effect-free — always returns a result,
      never throws, on any input including an empty string and a document of
      only backticks
- [ ] A marker mid-sentence yields the exact 0-based column of its `[`
- [ ] A single-line definition yields `endLine === line` and its same-line body
- [ ] A definition of the form `[^name]:` alone followed by FOUR-space-indented
      continuation lines yields the joined body and the correct `endLine` — four
      spaces, because that is what oxfmt emits (see Task 4)
- [ ] A two-space-indented continuation is accepted the same way
- [ ] A blank line ends a definition; an unindented line ends a definition
- [ ] `[^x]` inside a fenced ``` block produces no marker
- [ ] `` `[^x]` `` inside an inline-code span produces no marker
- [ ] `[^y]` written inside another definition's body produces no marker
- [ ] Two markers of the same name with one definition produce no finding
- [ ] Finding: a marker with no definition, reported at the MARKER's line
- [ ] Finding: a definition no marker references, reported at the DEFINITION's
      line
- [ ] Finding: a duplicate definition name, reported at the SECOND definition's
      line
- [ ] Finding: a definition whose body is still the seeded placeholder
      (`your comment`), reported at the definition's line
- [ ] No finding of any kind reports on placement — a definition far from its
      marker is valid

## Task 2 — wire footnotes into the `qa` format

Paths: `src/OpenQuestions.ts`, `src/OpenQuestions.test.ts`.

- `itemEndIndex` breaks on a definition line and on its continuation lines, so a
  definition below an option is never absorbed into that option's span
- `QuestionOption.text` strips markers BEFORE the free-text placeholder
  comparison
- `OpenQuestion.text` (the first non-blank body line) skips definition lines and
  strips markers
- `QA_FORMAT.validate` appends footnote findings
- Outline: each footnote is a `leaf: true` child of the node whose span contains
  its marker — an option when the marker is inside an option's span, otherwise
  the question. Name: `[^name] <body>`
- `QA_FORMAT`'s doc comment currently claims "its one finding is always
  positionless". **That claim becomes false — rewrite it.** This format now has
  positioned findings
- `QA_SAMPLE` grows one anchored footnote on an option, with a body exceeding 80
  characters

Acceptance criteria:

- [ ] An anchored footnote on an option parses with its anchor column, and the
      option's `text` excludes both the marker and the definition body
- [ ] A ticked free-text option written `_your answer_[^fn1]` still normalizes
      to `""`, so `answered` is still `false` — the marker must not defeat the
      placeholder comparison
- [ ] A definition on the line below an option is NOT part of that option's
      `endLine` span
- [ ] All four footnote findings surface through `QA_FORMAT.validate`, each with
      its `line` set
- [ ] The outline places a footnote leaf under the option whose span holds its
      marker, and under the question when the marker is in question-body prose
- [ ] `QA_FORMAT.validate(QA_FORMAT.sample)` returns zero findings — covered by
      the existing per-registry-entry assertion in `src/SteeringFormats.test.ts`

## Task 3 — wire footnotes into the `review` format

Paths: `src/ReviewDoc.ts`, `src/ReviewDoc.test.ts`.

- `pointerEndIndex` breaks on a definition line; `gatherNote` skips definition
  lines and their continuations. **This is the rule: a hunk's `note` excludes
  its footnote body by rule, not by accident**
- The span BREAKS at a definition and does not resume. **Risk: a human who
  hand-places a definition in the middle of a multi-paragraph hunk note silently
  truncates that note to its first paragraph, and the paragraphs after the
  definition are gathered into nothing.** It never refuses the turn — that is
  the accepted cost of matching by name alone
- `note` also has markers stripped
- `REVIEW_FORMAT.validate` appends footnote findings
- Outline: footnotes are `leaf: true` children of their chunk. **A chunk
  carrying at least one footnote stays in the outline even when every hunk is
  ticked** — `reviewOutline` filters fully-checked chunks out today, which would
  make a human's own comment vanish the moment they tick the last box
- `REVIEW_SAMPLE` grows one footnote anchored on a hunk note, with a body
  exceeding 80 characters
- `secondPointerError` needs no change — a marker is not a pointer token
- `clearFilePointerTicks` needs no change — its regex requires `-` at column 0
  and a definition line starts with `[`. Prove it rather than assume it

Acceptance criteria:

- [ ] A definition below a hunk pointer is excluded from that hunk's `note` and
      from its `endLine` span
- [ ] A marker in a hunk's inline note is stripped from `note` but still parses
      with its anchor column
- [ ] A definition between two hunk pointers is attributed to neither hunk's
      note, and the second hunk still parses
- [ ] A definition hand-placed mid-note truncates the note at that point and
      reports no finding — the documented, accepted behaviour
- [ ] All four footnote findings surface through `REVIEW_FORMAT.validate`, each
      with its `line` set
- [ ] The outline lists footnote leaves under their chunk, and a chunk whose
      every hunk is ticked still appears when it carries a footnote
- [ ] `clearFilePointerTicks` leaves a footnote definition line byte-identical
- [ ] `REVIEW_FORMAT.validate(REVIEW_FORMAT.sample)` returns zero findings

## Task 4 — pin the formatter round-trip

Paths: `src/SteeringFormats.test.ts`, and the two `sample` strings from Tasks 2
and 3.

The formatter is **oxfmt**, configured in `.oxfmtrc.json` with a `*.md` override
of `printWidth: 80`, `proseWrap: always`. Measured behaviour on real footnotes,
verified not assumed:

- A definition under 80 characters stays on one line, byte for byte
- A definition over 80 characters becomes `[^name]:` alone, then its body
  wrapped at 80 and indented FOUR spaces
- A marker inside a checkbox row, a hunk pointer, or a paragraph is never moved
  or rewritten
- A definition between two hunk pointers stays exactly where it was written
- An empty body (`[^name]:`) survives untouched

**Risk: a definition's four-space continuation collides with the review format's
own "indented exactly two spaces — never four or more, which reads as a code
block" note rule.** The two do not conflict in fact — a definition's
continuation is a footnote continuation, not a list continuation — but the
parser must accept four spaces there while the review-authoring prompt keeps
forbidding four for a NOTE. Do not relax that note rule.

Acceptance criteria:

- [ ] Both `sample` strings carry a footnote whose body exceeds 80 characters,
      so the existing `src/ModeContradiction.ts` round-trip through a mode's
      `format:` command exercises the wrapped four-space form
- [ ] Every file this package touches under `.gtd/` and `src/` passes
      `npm run format:check`
- [ ] `npm test` is green
