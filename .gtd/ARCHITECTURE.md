Footnotes become gtd's anchored-comment mechanism: one new parsing module both
built-in steering formats consume, prompt changes on the feedback path, and an
LSP code action plus a two-way jump. Three concerns, in build order, no merges.

## 1. Footnotes are structure in the `qa` and `review` steering formats

**One new module, `src/Footnotes.ts`, parses footnotes once; both formats
consume it.** It imports only `SteeringFinding` as a type, so it stays as
dependency-free as `src/SteeringFormat.ts` itself.

### Data model

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

`parseFootnotes` is total and side-effect-free, like `parseOpenQuestions` and
`parseReviewDoc` — always a result, never a throw.

**The anchor is line plus column, nothing more.** The module never extracts the
annotated word or sentence; the agent that reads the file reads the prose
itself.

### Recognition rules

- Marker: `[^name]` where `name` has no whitespace or `]`. Scanned per line
- Definition: `[^name]:` at COLUMN 0 only, then optional same-line body, then
  the run of following indented non-blank lines. A blank line or an unindented
  line ends it
- **A definition may sit anywhere in the document; a marker and a definition are
  matched by NAME alone.** "Directly below the annotated block" is where the
  code action puts one, never a rule the parser enforces — so a hand-placed
  footnote can never refuse a turn
- **Scanning skips fenced code blocks and inline-code spans.** A document that
  QUOTES footnote syntax in backticks — `docs/configuration.md`'s own examples,
  and every planning file that discusses this feature — must not trip the
  validator. Without this the validator is a footgun on its own steering files
- A marker inside a definition's own body is not a marker. Footnotes do not nest

### oxfmt behaviour, verified not assumed

Everything under `.gtd/` is oxfmt-formatted at `printWidth: 80`,
`proseWrap: always`. Measured on this repo's `.oxfmtrc.json`:

- A definition under 80 characters stays on one line, byte for byte
- A definition over 80 characters becomes `[^name]:` alone, then its body
  wrapped at 80 and indented **four spaces** — so the parser must accept a
  four-space continuation, not just two
- A marker inside a checkbox row, a hunk pointer, or a paragraph is never moved
  or rewritten
- A definition between two hunk pointers stays exactly where it was written
- An empty body (`[^name]:`) survives untouched

**Risk: a definition's four-space continuation collides with the review format's
own "indented exactly two spaces — never four or more, which reads as a code
block" rule.** The two do not conflict in fact — a definition's continuation is
a footnote continuation, not a list continuation — but the parser must accept
four spaces there while `build.review.reviewing`'s prompt keeps forbidding four
for a NOTE. Both `sample` strings grow a footnote whose body exceeds 80
characters, so `src/ModeContradiction.ts`'s round-trip through the mode's
`format:` command catches any future formatter that breaks this.

### Findings, all positioned

| Finding                                                 | Line it reports at           |
| ------------------------------------------------------- | ---------------------------- |
| A marker with no definition                             | the marker's line            |
| A definition no marker references                       | the definition's line        |
| A duplicate definition name                             | the second definition's line |
| A definition whose body is still the seeded placeholder | the definition's line        |

**There is deliberately no placement finding.** Those four are the whole set.

**The orphan-definition finding is load-bearing.** Footnotes are consumed once
folded in, so a half-deletion that drops the marker and leaves the definition
must refuse the turn rather than rot. `validate` findings make `gtd check` exit
non-zero, and a driver runs that ahead of `gtd land`, so a half-deleted footnote
blocks landing — which is the point.

Repeated markers for one definition stay legal: markdown allows many references
to one definition.

### Wiring into `qa` (`src/OpenQuestions.ts`)

- `itemEndIndex` breaks on a definition line and on its continuation lines, so a
  definition below an option is never absorbed into that option's span
- `QuestionOption.text` strips markers BEFORE the free-text placeholder
  comparison, so `_your answer_[^fn1]` still normalizes to `""` and a
  ticked-but-unfilled slot still reads as unanswered
- `OpenQuestion.text` (the first non-blank body line) skips definition lines and
  strips markers
- `QA_FORMAT.validate` appends footnote findings. **Its doc comment's "its one
  finding is always positionless" claim becomes false and must be rewritten** —
  this format now has positioned findings
- Outline: each footnote is a `leaf: true` child of the node whose span contains
  its marker — an option when the marker is inside an option's span, otherwise
  the question. Name: `[^name] <body>`
- `QA_SAMPLE` grows one anchored footnote on an option

### Wiring into `review` (`src/ReviewDoc.ts`)

- `pointerEndIndex` breaks on a definition line; `gatherNote` skips definition
  lines and their continuations. **This is the rule the requirement demands: a
  hunk's `note` excludes its footnote body by rule, not by accident**
- The span BREAKS at a definition and does not resume. **Risk: a human who
  hand-places a definition in the middle of a multi-paragraph hunk note silently
  truncates that note to its first paragraph, and the paragraphs after the
  definition are gathered into nothing.** It never refuses the turn — that is
  the accepted cost of matching by name alone — and the code action never
  creates the situation, because it always writes below the whole hunk span
- `note` also has markers stripped, so the outline and the feedback prompts read
  clean prose
- `secondPointerError` is untouched — a marker is not a pointer token
- `clearFilePointerTicks` is untouched — `FILE_POINTER_TICK_RE` requires `-` at
  column 0, and a definition line starts with `[`
- Outline: footnotes are `leaf: true` children of their chunk. **A chunk
  carrying at least one footnote stays in the outline even when every hunk is
  ticked** — today `reviewOutline` filters fully-checked chunks out, which would
  make a human's own comment vanish from the outline the moment they tick the
  last box
- `REVIEW_SAMPLE` grows one footnote anchored on a hunk note

`SteeringFormat`'s `validate` and `outline` signatures do not change. This
concern touches no seam.

### Primary paths

`src/Footnotes.ts` (new), `src/Footnotes.test.ts` (new), `src/OpenQuestions.ts`,
`src/OpenQuestions.test.ts`, `src/ReviewDoc.ts`, `src/ReviewDoc.test.ts`.

### Acceptance

`src/OpenQuestions.test.ts` and `src/ReviewDoc.test.ts`: an anchored footnote
parses with its anchor column; all four findings fire at the right lines; a
hunk's note excludes its footnote body; an option's placeholder still normalizes
with a marker appended. Plus `src/SteeringFormats.test.ts`'s existing
`validate(sample)`-is-clean assertion, which now covers a footnote-bearing
sample in both formats. All fail before, pass after.

## 2. Agents read a footnote as a comment on its anchor

**Two new shared `vars:` entries in `src/workflows/unified.yaml`, because the
human-facing and agent-facing text have different audiences and different
content.** No engine change — a workflow is data.

- `footnoteRules` — how a human types one, and where the body goes. Injected
  into the three human-gate messages: `build.review.await-review`,
  `design.gate.answer`, `architecture.gate.answer`. The two gate messages come
  from `questionGate`'s `$message` param, so each instance injects the tag in
  its own `with:` block
- `footnoteFoldIn` — a footnote is a comment about its exact anchor, is a
  mandatory concern described against that anchor's hunk or paragraph, is
  DELETED marker-and-definition-together in the turn that folds it in, and is
  human input the agent never writes. Injected into the three agent prompts that
  read a footnote-bearing file: `build.review.collecting`, `design.triage`,
  `architecture.author`

**`build.review.reviewing` — the one state that WRITES a review file —
references neither tag.** That is how "no prompt ever tells an agent to write a
footnote" becomes enforceable rather than aspirational.

### Pins in `src/workflows/templates.test.ts`

Table-driven by name and count, matching the existing `styleBlock` pin pattern
so a seventh injection site added later fails loudly:

- `footnoteRules` wired into exactly those three human-message states, nowhere
  else
- `footnoteFoldIn` wired into exactly those three agent prompts, nowhere else
- `build.review.reviewing`'s compiled content references neither
- `footnoteFoldIn` carries the human-input-only sentence and the
  delete-in-the-same-turn sentence, checked structurally

### Evals

- `evals/cases/build-review-collecting.mjs` grows a third variant whose
  `.gtd/REVIEW_RAW.md` narrative quotes a footnote anchored on one named hunk,
  in the same inline-quoted style the existing `violation` variant uses. Its
  grader checks the written concern names that hunk's path — reusing the
  existing `plantedIdentifier` machinery — rather than a generic whole-file
  remark
- `evals/cases/design-triage.mjs` gets a variant seeding `.gtd/REQUIREMENTS.md`
  with a footnote; its grader asserts the REQUIREMENTS.md the turn wrote
  contains no `[^`. **Deletion is graded here, not in `collecting`** —
  `collecting` never touches a footnote-bearing file it also rewrites, so it
  cannot demonstrate consumption

### Docs

`docs/configuration.md`'s "Built-in steering formats are ordinary modes" section
gains the footnote syntax a human types: marker shape, definition shape, where
the body goes, and the four findings. `README.md`'s LSP paragraph gains the code
action and the two-way jump. **Nothing about how the parser is built** — per
this repo's documentation rule.

### Primary paths

`src/workflows/unified.yaml`, `src/workflows/templates.test.ts`,
`evals/cases/build-review-collecting.mjs`,
`evals/asserts/build-review-collecting.mjs`, `evals/cases/design-triage.mjs`,
`evals/asserts/design-triage.mjs`, `docs/configuration.md`, `README.md`.

### Acceptance

`src/workflows/templates.test.ts` pins the wiring table and the negative pin on
`build.review.reviewing`. The two eval cases grade anchor-specific concerns and
consumption. All fail before, pass after.

## 3. `gtd lsp` writes and navigates footnotes

**The `SteeringFormat` seam widens in two ways, both additive.**

### Seam changes (`src/SteeringFormat.ts`)

- `pointerAt` takes a position, not a line:
  `(content, position: {line, character}) => SteeringPointer | undefined`.
  `reviewPointerAt`'s existing hunk jump ignores `character`, so the change is
  mechanical there
- `SteeringPointer.path` becomes optional. **Absent means "this same document"**
  — the minimal shape that carries a footnote jump without a discriminated union
- `SteeringPointer` gains an optional `character`, defaulting to 0, so a jump
  can land on a marker's exact column
- `src/Lsp.ts`'s `definition` passes the whole `position` through, and
  `toLocation` uses the document's own URI when `path` is absent and the
  pointer's `character` for the range

`actions` already receives a range carrying `character` — no change there.

### The code action, in both formats

Title: `gtd: add a footnote`. Two edits in one `SteeringAction`.

**Marker column, one rule, no branching: scan right from the cursor while the
character is a word character, and insert there.** That satisfies both sketch
cases at once — cursor inside a word lands the marker at the word's end, cursor
already just past the word lands it at the cursor.

Name generation: `fn1`, `fn2`, … the first integer unused by any marker or
definition in the document. Deterministic — no clock, no randomness — so the
action is testable and idempotent under re-run.

Definition body: seeded `your comment`, not empty. **An empty body is
oxfmt-stable (verified) but invisible; a seeded placeholder is findable.** The
validator reports a definition still carrying the placeholder as a finding, so a
never-filled footnote can never reach an agent as a concern — the same mechanism
`FREE_TEXT_PLACEHOLDER` already uses for an unfilled answer slot.

**Definition placement: below the whole block the marker sits in — for a
`review` hunk, the last non-blank line before the next pointer or `##` heading;
for a list, the last line of the contiguous list; otherwise the next blank line
or EOF.** Never below the current paragraph alone: inside a multi-paragraph hunk
note that would split the note span. The definition may therefore sit several
paragraphs away from its marker, which is what go-to-symbol exists for.

### Go-to-symbol, both directions

`pointerAt` resolves, in this order:

1. Cursor within a marker's `[^name]` span → the definition's line, same
   document
2. Cursor on a definition line → the FIRST marker of that name, at its exact
   column, same document
3. `review` only: the existing hunk-pointer jump to another file

Footnotes are checked first because they are column-scoped and the hunk jump is
line-scoped; a marker sitting in a hunk's inline note would otherwise be
shadowed. `qa` gains a `pointerAt` it never had — footnote jumps only.

Error handling: an orphan marker or orphan definition resolves to `undefined`,
so `definition` returns an empty `Location[]`. The LSP never throws on a
half-written footnote; the diagnostic from concern 1 is what tells the human.

### Primary paths

`src/SteeringFormat.ts`, `src/Lsp.ts`, `src/Lsp.test.ts`,
`src/OpenQuestions.ts`, `src/ReviewDoc.ts`,
`tests/integration/features/lsp.feature`.

### Acceptance

`src/Lsp.test.ts` covers the widened seam and both jump directions against a
fake `LspEnv`. `tests/integration/features/lsp.feature` gains a scenario that
drives the code action over real stdio JSON-RPC, then a
`textDocument/ definition` round trip marker → definition → marker. All fail
before, pass after.

## Merged Concerns

None. Concern 2's footprint (`unified.yaml`, evals, docs) does not touch
concerns 1 or 3 at all. Concerns 1 and 3 both edit `src/OpenQuestions.ts` and
`src/ReviewDoc.ts`, but concern 3 only CONSUMES the `parseFootnotes` interface
concern 1 creates — exactly the build-on-top exception to the merge rule.
Merging them would collapse a parse-then-drive sequence into one blob and delete
the natural acceptance boundary between them.

## Answered Questions

### Does the parser expose the annotated word or sentence, or only line and column?

Line and column only. The requirement states the anchor IS line and column; the
agent that receives the file reads the surrounding prose itself, so an extracted
`anchorText` field would be a second source of truth for the same fact.

### Does footnote scanning have to be aware of code fences and inline code?

Yes, both. Without it, any steering file that quotes footnote syntax in
backticks — including every planning file that discusses this feature — trips
the orphan-marker finding and blocks its own landing.

### Do footnotes nest?

No. A `[^name]` inside a definition's body is ordinary text, not a marker.

### Does a footnote's marker stay in a hunk's `note` and an option's `text`?

No — stripped from both. The marker is positional metadata; leaving it in the
extracted text pushes syntax into the outline and into every prompt that reads
those fields.

### Does a fully-ticked chunk carrying a footnote stay in the review outline?

Yes. `reviewOutline` filters fully-checked chunks out today, which would hide a
human's own comment the instant they tick the last box. A footnote keeps its
chunk visible.

### Are footnote findings blocking, or advisory?

Blocking, via the existing path — `validate` findings make `gtd check` exit
non-zero, and a driver runs that ahead of `gtd land`. No new severity concept.

### Does the "add a footnote" action seed a body, or leave it empty?

Seeds `your comment`. An empty definition is oxfmt-stable but invisible in an
80-column reflowed document. The seeded text is reported by the validator until
replaced, so an unfilled footnote never reaches an agent.

### Do concerns 1 and 3 merge, since both edit the two format modules?

No. Concern 3 consumes the interface concern 1 creates, which the merge rule
exempts explicitly.

### Where does the "add a footnote" code action put the definition when the cursor sits inside a review hunk's multi-paragraph note?

Below the whole hunk span — the last non-blank line before the next pointer or
`##` heading. The note stays intact. The definition may sit several paragraphs
away from its marker, and go-to-symbol covers that distance.

### Is "the definition sits directly below its annotated block" a validated rule or only where the code action puts it?

Code-action convention only. The parser accepts a definition anywhere and
matches it to its marker by name alone, so a hand-placed footnote never refuses
a turn. No placement finding exists, and no block-ownership parsing is built —
which also removes the deadlock risk of a placement rule disagreeing with oxfmt.
