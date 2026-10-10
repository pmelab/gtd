# Steering formats

Steering files are committed into a process's history and read back on every
replay, so each format below is a contract with every file already written in
it. Each one is pinned by the files in `fixtures/` and the contract tests that
read them.

## The formats

- **`qa`**: open questions. `### Question` headings under `## Open Questions`,
  each with `- [ ]` option checkboxes; an option may carry nested bullets, and
  `- [ ] _your answer_` is the free-text slot. A ticked box is an answer.
- **`review`**: a review document. A `# Review: <sha>` title and a
  `<!-- base: <sha> -->` comment, then `##` chunks with prose and `- [ ]` hunk
  pointers (`./path`, `./path#start-end`), each optionally followed by
  `— <note>`. A pointer note starting `Risk:` is a reviewer's risk. A ticked
  pointer is a hunk the human has read.
- **Free-form**: any markdown, for a file with no mode or an unknown one. Only
  its threads are validated.
- **Threads**, shared by all three: a footnote whose definition is a list of
  alternating `- H:` / `- A:` entries. Any other footnote is a one-shot note.
- **Code threads**: `H:` / `A:` line comments (`//`, `#`, `--`, `;`, chosen by
  file extension) in a changed code file. A comment run is a thread only when
  its first line starts `H:`.
- **Review notes**: what a human added to a `review` document since the reviewer
  wrote it — changed chunk prose, pointer notes, and new one-shot footnotes,
  never threads. **This is the hand-off from the `review` workflow to the `fix`
  workflow**: `fix` reads its work from these notes and the risks, so a file
  `review` wrote must read the same in any `fix` that consumes it.

## What may change

Compatible — no format bump:

- Reading something new that was invalid before (a new optional field, a relaxed
  rule), as long as no gtd writer produces it. Once a writer does, older gtd
  cannot read the files it writes: that is breaking.
- A new or reworded validation finding for content that was already invalid.
- A change to how a file is shown (view, outline, editor actions) that reads the
  same content out of it.

Breaking — committed files, or files an older gtd must read, are affected:

- A file that read clean before now has findings, or reads differently: other
  questions, options, chunks, hunks, ticks, threads or notes.
- A writer (a tick, a note, a reply) produces text an older gtd cannot read.
- Renaming or removing a marker: `## Open Questions`, `_your answer_`,
  `# Review:`, `<!-- base: -->`, `Risk:`, `H:` / `A:`.

## Format changes bump `Gtd-Format`

Steering files are part of the history format. A change that stops older files
from being read the way they were written is a new history format: bump the
`Gtd-Format` trailer, and keep reading the previous format. Never edit a fixture
to make a breaking change pass. Add a fixture in the new format beside the old
one instead.
