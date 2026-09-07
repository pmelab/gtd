# Spec feedback — 03 Writing into a live worktree

The four findings from the previous round are all fixed and verified: `annotate`
carries the human's `text` verbatim and the result validates clean;
`localStorageDraftStorage` binds the real `window.localStorage` and has a test;
the anchor property is derived from the registry entry's own `sample`; the
whitespace-only hash case exists. What follows is new.

## 1. BLOCKER — the qa view never carries the question (T3, second criterion)

`OpenQuestions.ts#questionsView` maps `text: question.text`. `OpenQuestion.text`
is documented in that same file as "First non-blank body line (trimmed), or `""`
— a short summary for editor tooling". The actual question — the depth-3 heading
text — is `OpenQuestion.question`, and `questionsView` drops it.
`SteeringQaQuestionView` has no field for it either.

So a phone rendering the view has no way to display the question. Its own new
test enshrines the wrong value:

```
src/OpenQuestions.test.ts, "exposes both open and answered questions, in document order"
  expect(view.questions.map((q) => [q.status, q.text])).toEqual([
    ["open", "- [ ] Option A"],   // the fixture's question is "### First?"
    ["answered", "Already decided."],
  ])
```

`questionsOutline` in the same module gets this right —
`name: `${statusMarker(question)} ${question.question}``,
`detail: question.text`. The view should carry both, and the review side already
models it correctly (`SteeringChunkView` has `title` AND `description`).

## 2. T7 — the two reflow criteria are asserted against something that never reflows

`src/ModeContradiction.test.ts` proves both samples are already oxfmt fixed
points (`expect(formatted).toBe(format.sample)`). The two cases that follow —
"the server-written note is long enough to be reflowed at 80 columns, and still
validates after reflow" and "…contains a multi-word inline code span, and still
validates after reflow" — then assert `body.length > 80`, `endLine > line`, a
``/`[^`]*\s[^`]*`/`` match, and `validate(format.sample)`. Nothing in either
case runs the formatter over an unreflowed note, because the sample's note was
hand-written pre-wrapped in oxfmt's four-space form.

The risk T7 names is "a note the server writes gets reflowed before it is
committed". A server-written note arrives as ONE long unwrapped line — that is
the input oxfmt actually reflows, and it is the input no test feeds. The guard
as written cannot fail on the path it exists to guard.

I ran the real path by hand and it currently passes:
`annotate(sample, anchor, <150-char note with a multi-word code span>)` →
`applySteeringEdits` → real oxfmt → `validate` returns `[]` for the review hunk
anchor and all three qa anchors, and the formatter does reflow
(`post !== applied`). So this is a missing test, not a live bug — but the
criteria ask for the guard, and the fix is to assert that round-trip rather than
the sample's pre-wrapped state.

## 3. T8 — `id-collision` is reported to the phone as "anchor no longer resolves"

`serve/Write.ts#writeNote` collapses every non-`ok` `annotate` result into
`{ reason: "anchor-unresolved" }`:

```
const annotated = format.annotate(content, request.anchor, request.text)
if (!annotated.ok) return { ok: false, reason: "anchor-unresolved" }
```

`SteeringAnnotateResult` has two refusal reasons and `id-collision` is a real,
reachable one (T2 requires it: "two attaches at the same anchor are rejected").
The phone then renders `bannerFor`'s "What you were editing no longer exists in
this document" for a note that exists and resolved fine. The same line also
swallows the unknown-mode case above it, which is a third distinct condition
wearing the same label.

T8 asks that the four refusals be distinct typed values so the phone names which
one it got; two conditions that are neither a stale anchor nor a stale token are
currently being named as one.

## 4. T1 — `SteeringView` is a closed union of the two built-ins

T1's stated payoff is "a user-declared custom mode lights up the phone UI for
free once it registers a format", and its stated cost is that
`src/SteeringFormat.ts` "gains two union types and no imports".

What it gained is two unions plus seven interfaces, and one of the unions is
`SteeringView = SteeringReviewView | SteeringQaView` — the vocabulary file now
names the two built-in formats and closes over them. A third format's `view`
must claim `kind: "review"` or `kind: "qa"` and adopt that format's shape; it
cannot express its own projection without editing the file T1 promised would
only grow two union types. The payoff that justified widening the core interface
is not reachable through the interface as shipped.

(`SteeringAnchor`'s closed union is defensible — its doc comment argues the
kinds are format-agnostic container/child shapes. `SteeringView`'s is not: its
members are the two built-ins by name.)

## Verified clean, for the record

- T1: `src/SteeringFormat.ts` still has zero imports; both members non-optional;
  the anchor property is derived from `format.sample` and covers every anchor
  `view` reports; LSP behaviour unchanged
- T2: all seven criteria have cases and hold; CRLF round-trips with no mixed
  endings
- T3: the `na`-prefixed ids in both samples are the real derived ids — I
  re-checked by calling `annotate` at each anchor of each sample (review chunk 0
  → `id-collision` on `naduiqc4`; qa option 1 → `id-collision` on `na17v2bjb`),
  so "attached the way the server attaches one" is true, not just claimed
- T4, T5, T6: every criterion has a matching case; the per-path write queue does
  serialize a race; the rest gate is re-read per write
- `npm run test:unit` is green
