## correctness: a wrong `(unchanged)` marker leaves the build turn no way out

`requireDeclaredTests(pkg, from, "build")` refuses any marked test whose status
is `modified`, `.gtd/SATISFIED.md` or not, and reads the package text as of
`from`, so the builder cannot drop the marker either. When decompose marks a
test that the package really does have to change, every retry of
`packages.item.building` is refused the same way. Only a person stepping in gets
the process moving again. This follows the design as written, so it does not
block. Still, nothing in the refusal text or the building prompt tells the
builder what to do when the marker is wrong (stop and escalate rather than keep
retrying). Consider adding one line to the `revert them` refusal or to
`packagesItemBuildingPrompt` that says a marker the package must break goes back
to a person.

## correctness: README says a marked test must stay untouched, which is broader than the code

The README now says a test marked `(unchanged)` "must exist and stay untouched".
Only the build turn enforces that. A suite-fix turn may modify a marked test
(`turn === "fix"` skips the modified check, and the e2e scenario "a suite fix
that edits a marked test the build left alone advances" pins this). The feature
file's description gets it right ("stay untouched on the build turn"), but the
README does not. Change it to "must exist, and the build turn must leave it
untouched" so users are not misled about what the fix loop may do.

## correctness (nit): the heading half of "never extends an entry across a new item or a heading" guards nothing

In that unit test, the `## Notes` heading turns `inTests` off, so the indented
`(unchanged)` line after it is skipped by the `!inTests` branch whether or not
the heading branch calls `flush()`. Delete that `flush()` and the test still
passes. The one input the flush matters for is a heading that re-opens Tests,
e.g. `"## Tests\n- unit: \`a.test.ts\`\n## Tests\n
(unchanged)\n"`. Without the flush, `a.test.ts` would come out marked. Use that
input, or drop the heading from the test's name.

## ponytail-review: `requireDeclaredTests` gained a required parameter, which breaks a public export

What this change does: the build turn of a package is now refused when it edits
a test that decompose marked `(unchanged)`, and the `## Tests` parser now reads
entries oxfmt wrapped over several lines. Load assumed: one person or driver
running one gtd process per worktree, so no scale concerns apply.

1. **Public export changed signature without a `!`**
   (`src/workflows/feature/packages.ts:68`)
   - **What this is:** `requireDeclaredTests` is re-exported from
     `@pmelab/gtd/workflows` and `@pmelab/gtd/workflows/feature`, which
     COMPATIBILITY.md puts under "Follows package SemVer" (each export's name,
     type and behaviour). It shipped as `(pkg, since)` since v19.0.0.
   - **Problem:** it is now `(pkg, since, turn)` with `turn` required. A user's
     `gtd.config.ts` that calls `requireDeclaredTests(pkg, from)` in a custom
     package loop stops type-checking after a non-major upgrade.
   - **Fix:** default the parameter to the old behaviour:
     `turn: DeclaredTestsTurn = "fix"` (the `"fix"` path is exactly the old
     check, with no modified-test refusal). One token; no caller changes, no `!`
     needed. Otherwise the squash title needs `!` and a `BREAKING CHANGE:`
     footer per docs/commits.md.
   - **If we skip it:** the change merges as a fix/minor while breaking configs
     that reuse the export.

Verdict: fix 1 first.

## test-audit: the new wrapped-entry table makes two older parser tests redundant

`reads an entry whose path or marker is wrapped, in any line-end style`
(`src/workflows/feature/packages.test.ts`) checks the form
`- unit: \`a/long.test.ts\`\n
(unchanged)`under LF, CRLF and CR, with the exact expected output. That covers everything in`parses
CRLF and lone CR like LF, including a wrapped marker`and`reads a marker oxfmt
wrapped onto a continuation
line`, so the same parser behaviour now has three owners. Delete those two tests. If the longer `some/long/dir/`path matters, add it to the`forms`
table. Not blocking.

## test-audit: the e2e "refused even with SATISFIED.md written" scenario repeats the unit contract

`refuses a marked test the build modified, even with SATISFIED.md` already loops
`satisfied` over `[false, true]` at the unit level, where that rule lives. The
e2e scenario
`a build that edits a marked test is refused even with SATISFIED.md written`
adds no new transport or lifecycle risk. The plain
`a build that edits a test marked (unchanged) is refused` scenario already
proves the `"build"` argument reaches the build turn, and the fix-turn scenario
proves the `"fix"` argument reaches the fix turn (swapping the two arguments
fails both). Drop the SATISFIED variant. Not blocking.

## test-audit (nit): an e2e scenario name no longer matches its contract

`Scenario: a test marked (unchanged) needs only to exist in the tree`
(`tests/integration/features/declared-tests.feature:175`) uses the old rule's
wording, which this change removed from the prompt and the README ("needs only
to exist"). The scenario still passes, because the build never touches the file.
Rename it to something like "a test marked (unchanged) that the build leaves
untouched passes", so the name says what it exercises.

## test-audit (nit): negative prompt assertions guard text nobody would re-add

In `src/workflows/shared/text.test.ts`, the checks
`not.toContain("never one it leaves untouched")`,
`not.toContain("needs only to exist")` and
`not.toContain("leave that file alone")` only look for removed wording. The
positive `toContain` checks beside them already pin the new contract, so these
lines are change-history assertions that no plausible regression would trip.
Delete them.

## conventions: the squash message must follow the breaking-change tiers unless `turn` gets a default

AGENTS.md: "Whether a change is breaking (`!`) is decided by the tiers in
COMPATIBILITY.md". COMPATIBILITY.md puts "Entrypoint exports — every subpath of
the one package, each export's name, type and behaviour" under "Follows package
SemVer". `requireDeclaredTests` reaches `@pmelab/gtd/workflows/feature` through
`export * from "./packages.js"`, and its new required `turn` parameter is an
incompatible type change. This is the same issue as the ponytail-review chunk
above, seen from the conventions side: either default `turn` to `"fix"` (the old
behaviour), or the squash title needs `!` plus a `BREAKING CHANGE:` footer as
docs/commits.md requires. No other AGENTS.md / CLAUDE.md rule is broken. The
README was updated, the new scenarios are `@inmem` with their file content
written out, and no doc names a `src/*.ts` module.

## spec-challenge: the marker is per file, but the decompose rule speaks of tests, so one file listed both ways blocks the build

Decision (REQUIREMENTS concern 3, package 02): "list every test the package
writes or changes; also list an existing test a criterion relies on, marked
`(unchanged)`". Combined with concern 2, the build turn now refuses any marked
entry whose file is `modified`.

Invariant: a `DeclaredTest` is identified by its file path alone.
`declaredTests` does not dedupe, and `requireDeclaredTests` checks each entry on
its own. A "test" in the prompt's sense is a case or scenario, but the guard
only sees files. A package that adds a scenario to `x.feature` and also relies
on an existing scenario in that same file follows the new rule word for word:

```
- e2e: `x.feature`
- e2e: `x.feature` (unchanged)
```

On the build turn the first entry passes because the file is in the diff. The
second entry refuses with `revert them`, because the same file is `modified`. No
build can satisfy both, and the package text is read as of `since`, so the
builder can't fix the listing. This is the same dead end as the correctness
chunk on wrong markers, but here the decompose prompt's own rule leads to it.
The risk is real for shared files like `packages.test.ts` or one feature file
per area. Fix it either way:

- Add to the decompose rule: "never mark a file the package also writes or
  changes; list it once, unmarked".
- Or have `requireDeclaredTests` let an unmarked entry for the same path win
  over a marked one.

A unit case with both entries and one `modified` change would pin the choice.
Not blocking.

## spec-challenge: the "required union" answer conflicts with the SemVer tier for entrypoint exports

ARCHITECTURE's answered question "What shape does the turn parameter take?"
settles on "a required `"build" | "fix"` string union … both callers live in
`packageItem`". That reasoning holds only inside the repo. COMPATIBILITY.md
covers every export of `@pmelab/gtd/workflows/feature`, and that includes
`requireDeclaredTests`, under "Follows package SemVer". So user configs are
callers too. The spec decision is where the break the ponytail-review and
conventions chunks report comes from. The fix is the one they give (default
`turn` to `"fix"`, or `!` plus a `BREAKING CHANGE:` footer). The spec's premise
"both callers live in `packageItem`" is the part that is wrong.

## spec-challenge (nit): the `unchanged` field doc still states the old contract

`src/workflows/feature/packages.ts:18`: "Decompose placed ` (unchanged)`: the
test must exist, not be in the diff." Concern 2 changes this. On the build turn
a marked test must exist and must not be modified, and an added file still
passes. On a fix turn it may be modified. Reword it to "must exist; the build
turn must not modify it", or delete it, since `requireDeclaredTests`' JSDoc
already says this.
