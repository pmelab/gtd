# 01 — Guard: marker parse and refusal text

See `.gtd/ARCHITECTURE.md` (Package A, Interfaces) for the pinned regexes and
refusal message. No signature changes.

## Requirements

**Concern 1 — Marker parse tolerates whitespace, case and CRLF, never joins
across blank lines.**

- **Any run of spaces or tabs (at least one) between the closing backtick and
  `(unchanged)` counts**, not exactly one space
- **The marker matches case-insensitively**: `(Unchanged)`, `(UNCHANGED)` mark
  the test; the existing `(Unchanged)` → `false` unit case flips to `true`
- **The trailing boundary stays**: `(unchanged)x` and
  `` `a.test.ts`(unchanged) `` do not mark
- **The level stays case-sensitive**: `- Unit:` is malformed and ignored
- **CRLF and lone CR parse exactly like LF**, including a CRLF-wrapped marker on
  its own continuation line
- **The continuation rejoin never crosses an empty or whitespace-only line**

**Concern 3 — Refusal header drops "satisfied", says "restore" for a deleted
marked test.**

- **Header and group labels never contain "satisfied" in any form**; header is
  `declares tests this turn left unmet:`
- **A marked test whose diff change is `deleted` goes to its own "restore them"
  group**
- Not-in-diff and missing-from-tree stay separate groups; group order: write,
  restore, missing; empty groups omitted
- **A marked path absent with no deletion in the diff stays under "missing from
  the tree"**; an unmarked deleted test stays under "write them"; with
  `.gtd/SATISFIED.md` written, an unmarked deleted test stays under "missing"

**Concern 5 — One `range.get` per declared test.** Look each path up once and
reuse the result. Pure refactor beyond concern 3.

## Tasks

### 1. Widen `declaredTests` parse

Paths: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`

- [ ] Text normalised with `replace(/\r\n?/g, "\n")` before any matching
- [ ] Rejoin uses `/\n[ \t]+(?=\(unchanged\))/gi` — `[ \t]`, never `\s`
- [ ] `TEST_LINE` captures the line remainder; level match keeps no `i` flag
- [ ] Separate marker regex `/^[ \t]+\(unchanged\)(?=\s|$)/i` on the remainder
- [ ] Unit cases: tab / several spaces mark; `(Unchanged)` / `(UNCHANGED)` mark
      (existing `d.test.ts` expectation flips to `true`); `(unchanged)x` and
      `` `a.test.ts`(unchanged) `` stay unmarked; CRLF text equals its LF twin
      incl. CRLF-wrapped continuation; empty-line and whitespace-only-line
      separation leaves the test unmarked; `- Unit:` ignored

### 2. Rewrite `requireDeclaredTests` grouping and message

Paths: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`

- [ ] `const change = range.get(test.path)` once per test; no second lookup
- [ ] Each failing test lands in exactly one group, checked in order: not in
      diff → deleted-restore (marked and `change?.status === "deleted"`) →
      missing from tree
- [ ] Message matches the ARCHITECTURE.md Interfaces block exactly, keeps the
      `gtd land: declared-tests:` prefix and `  - <path>` lines
- [ ] Unit: marked + deleted → "restore them" only
- [ ] Unit: marked, absent, no diff change → "missing from the tree"
- [ ] Unit: existing grouping test keeps diff-before-tree order and asserts the
      message never matches `/satisf/i`
- [ ] Unit: all three groups populated appear in order write, restore, missing
- [ ] Unit: counting `changesSince` fixture — each declared path's `get` called
      exactly once

### 3. Update the deleted-marked-test scenario

Paths: `tests/integration/features/declared-tests.feature`

- [ ] Existing "a test marked (unchanged) that the build deletes is refused"
      scenario asserts stderr contains "restore" and does not contain
      "satisfied"
- [ ] No step definition changes

## Tests

- unit: `src/workflows/feature/packages.test.ts`
- e2e: `tests/integration/features/declared-tests.feature`
