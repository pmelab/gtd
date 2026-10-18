# Review: 3aef72b

<!-- base: 58010417ca610a20a4ea84d2805cca9c2759787e -->

**Two loosenings of the declared-tests guard, nothing else.** A `## Tests` line
marked `(unchanged)` needs only to exist, not be in the diff. A package whose
work lies outside the repository (filing issues, running commands) closes on
`.gtd/SATISFIED.md` evidence instead of an empty, refused build turn. No engine
change; the package text is still read as of the turn's start, so a builder
cannot add the marker to dodge the guard. Targeted vitest files pass.

## Scenarios

- [ ] ./tests/integration/features/declared-tests.feature#174-191 — a build that
      leaves an `(unchanged)` test untouched and changes only `src/widget.ts`
      advances to the health check.
- [ ] ./tests/integration/features/declared-tests.feature#192-207 — an
      `(unchanged)` test the build deletes is refused, naming the path.
- [ ] ./tests/integration/features/declared-tests.feature#208-233 — a builder
      adding `(unchanged)` to its own Tests line mid-turn is still refused: the
      guard reads the line as it stood when the turn started.
- [ ] ./tests/integration/features/declared-tests.feature#234-253 — with one
      marked and one unwritten unmarked line, the refusal says "not in the
      package's diff", names only the unwritten test, never the marked one.

## Guard: parse the marker, split the refusal by reason

**`DeclaredTest` gains `unchanged`; the guard sorts failures into two named
groups.** Marker counts only as the exact ` (unchanged)` right after the closing
backtick, followed by whitespace or line end; case-sensitive. An oxfmt-wrapped
marker on a continuation line is joined back first. Refusal keeps the
`gtd land: declared-tests:` prefix but its header changes to "declares tests
that are not satisfied", followed by "not in the package's diff" and/or "missing
from the tree" groups.

- [ ] ./src/workflows/feature/packages.ts#15-42 — marker field, regex, and the
      continuation-line join. FYI: the join runs over the whole file before
      section splitting and `\s+` spans blank lines, so an indented
      `(unchanged)` after a blank line also attaches to the item above. Matches
      markdown list-continuation semantics; harmless.
- [ ] ./src/workflows/feature/packages.ts#44-72 — per test: unmarked and no
      SATISFIED.md must be in the diff (not deleted); otherwise must exist in
      the tree. A marked test that was deleted lands in "missing from the tree".
- [ ] ./src/workflows/feature/packages.test.ts#1-67 — parser cases: exact-suffix
      rule (`(unchanged)x`, `(Unchanged)`, trailing prose after the marker) and
      the wrapped-marker join.
- [ ] ./src/workflows/feature/packages.test.ts#106-152 — guard unit test: one
      refusal carries both groups in order, each path under its own group, the
      existing marked test absent. Removing `!test.unchanged` turns it red.

## Prompts: decompose places the marker, build may close on out-of-tree evidence

**Decompose is told to list only tests a package writes or changes, marking an
untouched-but-named test `(unchanged)`; build is told SATISFIED.md covers
out-of-tree work, with per-criterion evidence and a duplicate check first.**
Out-of-tree closing is scoped in the prompt to packages with no `## Tests`; the
guard itself does not enforce that scope — with SATISFIED.md, existing tests
suffice as before.

- [ ] ./src/workflows/shared/text.ts#376-382 — decompose `## Tests` rule: list
      only changed tests; `(unchanged)` marker, placed only by decompose.
- [ ] ./src/workflows/shared/text.ts#417-433 — build prompt: SATISFIED.md for
      already-met or out-of-tree criteria; evidence may be issue URL or command
      output; search for an existing issue via `gh` before filing again; a
      marked line needs only to exist, leave that file alone.
- [ ] ./src/workflows/shared/text.test.ts#1272-1300 — pins the key phrases of
      both prompt changes.

## Docs

**README step 3 and the glossary follow the new behaviour.** No internal names
leak into prose.

- [ ] ./README.md#421-434 — `(unchanged)` lines need only exist; out-of-repo
      packages close on recorded evidence.
- [ ] ./CONTEXT.md#340-343 — "Satisfied package" now covers criteria met by the
      build turn's work outside the tree.
