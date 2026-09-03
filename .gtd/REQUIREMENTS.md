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

**CommonMark is the contract wherever the tree and today's scanner disagree.** A
construct the tree does not see as a checkbox, heading, or footnote stops
counting, and a file that silently half-parsed today reports a positioned
finding instead of quietly losing an option or a hunk. Concretely that means
indent depth now decides: up to three spaces is still a list item or a heading,
four or more is an indented code block and no longer structure at all.

**Risk, blunt**: a steering file already sitting in a repo can start refusing a
turn mid-process — that is the accepted cost of the strict reading, and it lands
the moment the format it belongs to migrates. Every concern below that changes
what counts must name the construct it stops accepting, so the refusal is a
stated finding and not a surprise.

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

Three more real mis-reads fall out of the same change and want their own cases:
a `[^name]` inside a four-space indented code block (the fence tracker only
knows backtick fences, never `~~~` and never indented blocks), a marker inside a
double-backtick span (the inline-code masker handles single backticks only), and
a definition inside an inline-code span (masking is applied before marker
scanning but not before the definition match).

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
format reports a bogus section-order finding.

**Acceptance, strict reading**: a `### ` indented four or more spaces is
indented code and no longer a question heading, and a `- [ ]` indented four or
more spaces is no longer an option. Today both count, because the heading check
trims the line before matching and the checkbox regex is indent-tolerant. Two or
three spaces still count, per CommonMark. A file relying on the loose reading
loses that question or option and says so with a positioned finding.

The free-text slot stays identified positionally — the last option in the block
— not by label. Nothing about the tree changes that.

### 3. The `review` format on the tree — PRODUCT

The header, the `<!-- base: … -->` comment (an `html` node), chunk headings,
hunk pointers, and the notes gathered below them all come from nodes. Chunk
ticking stops being a document-wide multiline regex — the one the code itself
documents as able to anchor across a blank line and drag a later line into the
match — and becomes an edit per list item.

**Acceptance**: a `- [x] ./file.ts#1` indented two spaces is a hunk pointer AND
is cleared by `gtd uncheck`; the same line indented four spaces is indented code
and neither. Today the two-space case is the live bug: the chunk-body parser
matches it on the _trimmed_ line, so it counts as a ticked hunk, while the
clearing regex anchors its `-` at column 0 and never touches it — so that tick
reaches a commit, which is exactly what the review-gate reset exists to prevent.

**Acceptance**: a `- [x] ./file.ts#1`-shaped line inside a fenced code block in
a chunk description is neither a hunk pointer nor touched by ticking the chunk.

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

## Answered Questions

### When the tree disagrees with today's line scanner about a file a human already wrote, does the stricter reading win?

Yes. CommonMark is the contract: a construct the tree does not see as a
checkbox, heading, or footnote stops counting, and a file that silently
half-parsed today reports a positioned finding rather than quietly losing an
option or a hunk. The cost — an existing steering file can start refusing a turn
— is accepted and named at the top of this document.

### Do `gtd check`'s printed findings grow a column?

Yes. It prints `file:line:col: message`, the format editors and grep-style tools
already jump on.

### Does the migration also replace the steering modes' `format:` command with a tree-based serializer?

No. `.gtd/` is oxfmt-formatted and that is load-bearing across every gate that
runs the suite; the sketch asks for parsing, and both rewrite paths stay
surgical text edits rather than a reserialized document.

### Does either steering format's own syntax change?

No. The canonical `qa` and `review` documents are unchanged byte for byte — what
moves is only what the parser recognizes around them.
