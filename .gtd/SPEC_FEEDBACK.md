# Spec feedback — 02 Pin geometry and empty renders

Package 02 is one commit, `ca6ea1a9`, touching only the four `*.test.ts` files.
The scope constraints all hold: zero production edits, no new `export`,
`npm run deadcode` green, `npm run format:check` green, no CRLF file committed.
I hand-flipped all 49 mutants the spec's acceptance boxes name. **44 died. Five
survived. One of the five is a real, fixable gap; the other four are equivalent
mutants that no test can kill — do not chase them.**

## Fix this — Task 8, `ReviewDoc.ts:129`

**`ReviewDoc.test.ts`'s "treats a whitespace-only line as blank inside a
pointer's span" test does not kill its own mutant.** Removing the `.trim()` at
`src/ReviewDoc.ts:129` (`const trimmed = body[i]!.text.trim()`) leaves the whole
suite green.

Why the current fixture misses it: the whitespace-only line `"   "` is followed
by `"  second paragraph"`, so `end` advances past the whitespace line either
way. `endLine` lands on 8 with or without the trim, and `note` is built by
`gatherNote`, which trims separately. Nothing observable changes.

**A whitespace-only line as the LAST line of the span kills it.** I verified
this fixture fails under the mutant and passes clean:

```
"- [ ] ./src/calc.ts#1",   // 5
"  a note",                // 6
"   ",                     // 7
"- [ ] ./src/calc.ts#9",   // 8
```

With the trim, `endLine` is 6. Without it, the whitespace line is not skipped,
`parseFilePointer("   ")` does not break the loop, and `endLine` becomes 7.

Task 8's box "Hand-removing the `.trim()` at each asserted site fails the suite"
is unchecked until this fixture (or an equivalent one) is added. Keep the
existing test too — it is a fine characterization, it just is not a killer.

## Do not chase — four equivalent mutants

Each of these has a box in the spec, and each has a test written against it. The
test cannot kill the mutant because the mutant changes no observable output.
**Leave the tests as written; these belong in package 03's triage, not in a fix
turn here.**

**`ReviewDoc.ts:106` (`inlineNote` spread) is unobservable, so Task 5's
`not.toHaveProperty("inlineNote")` box cannot be satisfied.**
`src/ReviewDoc.ts:190` destructures `inlineNote` out of the pointer before it
becomes a `ReviewFile`, and `src/ReviewDoc.ts:187` reads it as
`(pointer.inlineNote ?? "")` — `""` and absent are indistinguishable at both.
`inlineNote` never reaches the `gtd next --json` payload, so the spec's "an
extra empty key is a protocol change a driver can see" is not true of this site.
That is a spec error, not a build gap. The other three spreads (`Edge.ts:532`,
`:533`, `OpenQuestions.ts:311`) are asserted and all three mutants die.

**`OpenQuestions.ts:74` `\s+` → `\s` is equivalent** because `match[2]` is
`.trim()`ed and the input line is `.trim()`ed first. `"###   Which API?"` yields
`"Which API?"` under both regexes. The written test (multi-space parses
identically to single-space) is correct and passes both ways by construction.

**`ReviewDoc.ts:196` `\s+` → `\s` is equivalent** because `inlineSegment` can
never start with whitespace: `inlineNote` is trimmed at `src/ReviewDoc.ts:100`,
and `NOTE_SEPARATOR_RE`'s trailing `\s*` strips any gap after a leading dash. So
`split(...)[0]` is the same token either way.

**`ReviewDoc.ts:427` with `chunk.files.length > 0` dropped is equivalent**
because `toggleChunkEdits` returns `[]` for a zero-file chunk and the caller
guards on `edits.length > 0`. The "Chunk B has zero file pointers" test the spec
asks for exists and is correct; the conjunct is simply redundant with the inner
guard. Requirement A's "either conjunct alone" survivor is unkillable at this
site. Task 1's own boxes do not require killing it, and all four boxes that name
a `427` flip (`<=`→`<`, `&&`→`||`, whole condition → `true`) do die.
