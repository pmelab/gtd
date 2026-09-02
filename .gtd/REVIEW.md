# Review: cf85e1f

<!-- base: db1ce002a83d2099474f250a8a49401753eb6968 -->

## The footnote parser — new core module

A new `src/Footnotes.ts` owns the whole `[^name]` / `[^name]:` syntax: parsing,
validation findings, the "add a footnote" edits, and the same-document jump.
Both steering formats delegate to it instead of each growing their own copy.

- [ ] ./src/Footnotes.ts#28 — the three regexes that define the syntax
      Definitions must start at column 0; a marker's name rejects whitespace and
      `]`. Fenced code blocks and inline-code spans are excluded, with inline
      code blanked (not removed) so marker columns stay accurate.

- [ ] ./src/Footnotes.ts#73 — `isFootnoteDefinitionLine` recomputes fence state
      on every call It calls `computeFenceSkip(lines)` — a full O(n) scan of the
      document — each time it is asked about one line. `ReviewDoc.ts` and
      `OpenQuestions.ts` call it from inside their per-line parse loops
      (`itemEndIndex`, `pointerEndIndex`, `gatherNote`, `parseChunkBody`),
      making document parsing O(n²). A 2000-line `.gtd/REVIEW.md` costs ~4M line
      tests per parse, and the LSP re-parses on every keystroke. Worth hoisting
      the fence array to the caller.

- [ ] ./src/Footnotes.ts#128 — placeholder check is case-insensitive, the docs
      say "literal" `def.body.trim().toLowerCase() === PLACEHOLDER_BODY` accepts
      `Your Comment` as unfilled. `docs/configuration.md` promises the check
      fires on "the literal seeded placeholder text `your comment`". Decide
      which is true and make the other match — a human who deliberately writes
      `Your comment` as their real note is blocked with no way out.

- [ ] ./src/Footnotes.ts#259 — `markerAt`'s span is inclusive of one column past
      `]` `end = character + name.length + 3` is the first column AFTER the
      closing bracket, and the test is `<= end`. So a cursor resting immediately
      after a marker counts as "inside" it — which both enables the jump from
      there and suppresses "add a footnote" there. Reasonable, but it is a
      deliberate off-by-one that no comment states as such.

- [ ] ./src/Footnotes.ts#310 — `footnoteAdditionEdits` and its two
      non-overlapping ranges The doc comment carries the real constraint: the
      definition edit anchors at `blockEndLine + 1` so the two edits can never
      share a start offset, which LSP forbids. It also normalizes any existing
      blank run after the block into exactly one blank line. Check the EOF
      branch — it omits the trailing blank line.

- [ ] ./src/Footnotes.ts#353 — `footnotePointerAt`'s three-valued return
      `undefined` = "not on a footnote, try your next resolver";
      `{pointer: undefined}` = "handled, but nothing to jump to". The second
      exists so an orphan marker inside a review hunk's note does not fall
      through to the hunk jump. The shape is unusual enough that it earns its
      comment.

## Wiring footnotes into the two steering formats

`review` and `qa` both gain footnote validation, a footnote-aware outline, an
"add a footnote" code action, and footnote-only or footnote-first `pointerAt`.
Markers are stripped from every extracted text field so they never leak into a
parsed title, option, or note.

- [ ] ./src/ReviewDoc.ts#444 — a chunk is now "unchecked" when it merely carries
      a footnote
      `unchecked: checkedCount < chunk.files.length || chunkMarkers.length > 0`.
      The field name now means "still needs attention", not "has unticked
      hunks". The intent is right — a fully-ticked chunk should not swallow the
      human's comment — but any other reader of `unchecked` inherits the widened
      meaning silently. Rename it, or state the new meaning at the field.

- [ ] ./src/ReviewDoc.ts#136 — markers stripped before path parsing
      `./a.ts#1[^fn1]` would otherwise swallow the marker into the `\S+` path
      capture. Correct fix; note it also means a literal `[^x]` anywhere in
      prose is silently deleted from the parsed title/description/note.

- [ ] ./src/ReviewDoc.ts#593 — `reviewPointerAt` tries footnotes first, hunks
      second Order matters: footnotes are column-scoped, the hunk jump is
      line-scoped, so a marker in a hunk's inline note would otherwise be
      shadowed.

- [ ] ./src/OpenQuestions.ts#340 — an option with a footnote stops being a
      `leaf` `leaf` and `children` are never both set, so an annotated option
      flips to a container. Consistent with `ReviewDoc.ts`'s chunk nodes.

- [ ] ./src/OpenQuestions.ts#410 — `footnoteBlockEnd` keeps a definition out of
      an option list With the cursor inside a contiguous option list, the
      definition lands after the LAST option, never between two of them.
      Otherwise the surrounding prose block.

- [ ] ./src/OpenQuestions.ts#23 — the `qa` sample now ships a footnote Both
      samples were rewritten to carry a real footnote whose body exceeds 80
      characters, pinned in oxfmt's own wrapped four-space form. This is what
      closes the known "oxfmt reflows the sample into an invalid doc" trap —
      verify the round-trip test actually covers it.

- [ ] ./src/ReviewDoc.ts#53 — the `review` sample changed shape beyond adding a
      footnote A blank line now separates `# Review:` from the base comment, and
      the note moved onto the pointer line instead of below it. That is what
      `gtd init` seeds from now on.

## The pointer contract widened to same-document jumps

`SteeringPointer.path` became optional and gained `character`; `pointerAt` now
receives a full position instead of a line number.

- [ ] ./src/SteeringFormat.ts#41 — `path` absent means "this same document"
      Chosen over a discriminated union. Cheapest shape, but it makes an omitted
      `path` and a genuinely unknown one indistinguishable at the type level.

- [ ] ./src/Lsp.ts#71 — `toLocation` gained a `documentUri` parameter Every
      caller must now pass it. The absent-`path` branch is checked twice — once
      in `definition` before the call, once inside `toLocation` — and the early
      return passes `""` as `root` purely as a sentinel it knows goes unused.
      Delete one of the two guards; the sentinel is what makes the redundancy
      load-bearing.

## Workflow prompt wiring — two tags, six sites

`unified.yaml` grows `footnoteRules` (human-facing: how to type one) and
`footnoteFoldIn` (agent-facing: fold in, delete in the same turn, never author
one). They share no text on purpose.

- [ ] ./src/workflows/unified.yaml#192 — the two tags and the deliberate split
      Three human-gate messages get `footnoteRules`; three agent prompts get
      `footnoteFoldIn`. `build.review.reviewing` — the state writing this very
      file — references neither, because the agent never authors a footnote.

- [ ] ./src/workflows/unified.yaml#790 — `await-review` now lists a footnote as
      a way to request changes A footnote triggers the same full development lap
      as a line note.

- [ ] ./src/workflows/templates.test.ts#664 — the injection sites are pinned by
      name AND count `toEqual` on the sorted state list means a seventh
      injection site added later fails loudly rather than passing silently. The
      structural assertions on `footnoteFoldIn`'s content check the rules, not
      the exact phrasing.

## Tests, evals, and docs

- [ ] ./src/SteeringFormats.test.ts#18 — a real oxfmt round-trip, not an assumed
      one Runs the repo's actual `oxfmt` binary under the repo's own
      `.oxfmtrc.json` in a scratch dir. Spawning a binary per property-test case
      is slow — check what this costs in `test:unit` wall time before merging.

- [ ] ./tests/integration/features/lsp.feature#360 — three end-to-end LSP
      scenarios Add-a-footnote applies its edits and asserts on the resulting
      document; a definition round trip proves marker→definition→marker's exact
      column; the third proves `qa` now serves `pointerAt` at all.

- [ ] ./tests/integration/support/steps/lsp.steps.ts#210 — `applyTextEdits`
      sorts back-to-front It assumes `\n` separators (fixtures only) and applies
      edits in descending offset order so earlier offsets stay valid. This is
      the step that would have caught overlapping ranges — it is the reason the
      two-edit anchoring above matters.

- [ ] ./evals/promptfooconfig.yaml#129 — two new `footnote` eval cells, twenty →
      twenty-two Grading is now by TIER, not variant name: every non-`violation`
      cell, including the two new ones, is deterministic tiers 1/2 only. Note
      the cost: two extra live model cells on every full eval run.

- [ ] ./evals/asserts/design-triage.mjs#47 — the footnote grader checks DELETION
      Passing requires no `[^` survives in the rewritten `.gtd/REQUIREMENTS.md`.
      The fixture's footnote deliberately comments on something other than
      `settledDecision`, so the two graders cannot contradict each other.

- [ ] ./evals/asserts/build-review-collecting.mjs#19 — anchor plus substance,
      not either alone Requires both the anchored path and the footnote's own
      defect text, so a file-level paraphrase that names the path fails. That is
      the check that proves the hunk was read rather than the file.

- [ ] ./docs/configuration.md#501 — the four validation failures, documented
      Marker with no definition, definition with no marker, duplicate name,
      unedited placeholder. Cross-check this list against `computeFindings` —
      and against the case-sensitivity note above.

- [ ] ./README.md#271 — the editor-integration paragraph grew the footnote
      sentence

- [ ] ./docs/setup.md#34 — the new code action and both jump directions listed
