# Review: 1f16330

<!-- base: 1db1ffdb196980c043c31b2d073f46b26fbb314e -->

**Verdict: all three concerns in `.gtd/REQUIREMENTS.md` (a0293738) are met; no
concrete defect found.** `packages.test.ts` passes 19/19.

## Scenarios

- [ ] ./tests/integration/features/declared-tests.feature#175-191 — Weakened:
      renamed from "a test marked (unchanged) needs only to exist in the tree".
      **No assertion is actually lost**: `Then it succeeds` and
      `And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"`
      are both still here, word for word, under the new name. REQUIREMENTS did
      not ask to drop them. Pins: a build that leaves a marked test alone
      advances.
- [ ] ./tests/integration/features/declared-tests.feature#283-300 — **a build
      turn that edits a marked test is refused**, and stderr names the file and
      says "revert".
- [ ] ./tests/integration/features/declared-tests.feature#302-329 — **a suite
      fix turn may edit a marked test** the build left alone; it lands and goes
      on to the health check.
- [ ] ./tests/integration/features/declared-tests.feature#331-353 — **a wrapped
      entry is read like a one-line entry**: the wrapped marked test passes, the
      wrapped unmarked test with nothing written is refused as "not in the
      package's diff".

## Tests entries parsed as whole list items

Concern 1. The old regex rejoin could glue a wrapped `(unchanged)` onto the
`## Tests` heading, so every entry under it disappeared. The parser now builds
each entry from a `- ` line plus the indented non-blank lines after it. A blank
line, a new item, a heading, or an unindented line ends the entry.

- [ ] ./src/workflows/feature/packages.ts#21-56 — new line-by-line parser.
      `TEST_LINE` now starts at `^-` because entries are trimmed. An indented
      `- ` line starts a new entry, so nested items still parse (as before).
- [ ] ./src/workflows/feature/packages.test.ts#68-118 — pins all four wrap forms
      in LF, CRLF and lone CR. Also pins: indented marker right after the
      heading keeps the heading, no extension across a new item or heading, an
      unindented line closes the entry. The old CRLF and wrapped-marker cases
      were folded into the new table, not dropped.

## Build turn refuses a modified marked test

Concern 2. `requireDeclaredTests` now takes the turn kind. **Only the build
turn** puts a modified marked test in a new `revert them` group; this holds with
`.gtd/SATISFIED.md` too. The fix-turn recheck still refuses a deleted marked
test (`restore them`) and a missing one. If a file is listed both unmarked and
marked, the unmarked entry wins.

- [ ] ./src/workflows/feature/packages.ts#58-93 — sorting per test, split into
      `diffBucket` / `treeBucket`. Same results as the old if/else for unmarked
      tests. A marked test the build _added_ is not counted as modified.
- [ ] ./src/workflows/feature/packages.ts#95-128 — new parameter, the
      unmarked-wins rule, and the `revert them` group placed between write and
      restore. Nit: **the `turn = "fix"` default is dead**: the only caller
      passes it explicitly, and if a future caller forgets it, the build check
      silently turns permissive. Make it required.
- [ ] ./src/workflows/feature/packages.ts#136-145 — `packageItem` passes
      `"build"` after the build turn and `"fix"` after each suite fix.
- [ ] ./src/workflows/feature/packages.test.ts#160-200 — the test helper gains a
      `turn` argument, defaulting to build.
- [ ] ./src/workflows/feature/packages.test.ts#255-320 — covers: refused with
      and without SATISFIED.md; fix turn may modify but not delete; unmarked
      wins; added is not modified; group order write → revert → restore →
      missing. **Accepted risk (in REQUIREMENTS): once the build lands, a fix
      turn can weaken a marked unit test and this guard will not see it.** Only
      e2e scenarios get a `Weakened:` check.

## Prompt and README wording

Concerns 2 and 3. The decompose rule no longer contradicts itself, and it shows
both marker forms. The build prompt now says editing a marked test refuses the
turn.

- [ ] ./src/workflows/shared/text.ts#376-385 — decompose rule rewritten as one
      rule. It adds: never mark a file the package also writes; list it once,
      unmarked. This matches the unmarked-wins code.
- [ ] ./src/workflows/shared/text.ts#433-438 — build prompt. FYI: "stop and
      leave it to a person" gives no way to hand off. In practice the turn lands
      without the edit, and the fix lap may then change the test.
- [ ] ./src/workflows/shared/text.test.ts#1272-1309 — pins the new wording of
      both prompts.
- [ ] ./README.md#421-434 — step 3 now says "must exist and the build turn must
      leave it untouched". The rest of the hunk is only reflow.
- [ ] ./tests/integration/features/declared-tests.feature#4-9 — the feature
      description says the same.
