Replace every hand-rolled markdown parser in gtd with a real syntax tree
(mdast), and spend the positions it gives back on findings, outlines, and editor
jumps.

All markdown parsing in gtd lives in exactly three modules — `Footnotes`, the
`qa` format, and the `review` format — and every one of them scans
`content.split(/\r?\n/)` with regexes. That has a shared failure mode: a
steering file that _quotes_ the format it is written in breaks its own
validator, because a line loop cannot tell a heading from a heading inside a
fenced block. The footnotes work that just landed already had to pay for this
twice, with a hand-rolled fence tracker and an inline-code masker, and accepted
an O(n²) rescan as the price.

## Open Questions

### When the tree disagrees with today's line scanner about a file a human already wrote, does the stricter reading win?

- [ ] Yes — CommonMark is the contract. A construct the tree does not see as a
      checkbox, heading, or footnote stops counting, and a file that silently
      half-parsed today reports a positioned finding instead of quietly losing
      an option or a hunk
- [ ] No — keep today's leniency wherever the two disagree, so no steering file
      already sitting in a repo can start refusing a turn mid-process
- [ ] _your answer_

### Do `gtd check`'s printed findings grow a column?

- [ ] Yes — print `file:line:col: message`, the shape editors and grep-style
      tools already jump on, so a driver's raw output becomes clickable
- [ ] No — keep `file:line: message` so anything parsing that output keeps
      working; columns stay inside the LSP
- [ ] _your answer_

## Concerns

### 1. One parse per document, footnotes read off the tree — TECHNICAL

Bring in the markdown parser and make `Footnotes` read GFM footnote nodes
instead of scanning lines. Fenced code and inline code stop being special cases
the module tracks by hand — they are simply other node types — so the fence
tracker and the inline-code masker are deleted rather than ported. The parsed
document is produced once per file at the format entry point and handed down,
which is what actually retires the per-call fence recomputation the footnotes
work accepted: roughly 4M line tests on a 2000-line review file, re-run on every
keystroke in the LSP.

Both steering formats keep their current line-based parsing here and keep
consuming footnotes through the same helpers, so the suite stays green without
either format moving yet.

**Acceptance**: a footnote definition below a fence that was opened _above_ the
enclosing question or chunk is not a definition. Today the fence check is handed
a slice of the document — a question body, a chunk body — so a fence opened
before the slice starts is invisible to it. And parsing a 2000-line document
performs one parse, not one per line, asserted by counting parses rather than by
timing.

Two more real mis-reads fall out of the same change and want their own cases: a
`[^name]` inside a four-space indented code block (the fence tracker only knows
backtick fences, never `~~~` and never indented blocks), and a marker inside a
double-backtick span (the inline-code masker handles single backticks only).

Adding dependencies rewrites `package-lock.json`; the human's tree already
carried unrelated lock churn from an install, which lands here as noise.

### 2. The `qa` format on the tree — PRODUCT

Headings, checkbox options, wrapped-option spans, section ordering, and the code
action's insertion point all come from nodes. `listItem.checked` replaces the
checkbox regex, and `toggleCheckbox`'s `raw.indexOf("[")` — a guess at where the
box is — is replaced by the box's real offset. An option's `endLine` stops being
inferred from continuation-line indentation.

**Acceptance**: a `## Open Questions` line inside a fenced code block is not
that section. Today `checkSectionOrder` does a bare `findIndex` for the literal
string with no fence awareness, so a requirements file that documents its own
format reports a bogus section-order finding. Second case: an indented `### `
nested inside a list item is not a question heading — the heading check trims
the line before matching, so today it is one.

### 3. The `review` format on the tree — PRODUCT

The header, the `<!-- base: … -->` comment (an `html` node), chunk headings,
hunk pointers, and the notes gathered below them all come from nodes. Chunk
ticking stops being a document-wide multiline regex — the one the code itself
documents as able to anchor across a blank line and drag a later line into the
match — and becomes an edit per list item.

**Acceptance**: an indented `- [x] ./file.ts#1` is either cleared by
`gtd uncheck` or not a hunk pointer at all. Today it is both: the chunk-body
parser matches it on the _trimmed_ line, so it counts as a ticked hunk, while
the clearing regex anchors its `-` at column 0 and never touches it — so that
tick reaches a commit, which is exactly what the review-gate reset exists to
prevent. Second case: a `- [x] ./file.ts#1`-shaped line inside a fenced code
block in a chunk description is neither a hunk pointer nor touched by ticking
the chunk.

**Risk, blunt**: `gtd uncheck`'s clearing pass must stay byte-preserving outside
the one changed character. It is a whole-document regex replace today precisely
to avoid a split-and-join, which would normalize line endings and turn a
tick-only round on a CRLF checkout into a whole-file diff at the review gate.
Parsing moves to the tree; this rewrite stays a surgical positional edit, never
a reserialized document.

### 4. Findings and outlines that point at the offending token — PRODUCT

A finding gains a range, and every finding that already knew where it was starts
saying so. Concretely: the `qa` format's three structural findings and the
`review` format's chunk-has-no-pointers, missing-header, and missing-base
findings are all unpositioned today while holding the line number in scope;
`parseReviewDoc` downgrades positioned findings to bare strings, which is why a
second parse function exists purely to route around its own return type; and the
four footnote findings know the marker's column and drop it, because a finding
has no column field to put it in. Unanswered-question output names the question
and not its heading line.

Outline node ranges stop being computed as _next sibling's heading minus one_ —
a guess that swallows trailing blank lines and any intervening content — and
come from real node boundaries. With a precise range on the pointer token,
`review`'s `./path#42` hunks also become document links, clickable without going
through go-to-definition.

**Acceptance**: `gtd check qa` on a file whose `## Answered Questions` is
followed by another `##` section reports that finding with a line number; today
it prints a bare message. And the LSP diagnostic for it underlines the offending
heading instead of spanning the whole document, which is the current fallback
for any unpositioned finding.

## Answered Questions

### Does the migration also replace the steering modes' `format:` command with a tree-based serializer?

No. `.gtd/` is oxfmt-formatted and that is load-bearing across every gate that
runs the suite; the sketch asks for parsing, and both rewrite paths stay
surgical text edits rather than a reserialized document.

### Does either steering format's own syntax change?

No. The canonical `qa` and `review` documents are unchanged byte for byte — what
moves is only what the parser recognizes around them.
