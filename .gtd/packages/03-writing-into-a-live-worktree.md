# 03 — Writing into a live worktree

One requirement, unmerged. Its footprint is the **format** modules, which no
other package touches.

The load-bearing constraint: `mdast-util-to-markdown` is deliberately not a
dependency and there is no markdown serializer anywhere in this repository.
Every mutation is a byte-range edit spliced into the file's existing bytes. A
`split`/`join` round-trip would normalize line endings, which is why the
existing tick-clearing helper already documents itself as an offset splice.

## Requirement — concern 5

### 5. Writing into a live worktree — TECHNICAL

Editing is offered only when the worktree rests at a `human` state. Every tick
and every attached note writes through immediately, carrying a token of HEAD sha
plus a content hash of the steering file's bytes; the server re-reads both at
write time and writes only on a match. A mismatch rejects outright — no semantic
re-apply, no merge — and the input survives as a client-persisted draft with a
banner naming what changed. A background refresh replaces the screen only when
no draft exists.

**Acceptance**: the compare-and-swap is the only staleness guard there is.
Emitted scripts carry no expiry check, so a script must be generated and run
promptly and never queued. See [#215](https://github.com/pmelab/gtd/issues/215).

## Tasks

### T1 — `SteeringFormat` grows `view` and `annotate`

Two new **mandatory** members, unlike the optional pointer and document-link
ones. `annotate` takes a content string plus an anchor and returns byte-range
edits; `view` returns that format's domain projection. The server then never
imports a format module and never switches on the mode name — it reads a view
and produces edits through the registry, exactly as the language server already
reads outline, actions and pointer resolution.

The payoff: **a user-declared custom mode lights up the phone UI for free** once
it registers a format, instead of showing nothing until someone writes a third
adapter.

The cost, stated plainly: `src/SteeringFormat.ts` is a zero-import vocabulary
file and **stays one** — it gains two union types and no imports. A widened core
interface is churn in a file the language server depends on; that is the price
of one seam instead of two.

Paths: `src/SteeringFormat.ts`, `src/SteeringFormats.ts`,
`src/SteeringFormats.test.ts`.

- [ ] both members are required, so a registry entry missing either fails
      typecheck
- [ ] `src/SteeringFormat.ts` still has zero imports
- [ ] a universal per-registry-entry test asserts every format's `view` of its
      own canonical sample parses
- [ ] a universal per-registry-entry test asserts every anchor that `view`
      reports is one `annotate` accepts
- [ ] the language server's existing behaviour is unchanged by the widening

### T2 — footnote insertion

Attaching a note is **two edits at once**: a marker at the anchor's end and a
definition. It is shared by chunk notes, hunk notes and paragraph notes alike,
so the mechanics belong beside the existing marker and definition readers, which
already own the naming rules including the case-insensitive fold. Ids are
**derived from the anchor, never counted**, so two concurrent attaches cannot
collide on the same name.

Paths: `src/Footnotes.ts`, `src/Footnotes.test.ts`.

- [ ] attaching produces exactly two edits and every byte outside their ranges
      is unchanged
- [ ] the marker lands at the end of the anchor's own text, not on a new line
- [ ] two attaches at two different anchors in one document produce two distinct
      ids
- [ ] two attaches at the same anchor are rejected rather than producing a
      duplicate id
- [ ] an id colliding with an existing definition, compared case-insensitively,
      is rejected
- [ ] a document with CRLF line endings keeps them
- [ ] the resulting document passes its own format's validator

### T3 — the two built-in formats implement the new members

The review format's view carries the review header hash, its chunks, and each
chunk's file pointers with path, line, ticked state and note. The question
format's view carries each question with its status, text, options and answered
flag. Tick edits already exist as single-character helpers in both modules —
reuse them rather than writing new ones.

Paths: `src/ReviewDoc.ts`, `src/ReviewDoc.test.ts`, `src/OpenQuestions.ts`,
`src/OpenQuestions.test.ts`.

- [ ] the review view exposes every chunk and every file pointer, including
      pointers nested at any depth
- [ ] the question view exposes both open and answered questions, in document
      order
- [ ] a chunk-level anchor and a hunk-level anchor are both accepted by
      `annotate`
- [ ] a paragraph anchor in a prose-only document is accepted by `annotate`
- [ ] an anchor that no longer resolves is rejected, not silently dropped
- [ ] both formats' views are built from one parse of the document, not one per
      element

### T4 — the compare-and-swap write

Every write carries HEAD's sha plus a content hash of the steering file's exact
bytes. The server re-reads **both** at write time and writes only on an exact
match. A mismatch **rejects outright** — no semantic re-apply, no merge, no
retry. **The compare-and-swap is the only staleness guard there is.**

Paths: `src/serve/Write.ts`, `src/serve/Write.test.ts`, `src/serve/Router.ts`.

- [ ] a write with a matching sha and hash succeeds
- [ ] a write whose sha moved is rejected and the file is untouched
- [ ] a write whose content hash moved is rejected and the file is untouched
- [ ] the rejection names which of the two moved
- [ ] a rejected write is never partially applied
- [ ] two writes racing on one file leave the file valid, with exactly one
      applied
- [ ] the content hash is over the file's exact bytes, so a whitespace-only
      change invalidates it

### T5 — the rest gate

Editing is offered only when the worktree rests at a human state. The server
re-checks this **at write time**, not only at render time, because the loop may
have moved on since the screen was drawn.

Paths: `src/serve/Write.ts`, `src/serve/Write.test.ts`.

- [ ] a write to a worktree resting at a human state succeeds
- [ ] a write to a worktree resting at an agent or check state is rejected
- [ ] the check runs on every write, not once per session
- [ ] the rejection is distinguishable from a compare-and-swap rejection

### T6 — drafts and the staleness banner

A rejected input **survives as a client-persisted draft** keyed on worktree id
plus file path, with a banner naming what changed. A background refresh replaces
the screen **only when no draft exists** for it.

Paths: `src/web/drafts.ts`, `src/web/drafts.test.ts`, `src/web/api.ts`.

- [ ] a rejected write leaves the typed text recoverable after a page reload
- [ ] the banner names what moved
- [ ] a background refresh with a draft present does not replace the screen
- [ ] a background refresh with no draft present does replace the screen
- [ ] discarding a draft clears it and lets the next refresh through
- [ ] drafts for two files in one worktree do not overwrite each other

### T7 — the formatter contradiction guard

The server writes raw bytes and normalizes nothing. It does not have to: this
repository gives both built-in modes a format command, and the beat's validate
script runs that formatter **ahead of** the validator, which the driver runs
before landing.

**Risk, blunt**: the formatter's markdown override is 80 columns with prose
wrapping always on, so a note the server writes gets reflowed before it is
committed, and a reflow that breaks the document's own validator deadlocks the
round rather than failing loudly. `src/ModeContradiction.ts` is the existing
guard for exactly that class of bug, and it round-trips each format's canonical
sample through the mode's format command — **the sample must grow a
server-written note so the guard covers this path.**

Paths: `src/ModeContradiction.ts`, `src/ModeContradiction.test.ts`,
`src/ReviewDoc.ts`, `src/OpenQuestions.ts`, `src/SteeringFormats.test.ts`.

- [ ] each format's canonical sample contains a note attached the way the server
      attaches one
- [ ] each sample still validates clean with zero findings
- [ ] each sample survives a round-trip through the formatter and still
      validates clean
- [ ] a note long enough to be reflowed at 80 columns still validates after
      reflow
- [ ] a note containing a multi-word inline code span still validates after
      reflow
- [ ] the guard fails loudly, naming the mode and the format, when a reflow
      breaks a sample

### T8 — the four refusals, named

A stale token, a rest that is not human, a file that vanished, and an anchor
that no longer parses are **four distinct typed refusals**, and the phone names
which one it got.

Emitted scripts carry no expiry check anywhere in gtd, so **a generated script
must be run promptly and never queued.**

Paths: `src/serve/Write.ts`, `src/serve/Router.ts`, `src/web/api.ts`.

- [ ] each of the four refusals is a distinct typed value, not one shared
      message string
- [ ] the phone renders a different sentence for each of the four
- [ ] a file deleted between render and write yields the vanished-file refusal,
      not a crash
- [ ] no refusal path leaves a partially written file
