# Spec feedback — 02 Pin geometry and empty renders

**One gap, Task 8. Everything else in the package holds.**

I re-flipped all 49 mutants the acceptance boxes name plus the nine `.trim()`
sites Task 8 points at. Scope constraints hold: only the four `*.test.ts` files
are touched, no new `export` in the four production modules,
`npm run format:check` green, `npm run deadcode` green, no CRLF file committed,
full unit suite green (1492 passed, 2 skipped).

## Fix this — Task 8, `ReviewDoc.ts:61`

**The header-trim test kills line 62, not line 61 — and line 61 is the site the
spec names.** Removing the `.trim()` at `src/ReviewDoc.ts:61`
(`lines.find((line) => line.trim().length > 0)`) leaves the whole suite green.

Why the current fixture misses it: `"   # Review: abc1234   "` is the document's
FIRST line, so `find` returns it whether or not the predicate trims. Only the
second trim, `HEADER_RE.exec(firstNonBlank.trim())` at line 62, is exercised —
and that one dies.

**A whitespace-only line BEFORE the header kills it.** I verified this fixture
fails under the mutant and passes clean:

```
"   ",                                                    // 0
"# Review: abc1234",                                      // 1
"<!-- base: abc1234def5678901234567890123456789abcd -->", // 2
"",
"## Chunk",
"",
"- [ ] ./src/x.ts#1",
"",
```

With the trim, `firstNonBlank` is the header and `shortHash` is `"abc1234"`.
Without it, `firstNonBlank` is `"   "`, `HEADER_RE` does not match, and
`shortHash` is `undefined`.

Task 8's box "Hand-removing the `.trim()` at each asserted site fails the suite"
is unchecked until this fixture (or an equivalent one) is added. Keep the
existing header test — it is a correct characterization of line 62, it just is
not a killer for line 61.

## Do not chase — six equivalent mutants

Each changes no observable output, so no test can kill it. **Leave the tests as
written; these belong in package 03's triage, not in a fix turn here.** The
first four were already ruled equivalent in the previous review round and I
re-confirmed all four; the last two are new to this round.

- **`ReviewDoc.ts:106` (`inlineNote` spread)** — line 190 destructures
  `inlineNote` out before the value becomes a `ReviewFile`, and line 187 reads
  it as `(pointer.inlineNote ?? "")`. `""` and absent are indistinguishable, and
  the key never reaches the `gtd next --json` payload. Task 5's
  `not.toHaveProperty("inlineNote")` box cannot be satisfied — that is a spec
  error, not a build gap. The other three spreads (`Edge.ts:532`, `:533`,
  `OpenQuestions.ts:311`) are asserted and all three mutants die.
- **`ReviewDoc.ts:196` `\s+` → `\s`** — `inlineSegment` can never start with
  whitespace: `inlineNote` is trimmed at line 100 and `NOTE_SEPARATOR_RE`'s
  trailing `\s*` strips any gap after a leading dash, so `split(...)[0]` is the
  same token either way.
- **`ReviewDoc.ts:427` with the `chunk.files.length > 0` conjunct dropped** —
  `toggleChunkEdits` returns `[]` for a zero-file chunk and the caller guards on
  `edits.length > 0`. The conjunct is redundant with that inner guard. All four
  boxes that name a `427` flip (`<=`→`<`, `&&`→`||`, whole condition → `true`)
  do die.
- **`OpenQuestions.ts:74` `\s+` → `\s`** — `match[2]` is trimmed and the input
  line is trimmed first, so `"###   Which API?"` yields `"Which API?"` under
  both regexes.
- **`OpenQuestions.ts:75` `(match[2] ?? "").trim()` removed** — the line is
  trimmed at 74 and the greedy `\s+` consumes every leading space, so `match[2]`
  carries neither leading nor trailing whitespace to begin with.
- **`OpenQuestions.ts:153` `option.text.trim()` removed** — `option.text` was
  already trimmed at line 144, and that trim dies under the package's
  free-text-placeholder test.
