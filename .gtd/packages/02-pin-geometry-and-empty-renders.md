# 02 — Pin cursor geometry, the toggle rule, and every empty render

This package carries **three requirements**, merged upstream because all three
land purely as added assertions in the same four test files. Each is reproduced
verbatim below and reviews independently against its own spec.

## Requirement A

> ### 2. Pin review-document cursor geometry and the chunk-toggle rule (TECHNICAL)
>
> Highest severity of the coverage clusters: **a survivor here means a user gets
> the wrong answer, not a worse message.** Folding ranges, document symbols, and
> code actions all survive boundary flips.
>
> - `src/ReviewDoc.ts:427` — nine survivors on one line.
>   `chunk.files.length > 0 && cursorLine >= chunk.headingLine && cursorLine <= chunkEnd`
>   survives being replaced by `true`, by either conjunct alone, by `||` for
>   `&&`, and by `<` for `<=`.
> - `src/ReviewDoc.ts:411` — the hunk-under-cursor predicate
>   `cursorLine >= file.sourceLine && cursorLine <= file.endLine` survives
>   `true`, `||`, and either half alone.
> - `src/ReviewDoc.ts:362` and `src/OpenQuestions.ts:299` — the fold-end clamp
>   `Math.max(start, (xs[i + 1]?.headingLine ?? lines.length) - 1)` survives
>   `Math.min`, `i - 1`, and `+ 1`.
> - `src/ReviewDoc.ts:425` — the same `i + 1` / `- 1` pair inside the
>   code-action chunk-end computation.
> - `src/ReviewDoc.ts:383` — `checkedCount * 2 <= total` survives `true` and
>   `checkedCount / 2 <= total`. The rule is already settled in the function's
>   own doc comment (an even split checks rather than unchecks); nothing asserts
>   it.
>
> Cover it with cursor placement exactly on the first line, exactly on the last
> line, and one line outside each of a hunk and a chunk, asserting which code
> action is offered; fold ranges at the **last** chunk in the document, which is
> the only case that exercises the `?? lines.length` fallback; and a
> partially-checked chunk toggled at below-half, exactly-half, and above-half,
> asserting check-all versus uncheck-all.
>
> Acceptance: each new case fails if you flip the corresponding operator by
> hand.

## Requirement B

> ### 3. Assert the empty case of every rendered output (TECHNICAL)
>
> One shape unites two clusters the sketch listed apart: **every survivor here
> is the empty branch of a populated-or-empty render, and the tests only ever
> assert the populated one.** Tests check that an error fires, never what it
> says.
>
> Diagnostic text a user reads when a pattern refuses or a template variable is
> missing:
>
> - `src/Edge.ts:908` —
>   `refusal.patterns.length > 0 ? refusal.patterns.join(", ") : "(none)"`
>   survives `true`, `>=`, `join("")`, and `""` for `"(none)"`.
> - `src/Edge.ts:1072` — the same shape for `declaredNames`.
> - `src/Edge.ts:1096` — the same shape for `it.vars` refs and `"(none found)"`.
>   Additionally the mapper that prefixes each ref with `it.vars.` before
>   joining on `", "` survives mapping every ref to an empty string, and
>   survives mapping every ref to `undefined`.
> - `src/SteeringMode.ts:188` — five survivors on the format-failure suffix,
>   which appends a colon, a newline and the trimmed command output only when
>   that output is non-empty. They cover the empty-output branch and `trimEnd`
>   swapped for `trimStart`.
>
> Optional-field spreads, where `...(x.length > 0 ? { key } : {})` survives
> becoming `...(true ? { key } : {})` — nothing asserts the key is _omitted_.
> **This one shapes the `gtd next --json` payload, so an extra empty key is a
> protocol change a driver can see:**
>
> - `src/Edge.ts:533` (`action`), `src/Edge.ts:532` (`describe`),
>   `src/ReviewDoc.ts:106` (`inlineNote`), `src/OpenQuestions.ts:311`
>   (`children`).
>
> Assert the rendered string for both the populated and the empty case, and
> `expect(payload).not.toHaveProperty("action")` (and so on) for each spread.

## Requirement C

> ### 4. Pin steering-file parsing: line endings, whitespace, anchors (PRODUCT)
>
> **A CRLF-authored steering file must parse identically to the same file with
> LF — that is a user guarantee, not an accident**, and nothing tests it today.
> The code already splits on `/\r?\n/`, so the mutant `split(/\r\n/)` survives
> purely because no CRLF fixture exists anywhere in the suite. Sites:
> `src/ReviewDoc.ts:358`, `src/ReviewDoc.ts:404`, `src/OpenQuestions.ts:296`.
>
> Regex anchors and quantifiers are unpinned in the same parsers:
>
> - `src/OpenQuestions.ts:74` — `/^(#{1,6})(?:\s+(.*))?$/` survives losing `^`,
>   losing `$`, and `\s+` → `\s`.
> - `src/Edge.ts:1089` — the scanner `/it\.vars\.(\w+)/g` survives `\w+` → `\w`
>   and `\w` → `\W`, so **a multi-character variable name is never exercised
>   through that path at all.**
> - `src/ReviewDoc.ts:196` — `inlineSegment.split(/\s+/)` survives `\s`.
>
> Cover it by parsing one fixture twice, LF and CRLF, asserting identical
> results; a heading that is not at line start; a heading with trailing content;
> a multi-char `it.vars` reference; and multi-space separators.
>
> Whitespace is the sprawling part: **35 `MethodExpression` survivors** where
> every `.trim()` / `.trimEnd()` / `.trimStart()` survives being swapped for a
> sibling or removed outright — e.g. `src/ReviewDoc.ts:61`, `:129`, `:221`,
> `:334`, `src/OpenQuestions.ts:74`. Do not chase all 35. Assert the ones where
> a fixture carrying leading or trailing whitespace changes an observable
> output; the rest are defensive and killing them buys nothing a reader can
> name.

## Paths

- `src/ReviewDoc.test.ts`
- `src/OpenQuestions.test.ts`
- `src/Edge.test.ts`
- `src/SteeringMode.test.ts`

## Constraints that hold for every task here

**Zero production edits. This package only adds assertions.** No file under
`src/` other than the four `*.test.ts` files is touched.

**Drive every site through the interface that already exists; widen no export
surface.** `chunkToggleTarget`, `reviewActions`, `reviewOutline`,
`questionsOutline` and `formatStepRefusal` are module-private and stay that way
— they are reachable through `REVIEW_FORMAT.actions` / `.outline` /
`.pointerAt`, `QA_FORMAT.*`, `parseReviewDoc`, `parseOpenQuestions`,
`toggleFilePointer`, `toggleCheckbox`, and Edge's existing command entry points,
all of which the four test files already import. **A test-only export would land
in fallow's dead-export report and lie to a reader about the public API.**

**Unit tests only, no cucumber scenario.** None of this adds a feature — it
characterizes pure functions that already exist.

No new error paths: every function under test here is pure and total.

- [ ] `git diff --stat` for this package lists only the four `*.test.ts` files
- [ ] No new `export` appears in `src/ReviewDoc.ts`, `src/OpenQuestions.ts`,
      `src/Edge.ts`, or `src/SteeringMode.ts`
- [ ] `npm run deadcode` stays green

## Task 1 — Cursor geometry table (Requirement A)

Sites: `ReviewDoc.ts:411`, `:425`, `:427`.

**An `it.each` table of `[cursorLine, expectedActionTitles]` over one
multi-chunk fixture**, with rows for exactly the first line, exactly the last
line, and one line outside — of both a hunk and a chunk. The table kills `<` for
`<=`, `||` for `&&`, either conjunct alone, and `true`.

**A row one line past the chunk end is the only one that kills the `<`/`<=`
flip.** Without it the whole table passes mutated.

- [ ] A row places the cursor exactly on a hunk's `sourceLine` and asserts the
      hunk action is offered
- [ ] A row places the cursor exactly on a hunk's `endLine` and asserts the hunk
      action is offered
- [ ] A row places the cursor one line past a hunk's `endLine` and asserts the
      hunk action is absent
- [ ] A row places the cursor exactly on a chunk's `headingLine` and asserts the
      chunk action is offered
- [ ] A row places the cursor exactly on the computed chunk end and asserts the
      chunk action is offered
- [ ] A row places the cursor one line past the chunk end and asserts the chunk
      action is absent
- [ ] A row covers a chunk with zero files and asserts no chunk action is
      offered
- [ ] Hand-flipping `<=` to `<` at `ReviewDoc.ts:411` fails the suite
- [ ] Hand-flipping `<=` to `<` at `ReviewDoc.ts:427` fails the suite
- [ ] Hand-replacing `&&` with `||` at `ReviewDoc.ts:427` fails the suite
- [ ] Hand-replacing the whole `ReviewDoc.ts:427` condition with `true` fails
      the suite

## Task 2 — Fold-end clamp at the last chunk and last question (Requirement A)

Sites: `ReviewDoc.ts:362`, `OpenQuestions.ts:299`, plus the same `i + 1` / `- 1`
pair at `ReviewDoc.ts:425`.

**Assert `.outline()` ranges for the last chunk and the last question in the
document.** That is the only case that exercises the `?? lines.length` fallback,
and it is what kills `Math.min`, `i - 1`, and `+ 1`.

- [ ] `REVIEW_FORMAT.outline()` asserts the exact `range.end.line` of the last
      chunk in a multi-chunk fixture
- [ ] `QA_FORMAT.outline()` asserts the exact `range.end.line` of the last
      question in a multi-question fixture
- [ ] A fixture with no trailing newline after the last chunk is covered, so the
      fallback boundary is exercised
- [ ] Hand-swapping `Math.max` for `Math.min` at `ReviewDoc.ts:362` fails the
      suite
- [ ] Hand-swapping `Math.max` for `Math.min` at `OpenQuestions.ts:299` fails
      the suite
- [ ] Hand-changing `i + 1` to `i - 1` at `ReviewDoc.ts:362` fails the suite
- [ ] Hand-changing the trailing `- 1` to `+ 1` at `ReviewDoc.ts:362` fails the
      suite

## Task 3 — Chunk-toggle majority rule (Requirement A)

Site: `ReviewDoc.ts:383`.

**Three cases on a partially-checked chunk — below half, exactly half, above
half — asserting check-all versus uncheck-all through the action title.** The
rule is already settled in the function's own doc comment: **an even split
checks.**

- [ ] A chunk with 1 of 4 hunks checked offers "check all hunks"
- [ ] A chunk with 2 of 4 hunks checked offers "check all hunks" (the even split
      checks)
- [ ] A chunk with 3 of 4 hunks checked offers "uncheck all hunks"
- [ ] Hand-replacing `checkedCount * 2 <= total` with `true` fails the suite
- [ ] Hand-replacing `*` with `/` in `checkedCount * 2 <= total` fails the suite

## Task 4 — Empty renders asserted as whole strings (Requirement B)

Sites: `Edge.ts:908`, `:1072`, `:1096`, `SteeringMode.ts:188`.

**Assert the whole message string with `toBe`, for both the populated and the
empty case.** `toContain("(none)")` is not sufficient — it survives `join("")`
and `>=` for `>`.

**The populated case must carry at least two entries so the `", "` separator is
itself asserted.** The `it.vars` case must use a multi-character name so
`it.vars.${r}` is distinguishable from an empty or `undefined` mapping.
`SteeringMode.ts:188` needs a format command whose output carries trailing
whitespace — that is what separates `trimEnd` from `trimStart`.

- [ ] `Edge.ts:908` refusal message asserted with `toBe` for two-or-more
      patterns and for zero patterns
- [ ] `Edge.ts:1072` undeclared-var message asserted with `toBe` for two-or-more
      declared names and for zero
- [ ] `Edge.ts:1096` blank-reviewBase message asserted with `toBe` for
      two-or-more `it.vars` refs and for zero
- [ ] The `it.vars` populated case uses a multi-character variable name
- [ ] `SteeringMode.ts:188` format-failure message asserted with `toBe` for
      non-empty output with trailing whitespace, and for empty output
- [ ] No new assertion in this task uses `toContain` in place of `toBe`
- [ ] Hand-changing `join(", ")` to `join("")` at each of the four sites fails
      the suite
- [ ] Hand-changing `> 0` to `>= 0` at each of the four sites fails the suite
- [ ] Hand-swapping `trimEnd` for `trimStart` at `SteeringMode.ts:188` fails the
      suite

## Task 5 — Optional-field spreads asserted absent (Requirement B)

Sites: `Edge.ts:532` (`describe`), `:533` (`action`), `ReviewDoc.ts:106`
(`inlineNote`), `OpenQuestions.ts:311` (`children`).

**`expect(payload).not.toHaveProperty("action")` in the empty case, alongside
the existing populated assertion.**

Risk in one line: **this shapes the `gtd next --json` payload, so an extra empty
key is a protocol change a driver can see.**

- [ ] `not.toHaveProperty("describe")` asserted for an edge with no describe
- [ ] `not.toHaveProperty("action")` asserted for an edge with no action
- [ ] `not.toHaveProperty("inlineNote")` asserted for a review node with no
      inline note
- [ ] `not.toHaveProperty("children")` asserted for a question with no options
- [ ] Hand-replacing each `x.length > 0` spread guard with `true` fails the
      suite

## Task 6 — LF and CRLF parse identically (Requirement C)

Sites: `ReviewDoc.ts:358`, `:404`, `OpenQuestions.ts:296`.

**Parse one LF fixture, then the same fixture through
`doc.replaceAll("\n", "\r\n")`, and assert deep-equal results.**

**Build the CRLF variant in the test; never commit a CRLF fixture file.** oxfmt
formats `.md` and `.ts` repository-wide and would normalize it back to LF,
silently defeating the test while it still passes.

- [ ] `parseReviewDoc` asserted deep-equal between the LF fixture and its CRLF
      twin
- [ ] `REVIEW_FORMAT.outline` / `.actions` asserted deep-equal between the LF
      fixture and its CRLF twin
- [ ] `parseOpenQuestions` asserted deep-equal between the LF fixture and its
      CRLF twin
- [ ] No file with CRLF line endings is committed anywhere in the repository
- [ ] `npm run format:check` stays green
- [ ] Hand-changing `split(/\r?\n/)` to `split(/\r\n/)` at each of the three
      sites fails the suite

## Task 7 — Regex anchors and quantifiers (Requirement C)

Sites: `OpenQuestions.ts:74`, `Edge.ts:1089`, `ReviewDoc.ts:196`.

- [ ] A `###` heading with leading text on the same line is asserted NOT to
      parse as a heading (kills the lost `^`)
- [ ] A `###` heading with trailing content is asserted to parse with that
      content as its text (kills the lost `$`)
- [ ] A heading separated from its text by two or more spaces parses identically
      to the single-space form (kills `\s+` → `\s`)
- [ ] A multi-character `it.vars` reference is asserted to round-trip whole
      through the `Edge.ts:1089` scanner (kills `\w+` → `\w` and `\w` → `\W`)
- [ ] An inline segment separated by two or more spaces is asserted to split
      identically to the single-space form at `ReviewDoc.ts:196`

## Task 8 — Load-bearing whitespace only (Requirement C)

**Do not chase all 35 `MethodExpression` survivors.** Assert only the sites
where a fixture carrying leading or trailing whitespace changes an observable
output — e.g. `ReviewDoc.ts:61`, `:129`, `:221`, `:334`, `OpenQuestions.ts:74`.
**The rest are defensive and killing them buys nothing a reader can name.**

- [ ] Each asserted whitespace site has a fixture whose leading or trailing
      whitespace changes an observable output
- [ ] No test is added for a `.trim()` call whose removal changes no observable
      output
- [ ] Hand-removing the `.trim()` at each asserted site fails the suite
