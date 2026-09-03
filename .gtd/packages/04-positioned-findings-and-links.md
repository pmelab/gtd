# 04 — Findings and outlines that point at the offending token

## Requirement

A finding gains a range, and every finding that already knew where it was starts
saying so. Concretely: the `qa` format's three structural findings and the
`review` format's chunk-has-no-pointers, missing-header, and missing-base
findings are all unpositioned today while holding the line number in scope;
`parseReviewDoc` downgrades positioned findings to bare strings, which is why a
second parse function exists purely to route around its own return type; and the
four footnote findings know the marker's column and drop it, because a finding
has no column field to put it in. Unanswered-question output names the question
and not its heading line.

**`gtd check` prints `file:line:col: message`** — the shape editors and
grep-style tools already jump on, so a driver's raw output becomes clickable.
The column is omitted, leaving today's `file:line: message`, only for a finding
that has a line and no column; a finding about the whole document still prints
its bare message.

Outline node ranges stop being computed as _next sibling's heading minus one_ —
a guess that swallows trailing blank lines and any intervening content — and
come from real node boundaries. With a precise range on the pointer token,
`review`'s `./path#42` hunks also become document links, clickable without going
through go-to-definition.

**Acceptance**: `gtd check qa` on a file whose `## Answered Questions` is
followed by another `##` section reports that finding with both a line and a
column; today it prints a bare message with no position at all. And the LSP
diagnostic for it underlines the offending heading instead of spanning the whole
document, which is the current fallback for any unpositioned finding.

**Scoped condition, not a regression**: a mode whose `validate:` shells out to
`gtd check` gets each stdout line back as an opaque message with no position,
because a shell command's findings can never carry one. On that path the new
column rides inside the message text, exactly as the line number already does.
`gtd validate` emits a script and reads no files, so it is untouched.

## Paths

- `src/SteeringFormat.ts`
- `src/program.ts`, `src/program.test.ts`
- `src/Lsp.ts`, `src/Lsp.test.ts`
- `src/OpenQuestions.ts`, `src/ReviewDoc.ts`, `src/Footnotes.ts` (finding sites)

## Task — `SteeringFinding` grows a full range

`SteeringFinding` gains a **full start/end range**, taken from the offending
node's own boundaries, so the LSP underlines exactly that heading, option, or
marker instead of guessing where the underline ends. `line` stays for the
positionless case; the range is a separate optional field, so nothing that
already reads `finding.line` changes.

The shape stays **optional and flat** rather than a discriminated union, because
`SteeringMode.ts`'s `findingsFrom` must keep emitting a bare `{ message }` for
every line a shell `validate:` command prints.

- [ ] a range is meaningless without a `line` — pinned by a test, not the type
- [ ] a range's start line equals `line` — pinned by a test, not the type
- [ ] `findingsFrom` still constructs `{ message }` alone for a shell command's
      output lines, and compiles unchanged

## Task — one parse function, findings not strings

`parseReviewDoc` and `parseReviewFindings` collapse into one function.
`ReviewDoc.errors: readonly string[]` becomes findings, which removes the only
reason a second parse function existed — routing around its own return type.
`OpenQuestionsDoc.errors` gets the same treatment.

- [ ] `src/ReviewDoc.ts` exports exactly one review parse function
- [ ] `ReviewDoc` and `OpenQuestionsDoc` both carry findings, not strings
- [ ] no caller re-derives a message string only to lose the position

## Task — attach ranges at every finding site

Every existing positioned finding needs an end, and the rule is one line: **the
range is the node the finding is about.**

- [ ] a bare `###` heading finding spans the heading node
- [ ] a section-order finding spans the offending `##` heading node
- [ ] a chunk-has-no-pointers finding spans its chunk's heading node — not the
      chunk's body, which is what the reader would have to scroll past
- [ ] each of the four footnote findings spans its `footnoteReference` or
      `footnoteDefinition` node
- [ ] a missing-header finding spans the wrong first block node
- [ ] a missing-base finding stays positionless: a missing `<!-- base: … -->`
      comment has no offending token to point at
- [ ] unanswered-question output names the question's heading line

## Task — `gtd check` prints `file:line:col:`

`formatFinding` prints `file:line:col: message`, the column taken from the
range's **start**. It prints a bare message for a finding about the whole
document.

The `file:line: message` branch — a line with no column — stays, per the settled
requirement, but **no built-in format produces it any more**: a range always
carries a column. It exists for the flat optional shape's sake and for a future
format, and its test is the only thing exercising it.

`docs/cli.md`'s `## Commands` block and exit-code table are pinned to rendered
help output; adding a column to a finding changes neither, so expect no doc
regen — a `docs/cli.md` diff here means something else broke.

- [ ] `gtd check qa` on a file whose `## Answered Questions` is followed by
      another `##` section prints `file:line:col: message`; today it prints a
      bare message with no position at all
- [ ] a whole-document finding still prints its bare message
- [ ] the line-only branch is covered by its own test, since no built-in format
      reaches it
- [ ] `gtd check`'s exit codes are unchanged, and `docs/cli.md` needs no edit
- [ ] an absent file still exits 0 on the structural path

## Task — outline ranges from real node boundaries

Outline node ranges stop being computed as _next sibling's heading minus one_ —
a guess that swallows trailing blank lines and any intervening content — and
come from a section span walked over nodes: the heading through the last block
before the next heading of depth ≤ its own.

- [ ] a question or chunk followed by blank lines before the next heading has an
      outline range ending at its own last block, not at the blank run
- [ ] a `qa` option carrying a footnote is still a container (children, no
      `leaf`), and one without is still `leaf: true` — never both
- [ ] a fully-checked `review` chunk that carries a footnote still appears in
      the outline, so a human's comment does not vanish when they tick the last
      box

## Task — the LSP hands the range straight through

`Lsp.ts`'s `toDiagnostic` stops computing a range: a finding with one hands its
range straight to the diagnostic, and only a positionless finding still falls
back to spanning the whole document.

- [ ] the diagnostic for a section-order finding underlines the offending
      heading, not the whole document
- [ ] a positionless finding still spans the whole document
- [ ] the external-validator notice is unchanged

## Task — hunk pointers become document links

Hunk pointers become **document links**. That needs a new optional
`SteeringFormat` member returning each pointer token's precise range plus its
target path and line, declared by `review` and absent on `qa`. `Lsp.ts` gains an
`onDocumentLink` handler, the matching server capability, and the new handler
name in its handler-name union.

Path resolution against the repo root stays the LSP's concern, exactly as it
already is for `pointerAt`.

Deriving links by calling `pointerAt` per line is rejected: it is one call per
line and cannot produce the token's own range, which is the whole point.

- [ ] a `./path#42` hunk is a document link whose range covers exactly the
      pointer token, not the whole line and not the note
- [ ] the link resolves `#42` from 1-based to 0-based, and a bare `./path` with
      no `#line` lands at line 0
- [ ] `qa` declares no links member and the server returns none for a `qa` file
- [ ] the `documentLink` capability is advertised, and the new handler name is
      in the handler-name union
- [ ] a footnote marker inside a hunk's inline note is not turned into a
      document link to the hunk's file

## Task — cucumber scenarios

- [ ] a `.feature` scenario runs `gtd check qa` on a file with a misordered
      `## Answered Questions` and asserts the `file:line:col:` output shape
- [ ] a `.feature` scenario shows a mode whose `validate:` shells out to
      `gtd check` receiving the column inside the message text, with no position
      of its own
- [ ] Given steps are composable and expose the actual file content in the
      scenario text
