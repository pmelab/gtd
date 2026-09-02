# 03 — `gtd lsp` writes and navigates footnotes

## Requirement

**One code action puts the marker in the right place, and go-to-symbol jumps
both ways.**

- "add a footnote" at the cursor: the marker lands after the word the cursor is
  inside, or at the cursor when it already sits just past the word; the
  definition lands below the current paragraph or list; the name is generated
  unique within the document
- Definition jumps marker → footnote and footnote → marker, within the one
  document
- The action serves a human in an editor and nothing else — footnotes are human
  input, so there is no agent-facing authoring path to build here

**The `SteeringFormat` seam does not carry either of these yet:** `pointerAt`
takes a line and returns a foreign file path, and the LSP's `definition`
discards the cursor column. Widening that seam to carry a column and a
same-document target belongs to this concern, not ahead of it.

## Task 1 — widen the `SteeringFormat` seam

Paths: `src/SteeringFormat.ts`, `src/Lsp.ts`, `src/ReviewDoc.ts`.

All three changes are additive.

- `pointerAt` takes a position, not a line:
  `(content, position: { line, character }) => SteeringPointer | undefined`. The
  existing review hunk jump ignores `character`, so its update is mechanical
- `SteeringPointer.path` becomes optional. **Absent means "this same document"**
  — the minimal shape that carries a footnote jump without a discriminated union
- `SteeringPointer` gains an optional `character`, defaulting to 0, so a jump
  can land on a marker's exact column
- The LSP's `definition` passes the whole position through, and its
  pointer-to-`Location` translation uses the document's own URI when `path` is
  absent and the pointer's `character` for the range

`actions` already receives a range carrying `character` — no change there.

Acceptance criteria:

- [ ] `pointerAt` receives a position, and the review hunk jump behaves exactly
      as before at any column on a hunk pointer line
- [ ] A pointer with no `path` resolves to a `Location` in the SAME document's
      URI
- [ ] A pointer's `character` lands in the returned `Location`'s range; an
      absent `character` lands at column 0
- [ ] A pointer with a `path` still resolves against the git working-tree root,
      including the existing hyphenated-path case
- [ ] The compiler rejects nothing silently — the widened signature is typed,
      not `any`

## Task 2 — the "add a footnote" code action, in both formats

Paths: `src/OpenQuestions.ts`, `src/ReviewDoc.ts`.

Title: `gtd: add a footnote`. One action carrying two edits.

**Marker column, one rule, no branching: scan right from the cursor while the
character is a word character, and insert there.** That satisfies both required
cases at once — cursor inside a word lands the marker at the word's end, cursor
already just past the word lands it at the cursor.

**Name generation: `fn1`, `fn2`, … the first integer unused by any marker or
definition in the document.** Deterministic — no clock, no randomness — so the
action is testable and idempotent under re-run.

**Definition body: seeded `your comment`, not empty.** An empty definition is
oxfmt-stable but invisible in an 80-column reflowed document; a seeded
placeholder is findable. The validator reports a definition still carrying that
placeholder, so a never-filled footnote can never reach an agent as a concern —
the same mechanism the unfilled free-text answer slot already uses.

**Definition placement: below the whole block the marker sits in** — for a
review hunk, the last non-blank line before the next pointer or `##` heading;
for a list, the last line of the contiguous list; otherwise the next blank line
or end of file. Never below the current paragraph alone: inside a
multi-paragraph hunk note that would split the note span. The definition may
therefore sit several paragraphs away from its marker, which is what
go-to-symbol exists for.

Acceptance criteria:

- [ ] Cursor inside a word: the marker is inserted at that word's end
- [ ] Cursor immediately past a word: the marker is inserted at the cursor
- [ ] Cursor on whitespace or punctuation: the marker is inserted at the cursor
- [ ] The generated name is the first unused `fnN`, skipping any `fnN` already
      present as a marker or a definition
- [ ] Running the action twice yields `fn1` then `fn2`, never a collision
- [ ] The definition is seeded with the placeholder body, and the validator from
      package 01 reports it until it is replaced
- [ ] In a review hunk with a multi-paragraph note, the definition lands after
      the LAST non-blank line of the hunk's span — the note is not split
- [ ] Inside a list, the definition lands after the last line of the contiguous
      list, not between two items
- [ ] In ordinary prose, the definition lands after the current block's last
      line
- [ ] The action is offered in both the `qa` and `review` formats
- [ ] Applying the action's edits produces a document that both `validate`s
      clean apart from the placeholder finding, and is an oxfmt fixed point

## Task 3 — go-to-symbol, both directions

Paths: `src/OpenQuestions.ts`, `src/ReviewDoc.ts`.

`pointerAt` resolves, in this order:

1. Cursor within a marker's `[^name]` span → the definition's line, same
   document
2. Cursor on a definition line → the FIRST marker of that name, at its exact
   column, same document
3. `review` only: the existing hunk-pointer jump to another file

**Footnotes are checked first because they are column-scoped and the hunk jump
is line-scoped** — a marker sitting in a hunk's inline note would otherwise be
shadowed by the hunk jump. `qa` gains a `pointerAt` it never had, serving
footnote jumps only.

Error handling: an orphan marker or orphan definition resolves to `undefined`,
so `definition` returns an empty location list. **The LSP never throws on a
half-written footnote** — the diagnostic from package 01 is what tells the
human.

Acceptance criteria:

- [ ] Cursor on a marker jumps to its definition's line in the same document
- [ ] Cursor on a definition jumps to its first marker's line AND exact column
- [ ] Cursor on a marker that sits inside a review hunk's inline note jumps to
      the footnote, NOT to the hunk's target file
- [ ] Cursor elsewhere on that same hunk pointer line still jumps to the hunk's
      target file
- [ ] An orphan marker and an orphan definition each return an empty location
      list rather than throwing
- [ ] A marker in a `qa` file jumps, proving `qa` now serves `pointerAt`

## Task 4 — protocol-level coverage

Paths: `src/Lsp.test.ts`, `tests/integration/features/lsp.feature`.

Unit coverage runs against the existing fake LSP environment. The integration
scenario drives real subprocess stdio JSON-RPC, so it is `@live` like the rest
of that feature file.

Use composable, generic Given steps and expose the actual file content in the
scenario text — never hide setup behind an abstract step name. Inline the step
logic into the step definitions rather than chaining helpers.

Acceptance criteria:

- [ ] `src/Lsp.test.ts` covers the widened seam and both jump directions against
      the fake environment
- [ ] A `cucumber.js` scenario in `tests/integration/features/lsp.feature`
      requests the code action over stdio, applies the returned edits, and shows
      both the marker and the definition in the resulting document
- [ ] A scenario drives a `textDocument/definition` round trip: marker →
      definition → marker
- [ ] The scenario text shows the fixture's real file content, using the
      existing composable Given steps for a test project and a started LSP
      server
- [ ] `npm test` is green, and `npm run format:check` passes
