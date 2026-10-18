# Quality findings

## correctness — anti-dodge scenario never exercises the dodge

`tests/integration/features/declared-tests.feature`, scenario "a builder adding
the marker to its own Tests line cannot dodge the guard": the declared test is
`lib/widget.test.ts`, which does not exist in the tree. A marked test missing
from the tree is refused anyway, so the scenario passes even if
`requireDeclaredTests` read the package's CURRENT text instead of its `before`
text — it would not fail with the guarded behaviour removed. No unit test covers
it either. The only thing stopping a builder from marking its own line is the
`range.get(pkg)?.before` read, and nothing pins it.

Fix: declare `lib/existing.test.ts` (present in Background, untouched by the
turn) unmarked, have the build turn add ` (unchanged)` to that line and change
`src/widget.ts`, and expect a refusal naming `lib/existing.test.ts`. Blocking:
this is the invariant Concern 1 calls out ("a builder adding the marker to its
own `## Tests` must never dodge the guard").

## correctness — unwritten unmarked test lands in the wrong refusal group

`src/workflows/feature/packages.ts` `requireDeclaredTests` checks
`read(test.path) === undefined` first, so an unmarked test the builder never
wrote (absent file — the common case) is reported under "missing from the tree",
not "not in the package's diff". The package's Task 2 asks for "an unmarked
unwritten test under the first group". The unit test only passes because its
fixture makes `lib/unwritten.test.ts` exist (`read` returns `"x"`), so it pins
an unrealistic case rather than the spec'd one; the e2e scenario "an unmarked
unwritten line is refused…" asserts only the path, not the group.

Side effect: the `range.get(test.path)?.status === "deleted"` arm is now
unreachable — a deleted file is absent from the tree and already went to
`notInTree`.

Fix: for unmarked lines without `.gtd/SATISFIED.md`, classify by diff first (not
in range / deleted → "not in the package's diff"), and use "missing from the
tree" only for marked or SATISFIED lines; make the unit fixture's unwritten test
genuinely absent. Should, not blocking — both groups still refuse.

## correctness — out-of-tree work is not idempotent across a retry

`src/workflows/shared/text.ts` `packagesItemBuildingPrompt`: the builder is told
to do out-of-tree work (file issues, run commands) FIRST, then write
`.gtd/SATISFIED.md`. If the turn dies or is refused after the side effect but
before the evidence file is landed (crash, refused land, empty turn → stall),
the retry sees an unchanged tree; the prompt's only pre-check is "check its
acceptance criteria against the current tree", which cannot see filed issues.
The retry therefore starts over and files duplicate issues instead of resuming.

Fix: add one rule — before doing out-of-tree work, check whether it was already
done (e.g. search for an existing issue with the same title via `gh`) and reuse
it as evidence. Should.
