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
