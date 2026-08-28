# Spec feedback — 02-pin-geometry-and-empty-renders

**Four acceptance checkboxes are unmet.** I hand-flipped all 44 mutants the spec
names, one at a time, against the full `npm run test:unit` suite (1493 tests,
green at baseline). **40 died. 4 survived.**

Everything else conforms: `git diff --stat` for this package lists only the four
`*.test.ts` files, no new `export` appears in any of the four production
modules, `npm run deadcode` is green, `oxfmt --check` on the four test files is
green, and `git grep -Il $'\r'` finds no committed CRLF file.

## 1. `ReviewDoc.ts:106` (`inlineNote`) — Task 5, no test exists at all

**No `not.toHaveProperty("inlineNote")` assertion exists anywhere in
`src/*.test.ts`.** Grep confirms zero hits for `inlineNote` across all test
files. The checkbox is simply not done.

**But writing it is impossible under this package's own constraints, and the
spec's stated risk for this site is wrong.** `inlineNote` never reaches the
`gtd next --json` payload:

- `ReviewDoc.ts:190` destructures it straight off —
  `const { inlineNote: _inlineNote, ...pointerFields } = pointer` — so no public
  output ever carries the key, spread guard or not.
- The only other read is `ReviewDoc.ts:187`,
  `(pointer.inlineNote ?? "").replace(...)`, where `""` and `undefined` collapse
  to the same value through `??`.
- `parseFilePointer` is module-private (callers: lines 131, 226, 336 only) and
  the package forbids widening the export surface.

**Mutating the guard to `true` therefore changes no observable output — it is an
equivalent mutant.** Record it as such (Stryker `// Stryker disable` comment or
an equivalent-mutant note in package 03's triage). Do not add a test, and do not
export `parseFilePointer` to reach it.

Correct the spec's claim while you are there: of the four Task 5 spread sites,
only `Edge.ts:532`, `Edge.ts:533` and `OpenQuestions.ts:311` shape a
driver-visible payload. `ReviewDoc.ts:106` does not.

## 2. `OpenQuestions.ts:74` `\s+` → `\s` — Task 7, test written but does not kill

The test
`"parses a heading separated from its text by two or more spaces identically to a single space"`
(`OpenQuestions.test.ts`, `heading regex anchors`) **passes with the mutant
applied.**

Reason: line 75 runs `(match[2] ?? "").trim()` on the capture. Under `\s`,
`"###   Which API?"` yields `match[2] === "  Which API?"`, which trims back to
`"Which API?"` — identical to the `\s+` result. **The trim erases the only
difference, so no fixture can distinguish the two through `parseHeading`.**
Equivalent mutant; record it, do not chase it.

## 3. `OpenQuestions.ts:75` `.trim()` removal — Task 8, violates its own checkbox

The test
`"recognizes a '###' heading indented with leading whitespace, trimming its text"`
**passes with `(match[2] ?? "").trim()` reduced to `(match[2] ?? "")`.**

Reason: line 74 already trims the whole line before matching, and `\s+` eats the
leading run. Its fixture `"   ###   Which API?   "` has nothing left for the
inner trim to remove.

**This trips Task 8's checkbox "No test is added for a `.trim()` call whose
removal changes no observable output."** The test's name claims it pins the
trim; it does not. Either give it a fixture where the inner trim is observable —
I found none reachable, since `line.trim()` at :74 strips both ends first — or
rename it to state only what it actually asserts (a `###` heading survives
leading indentation) and record the inner trim as equivalent.

## 4. `ReviewDoc.ts:196` `split(/\s+/)` → `split(/\s/)` — Task 7, test does not kill

The test
`"a second-pointer separated by two-or-more spaces is detected identically to a single space"`
(`ReviewDoc.test.ts`, `inline-segment whitespace splitting`) **passes with the
mutant applied.**

Reason: `inlineSegment` can never begin with whitespace, so `[0]` is the same
token under either regex. Three layers guarantee it:

- `FILE_POINTER_RE` (`:53`) captures `match[3]` after a greedy `\s+`, so the
  multi-space gap in the fixture never enters the capture.
- `:100` applies `.trim()` to that capture.
- `NOTE_SEPARATOR_RE` (`:57`, `/^[—–-]+\s*/`) strips its own trailing
  whitespace, so the `:187` replace cannot expose any either.

Equivalent mutant; record it, do not chase it.

## What a fix turn should produce

**Three code changes at most, and none of them is a new assertion:** the rename
or refixture of item 3, plus equivalent-mutant records for items 1, 2, 3 and 4.
**Do not widen any export to reach a private function** — the package's
constraint stands, and every one of these four mutants is unkillable behind it.
