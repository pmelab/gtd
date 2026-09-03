# Review: a1fad08

<!-- base: fc72f9c695b05c8597c256d546dca80ea4c37d92 -->

Both steering formats (`qa` and `review`) stop being line-and-regex parsers and
become mdast (CommonMark + GFM) tree readers. That flips several recognition
rules at once, adds a shared parse module, and turns every finding into a
positioned one with a column. Five dependencies enter the runtime bundle.

## Shared markdown parse layer

New module every other change sits on: one `fromMarkdown` call with the GFM
footnote and task-list extensions, plus the mdast→LSP position conversions and
the two tree walks (`sourceText`, `taskItems`) the formats share. Both extension
halves must be _called_, not passed bare — otherwise every `listItem.checked` is
silently `null`.

- [ ] ./src/MarkdownTree.ts#38 — `parseMarkdown` with a one-entry, module-global
      memo keyed on the content string Process-wide mutable state in a module
      that is otherwise pure. It holds the last document's full tree alive for
      the process's lifetime, and correctness now depends on the memo key being
      the whole string (it is). Worth confirming a one-entry memo is enough:
      `parseOpenQuestions`, `parseFootnotes`, `questionEndLines` and the actions
      path each call it on the same string, so interleaving two documents in one
      request would thrash it back to N parses — slower, never wrong.
- [ ] ./src/MarkdownTree.ts#19 — `parseCount` / `getParseCount`, a test-only
      counter exported from production code The doc comment states the reason
      (one-parse-per-document is not otherwise assertable). It is still a global
      that only tests read.
- [ ] ./src/MarkdownTree.ts#65 — `toLspPositionFromOffset` scans `content` from
      index 0 on every call O(offset) per lookup, called once per orphan marker,
      per option, per hunk pointer and per document link. Fine at steering-file
      sizes; it is a linear scan per call, not a prefix table.
- [ ] ./src/MarkdownTree.ts#98 — `sourceText` excises footnote-reference spans
      and collapses whitespace The single definition of "a node's text as a
      human wrote it". Note that callers then collapse whitespace a second time
      (`headingText` in both formats), which is redundant, not wrong.
- [ ] ./package.json#93 — five new runtime dependencies plus `@types/mdast`
      `mdast-util-from-markdown`, two `mdast-util-gfm-*`, two
      `micromark-extension-gfm-*`. They are runtime, not dev — they ship in the
      bundle. `package-lock.json` grows by ~760 lines of transitive micromark
      packages.

## Footnotes read off the tree

The fence-tracking, inline-code-masking, indent-walking line scanner is gone.
Real `footnoteReference`/`footnoteDefinition` nodes are collected from the tree,
and a regex scan over `text` nodes only picks up **orphan** markers — GFM leaves
`[^name]` as literal text when no definition matches it.

- [ ] ./src/Footnotes.ts#218 — `parseFootnotes` rewritten as a tree walk plus an
      orphan-marker pass Fenced code, indented code and inline code are excluded
      structurally now instead of by hand-rolled skip lists. Markers are
      re-sorted by position because the two passes produce them out of document
      order.
- [ ] ./src/Footnotes.ts#53 — `foldName`: marker↔definition matching is now
      case-insensitive **Behavior change.** `[^FN1]` previously did not match
      `[^fn1]:` and produced two findings; now it resolves. This mirrors mdast's
      own identifier normalization, but it is a user-visible relaxation and no
      doc mentions it.
- [ ] ./src/Footnotes.ts#26 — a definition's continuation span now follows GFM:
      four spaces, plus lazy continuation **Behavior change with the widest
      blast radius in this diff.** The old parser continued a definition on
      _any_ indent (two spaces included) and stopped at any unindented line. GFM
      does the opposite on both counts. A committed steering file whose
      definition body is indented two spaces now ends at the label line, and an
      unindented line right after a definition is now swallowed into its body.
      The only record of this is a type doc comment — `docs/` says nothing, and
      no migration or detection exists for files already written the old way.
- [ ] ./src/Footnotes.ts#33 — `endCharacter` added to `FootnoteMarker`,
      replacing `character + name.length + 3` Real node ends instead of
      arithmetic; feeds the new marker diagnostic range.
- [ ] ./src/Footnotes.ts#295 — `isOnExistingFootnote` and `footnotePointerAt`
      now test a definition's real span `isFootnoteDefinitionLine` and
      `proseBlockEnd` are deleted; both callers grew their own fallback instead.
      Check that no caller lost the "cursor in prose" case — `qa` and `review`
      each route it through `blockNodeAt` now.

## `qa` format on the tree

Question headings, options and section order are read from nodes.
`listItem.checked` replaces the checkbox regex, which means options are no
longer found at arbitrary indent.

- [ ] ./src/OpenQuestions.ts#202 — `optionListItems` takes only top-level list
      items; nested sub-lists are not options **Behavior change.** The old
      `CHECKBOX_RE` allowed any indent, so a 4+-space-indented `- [ ]` counted
      as an option. It no longer does — it is indented code or a lazy
      continuation. The next hunk is the compensation for that.
- [ ] ./src/OpenQuestions.ts#569 — `strictReadingFindings`: a raw line scan
      added back on top of the tree This is the load-bearing safety net: without
      it, a 4+-space-indented `###` or `- [ ]` vanishes from the tree with **no
      signal**, silently dropping a whole question or leaving one with zero
      options that reads as merely unanswered. It is also the diff's largest
      single piece of new complexity — five helpers (`recognizedStructureLines`,
      `nestedBlockLines`, `markTopLevelListItems`, `fencedCodeLines`,
      `isFencedCode`) exist only to decide which lines the scan is allowed to
      flag. Judge whether this exclusion-set approach is stable, or whether a
      future node shape silently starts producing false positives.
- [ ] ./src/OpenQuestions.ts#336 — known unflagged gap: a `## Open Questions`
      heading itself indented 4+ spaces The whole section, and every question in
      it, goes unrecognized with no finding at all — the refusal covers only the
      `###` and `- [ ]` shapes. Documented in the comment, deliberately out of
      scope. Confirm you accept it.
- [ ] ./src/OpenQuestions.ts#241 — `optionText` reads the marker's own source
      line only, never a wrapped continuation Deliberately matches the old regex
      capture. `endLine` still spans the wrap. The offset comes from the
      paragraph's first _child_, because the task-list extension leaves the
      paragraph's own `position.start` stale on checked items — a real trap,
      called out in the comment.
- [ ] ./src/OpenQuestions.ts#344 — `checkSectionOrder` walks heading nodes, so a
      `## Open Questions` inside a fence no longer counts Findings now point at
      one concrete offending heading (`h2[0]` / last `h2`).
- [ ] ./src/OpenQuestions.ts#36 — `MARKER_TEXT_RE` / `stripMarkerText`, a local
      copy of the deleted `stripFootnoteMarkers` `Footnotes.ts` has the same
      pattern as `ORPHAN_MARKER_RE`. Two literals for one syntax, in two
      modules, with only a comment tying them together.
- [ ] ./src/OpenQuestions.ts#594 — `OpenQuestionsDoc.errors` (strings) →
      `findings` (`SteeringFinding[]`) Breaking internal shape;
      `parseOpenQuestions` is now the only parse entry point, with no second
      function routing around its return type.
- [ ] ./src/OpenQuestions.ts#649 — `toggleCheckbox` resolves the box by offset,
      bounded by the item's content start Replaces `raw.indexOf("[")`, which
      option text containing its own `[` could mislead.

## `review` format on the tree

Same conversion for `REVIEW.md`: chunks are `##` heading nodes, hunks are task
items at any depth, ticks are cleared by offset splice.

- [ ] ./src/ReviewDoc.ts#288 — `parseHunk` collects hunks via `taskItems`, at
      **any** nesting depth A two-space-indented nested `- [ ]` is now a real
      hunk. It was invisible before — that is the live bug the new
      `review-tick-reset` scenario pins.
- [ ] ./src/ReviewDoc.ts#464 — `clearFilePointerTicks` is now a tree walk +
      offset splice, not an anchored regex Keeps the CRLF-preserving property
      (no split/join) and gains: a `- [x]` inside a fenced code block is no
      longer clobbered, and a nested tick now _is_ cleared. Returns `content`
      itself when nothing changes, so the caller can skip the write.
- [ ] ./src/ReviewDoc.ts#223 — `ReviewFile.endLine` now excludes a nested hunk's
      span Redefined field: a parent hunk's span stops before its children. This
      drives footnote placement and cursor→hunk matching; anything that assumed
      "span through the last non-blank line" is now wrong.
- [ ] ./src/ReviewDoc.ts#186 — the second-pointer refusal is scoped to the
      _physical_ first line, via `hunkInlineSegment` Necessary because
      `sourceText` joins a lazy wrap into one string: without the line check, a
      legitimate below-pointer note opening with `./path` would be refused
      exactly like `- [ ] ./a.ts#1 ./b.ts#2`. The finding now also carries the
      second token's own range, searched forward from the first token's end.
- [ ] ./src/ReviewDoc.ts#110 — `parseHeader` requires the `# Review:` heading to
      be `tree.children[0]` Stricter than the old "first non-blank line", and a
      heading inside a fence can never satisfy it.
- [ ] ./src/ReviewDoc.ts#124 — `parseBaseComment` matches a real `html` node,
      not a raw-line search A `<!-- base: ... -->` quoted inside a fence no
      longer counts.
- [ ] ./src/ReviewDoc.ts#536 — `chunkEndLines` replaces "next heading minus one"
      for outline ranges Same fix landed in `qa` (`questionEndLines`). Trailing
      blank lines and unrelated content between chunks are no longer swallowed.
- [ ] ./src/ReviewDoc.ts#89 — `headingText` is duplicated near-verbatim in
      `OpenQuestions.ts` The synthetic-children-span trick (never the heading
      node's own position, or the `#` run leaks in) is subtle and now exists
      twice. Only the marker stripping differs.
- [ ] ./src/ReviewDoc.ts#440 — `checkboxOffset` duplicates `toggleCheckbox`'s
      bracket-offset logic The comment says it mirrors the other; nothing
      enforces that it keeps doing so.
- [ ] ./tests/integration/features/emitted-scripts-under-dash.feature#40 — the
      hostile `sed` had to change because `* [ ]` is now a valid hunk marker
      **Unstated behavior change.** The old parser required `- [`; mdast accepts
      `*` and `+` list markers, so rewriting `- [` to `* [` no longer breaks the
      document, and both scenarios had to attack the header instead. Nothing in
      the docs says which bullet characters a hunk may use.

## Positioned findings — line and column everywhere

`SteeringFinding` grows an optional `range`, kept flat rather than a
discriminated union so a shell `validate:` command can still emit a bare
`{ message }`.

- [ ] ./src/SteeringFormat.ts#54 — `range` added; its two invariants live in a
      doc comment, not the type "A range is meaningless without `line`" and
      "`range.start.line === line`" are only enforced by the new
      `SteeringFormat.test.ts` sweep over both formats. A new finding site in a
      third format would not be covered.
- [ ] ./src/program.ts#790 — `formatFinding` now prints `file:line:col: message`
      Grep/editor-jumpable. Exported now, for the test. The
      `line`-without-`range` branch is documented as currently unreachable from
      any built-in format.
- [ ] ./src/program.ts#879 — `gtd check qa --open-questions` prefixes each
      unanswered question with `file:line:` Previously a bare question string.
- [ ] ./src/StepGuards.ts#111 — the answer-completeness guard's refusal message
      gains `file:line:` per question Same treatment inside the guard text the
      human actually reads at the gate.
- [ ] ./src/Lsp.ts#94 — `toDiagnostic` prefers a finding's own `range`, falling
      back to whole-line then whole-document Diagnostics now underline the
      offending token, not the whole line.

## Document links on hunk pointers

New LSP capability: a `./path#42` pointer in a `review` file is a clickable
link, no go-to-definition round trip.

- [ ] ./src/SteeringFormat.ts#75 — `SteeringLink` and the optional
      `documentLinks` format hook Declared by `review`, absent on `qa`.
      Deliberately not built on `pointerAt`, which is per-line and cannot yield
      a token range.
- [ ] ./src/ReviewDoc.ts#723 — `hunkLinkFor` re-implements `parseHunk`'s pointer
      recognition Third copy of "first word of the first paragraph, is it a
      pointer token". The comment claims the two "can never disagree"; nothing
      but the shared `isPointerToken` actually guarantees that.
- [ ] ./src/Lsp.ts#132 — `toDocumentLink` targets `file://…#L<line+1>`, 1-based
      fragment GitHub-style convention. Verify your editor honors the `#L`
      fragment — a client that ignores it opens the file at line 1 with no
      error.
- [ ] ./src/Lsp.ts#361 — `documentLink` handler resolves the repo root per
      request via `safeGitTopLevel` A git call on every document-link request,
      on top of `safeSteeringMap`. Matches what `definition` already does.
- [ ] ./src/Lsp.ts#331 — `documentLinkProvider: { resolveProvider: false }`
      advertised in the initialize result

## Docs

Three short user-facing additions. Nothing documents the footnote-continuation
or bullet-marker changes above.

- [ ] ./docs/configuration.md#499 — documents the 4+-space indent refusal for
      `###` headings and `- [ ]` options Names the threshold and states 2–3
      spaces are still fine.
- [ ] ./docs/setup.md#31 — the new document-link capability in the editor
      feature list
- [ ] ./README.md#274 — one sentence on clickable hunk pointers

## Tests

~2,000 lines of new unit tests plus four new e2e scenarios. The gaps to check
are the behavior changes that got no scenario, not the ones that did.

- [ ] ./src/MarkdownTree.test.ts#1 — new: parse memoization, offset conversion,
      `sourceText` excision, `taskItems` depth
- [ ] ./src/SteeringFormat.test.ts#1 — new: drives both formats over malformed
      samples and asserts the `range` invariants
- [ ] ./src/Footnotes.test.ts#1 — reworked for GFM continuation spans, case
      folding, orphan markers
- [ ] ./src/OpenQuestions.test.ts#1 — +419 lines, largely
      `strictReadingFindings` and its exclusion set
- [ ] ./src/ReviewDoc.test.ts#1 — +349 lines: nested hunks, fenced-code
      immunity, `findings` shape
- [ ] ./src/Lsp.test.ts#1 — +182 lines: document links and range-carrying
      diagnostics
- [ ] ./tests/integration/features/review-tick-reset.feature#90 — two new
      scenarios: a nested tick is cleared; a fenced `- [x]` is not touched The
      first is the live bug this rewrite fixes.
- [ ] ./tests/integration/features/check.feature#141 — four new scenarios:
      fenced footnote/heading examples validate clean; a 4-space option fails
      with its exact line, both as indented code and as a lazy continuation
- [ ] ./tests/integration/features/steering-modes.feature#907 — a shell
      `validate:` returns `file:line:col:` inside an opaque message, never
      structured position
- [ ] ./src/program.test.ts#1 — `formatFinding`'s three output shapes
