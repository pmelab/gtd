# Architecture: PR 401 review fixes for the declared-tests guard

Three packages. **No signature changes** — every interface below keeps its type;
what changes is parse behaviour, refusal text and prompt text, which are the
contracts pinned here.

**Dropped, not built:** the three deferred review notes (note-1
`runSummaryCommand` doc comment, note-2 `gtd history list` scenario, note-3
garbled-flag stdout assertion).

**Package A — guard parse and refusal (concerns 1, 3, 5)**

Footprint: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`,
`tests/integration/features/declared-tests.feature` (one existing scenario's
assertions).

**Parse (concern 1).** `declaredTests` normalises first, matches second:

- `packageText.replace(/\r\n?/g, "\n")` before anything else — **CRLF and lone
  CR parse exactly like LF**
- continuation rejoin becomes `/\n[ \t]+(?=\(unchanged\))/gi` — **`[ \t]`, not
  `\s`, so the rejoin never consumes a newline and never crosses a blank or
  whitespace-only line**; the lookahead is case-insensitive
- `TEST_LINE` drops its marker group and captures the rest of the line:
  ``/^\s*-\s+(unit|e2e):\s+`([^`]+)`(.*)$/`` — **level stays case-sensitive**
  (`- Unit:` is still malformed, ignored)
- marker test on that rest: `/^[ \t]+\(unchanged\)(?=\s|$)/i` — **one or more
  spaces/tabs required, any case, trailing boundary kept**, so `(unchanged)x`
  and `` `a`(unchanged) `` do not mark

A separate marker regex keeps the `i` flag off the level match; one combined
regex with `i` would start accepting `- UNIT:` lines.

**Refusal (concerns 3, 5).** `requireDeclaredTests` looks each path up once
(`const change = range.get(test.path)`) and sorts each failing test into exactly
one of three groups, checked in this order:

1. not `satisfied`, not marked, `change` absent or `deleted` → **not in the
   diff**
2. marked and `change?.status === "deleted"` → **deleted — restore**
3. `read(test.path) === undefined` → **missing from the tree**

**A marked path absent with no deletion in the diff stays in group 3** — there
is nothing to restore. An unmarked deleted test stays in group 1 (write it), as
today. With `.gtd/SATISFIED.md` written, an unmarked deleted test lands in group
3, as today.

**Package B — build prompt (concern 2)**

Footprint: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`.
Replace the single "First check…" bullet with flat rules, no "otherwise"
anywhere in the prompt.

**Package C — test-less package scenario (concern 4)**

Footprint: `tests/integration/features/declared-tests.feature` only. Consumes
the guard as Package A leaves it; adds a scenario, touches no step definition.
Closing is simulated the way `default-workflow.feature` does it: delete the
package file, `.gtd/SATISFIED.md` and `.gtd/ARCHITECTURE.md` (last package),
then land.

## Interfaces

```ts
// src/workflows/feature/packages.ts — signature unchanged, parse widened
export interface DeclaredTest {
  readonly level: "unit" | "e2e"
  readonly path: string
  /** Decompose placed `(unchanged)`: the test must exist, not be in the diff. */
  readonly unchanged: boolean
}
export const declaredTests: (packageText: string) => readonly DeclaredTest[]
// marked  ⇔ after the closing backtick: [ \t]+ "(unchanged)" (any case) then
//           whitespace or end of line; CRLF ≡ LF; a "(unchanged)" on its own
//           indented line joins the line directly above it, never across a
//           blank or whitespace-only line
```

```ts
// src/workflows/feature/packages.ts — signature unchanged, refusal text changed
export const requireDeclaredTests: (pkg: string, since: string) => void
// refuse() message, groups omitted when empty, in this order:
//
// gtd land: declared-tests: ${pkg} declares tests this turn left unmet:
// not in the package's diff — write them:
//   - <path>
// marked (unchanged) but deleted — restore them:
//   - <path>
// missing from the tree:
//   - <path>
//
// The header and group labels never contain "satisfied" in any form.
```

```ts
// src/workflows/shared/text.ts — signature unchanged, the SATISFIED bullet
// becomes these flat rules (wording may be tightened; substance may not drop):
export const packagesItemBuildingPrompt: (pkg: string) => string
// - First check the acceptance criteria against the current tree — an
//   earlier fix turn may already meet them
// - Every criterion already met in the tree: write `.gtd/SATISFIED.md` with
//   evidence per criterion — commit, file, symbol, issue URL, or command
//   output — and change nothing else
// - A package with no `## Tests` whose work lies outside the tree (issues
//   filed, commands run): first check it was not already done by an earlier
//   attempt (e.g. search for an existing issue with the same title via
//   `gh`) and reuse that as evidence, or do the work; then write
//   `.gtd/SATISFIED.md` with that evidence and change nothing else in the
//   tree
// - Any other package: implement it normally and write no
//   `.gtd/SATISFIED.md`
// (the remaining bullets — tests first, `(unchanged)` needs only to exist,
//  e2e wording, fan-out, leave the package file — stay as they are)
```

## Call Stacks

- `gtd land` (building / fix.suite turn) → `packageItem` `declared` wrapper →
  `requireDeclaredTests(pkg, from)` → `changesSince` + `read` (flows port) →
  `declaredTests(text)` → `refuse(message)` on any non-empty group
- build turn prompt → `build(pkg)` step → `packagesItemBuildingPrompt(pkg)`
  rendered for the agent
- test-less package → `requireDeclaredTests` (no declared tests, returns) →
  `healthy(...)` →
  `run("closing", removeScript([pkg, ".gtd/SATISFIED.md", ARCHITECTURE]))`

## E2E Scenarios

- e2e: `tests/integration/features/declared-tests.feature` — the existing "a
  test marked (unchanged) that the build deletes is refused" scenario asserts
  stderr contains "restore" and does not contain "satisfied" (covers concern 3)
- e2e: `tests/integration/features/declared-tests.feature` — new `@inmem`
  scenario: package file with no `## Tests` section; build writes only
  `.gtd/SATISFIED.md` (content shown, an issue URL as evidence); `gtd land`
  succeeds to `packages.item.health.check`, then to `packages.item.closing`;
  deleting the package file, `.gtd/SATISFIED.md` and `.gtd/ARCHITECTURE.md`
  lands `packages.item.closing → build.quality.correctness.reviewing`, and the
  package file and `.gtd/SATISFIED.md` do not exist (covers concern 4)

## Unit Tests

### declaredTests

- unit: `src/workflows/feature/packages.test.ts` — a tab, and several spaces,
  between the backtick and `(unchanged)` mark the test (covers concern 1)
- unit: `src/workflows/feature/packages.test.ts` — `(Unchanged)` and
  `(UNCHANGED)` mark the test; the existing `d.test.ts` (Unchanged) expectation
  flips to `true` (covers concern 1)
- unit: `src/workflows/feature/packages.test.ts` — `(unchanged)x` and
  `` `a.test.ts`(unchanged) `` stay unmarked (covers concern 1)
- unit: `src/workflows/feature/packages.test.ts` — CRLF text parses to the same
  result as its LF twin, including a CRLF-wrapped `(unchanged)` on its own
  continuation line (covers concern 1)
- unit: `src/workflows/feature/packages.test.ts` — a `(unchanged)` line
  separated from its test line by an empty line, and by a whitespace-only line,
  leaves that test unmarked (covers concern 1)
- unit: `src/workflows/feature/packages.test.ts` — `- Unit:` stays malformed and
  ignored (covers concern 1)

### requireDeclaredTests

- unit: `src/workflows/feature/packages.test.ts` — a marked test whose change is
  `deleted` is listed under "restore them", not under "missing from the tree" or
  "write them" (covers concern 3)
- unit: `src/workflows/feature/packages.test.ts` — a marked test absent from the
  tree with no change in the diff stays under "missing from the tree" (covers
  concern 3)
- unit: `src/workflows/feature/packages.test.ts` — the existing grouping test
  keeps its order (diff group before tree group) and asserts the message never
  matches `/satisf/i` (covers concern 3)
- unit: `src/workflows/feature/packages.test.ts` — with all three groups
  populated, they appear in the order write, restore, missing (covers concern 3)
- unit: `src/workflows/feature/packages.test.ts` — `changesSince` fixture whose
  `get` counts calls per path: each declared path is looked up exactly once
  (covers concern 5)

### packagesItemBuildingPrompt

- unit: `src/workflows/shared/text.test.ts` — the prompt never matches
  `/otherwise/i` (covers concern 2)
- unit: `src/workflows/shared/text.test.ts` — still carries "evidence per
  criterion", "commit", "symbol", "issue URL", "command output", "it was not
  already done", "via `gh`", "change nothing else" (covers concern 2)
- unit: `src/workflows/shared/text.test.ts` — names the already-met case, the
  no-`## Tests` out-of-tree case, and the implement-normally case with "no
  `.gtd/SATISFIED.md`"; the old "met by work outside the tree" and "do the work,
  then write the file" assertions are replaced (covers concern 2)
- unit: `src/workflows/shared/text.test.ts` — the existing `(unchanged)` /
  "needs only to exist" / "leave that file alone" case stays (covers concern 2)

## Merged Concerns

### Package A = concerns 1 + 3 + 5

All three center on `src/workflows/feature/packages.ts` and its test file;
concern 1 edits `declaredTests`, concerns 3 and 5 both rewrite the same loop in
`requireDeclaredTests`.

> ### 1. Marker parse tolerates whitespace, case and CRLF, never joins across blank lines — TECHNICAL
>
> `declaredTests` in `src/workflows/feature/packages.ts` reads the
> ` (unchanged)` marker too strictly and rejoins wrapped lines too loosely.
>
> - **Any run of spaces or tabs between the closing backtick and `(unchanged)`
>   counts**, not exactly one space
> - **The marker matches case-insensitively**: `(Unchanged)`, `(UNCHANGED)` mark
>   the test. The existing unit case asserting `(Unchanged)` → `false` flips to
>   `true`
> - **The trailing boundary stays**: `(unchanged)x` still does not mark
> - **CRLF package text parses the same as LF**, including a CRLF-wrapped marker
>   on its own continuation line (today the leftover `\r` breaks the rejoin)
> - **The continuation rejoin never crosses a blank line**: a `(unchanged)` line
>   separated from its test line by an empty (or whitespace-only) line is not
>   joined, so that test stays unmarked
> - Unit cases in `src/workflows/feature/packages.test.ts` cover each bullet

> ### 3. Refusal header drops the word "satisfied" and says "restore" for a deleted unchanged test — TECHNICAL
>
> `requireDeclaredTests` refuses with
> `declares tests that are not satisfied — write them first`. "Satisfied"
> collides with the **satisfied package** term (`.gtd/SATISFIED.md`), and "write
> them first" is the wrong remedy for a marked test the build deleted.
>
> - **The header avoids the word "satisfied"** in any form
> - **A test marked `(unchanged)` that the build deleted is told to be
>   restored**, under its own group, not told to be written
> - Not-in-diff and missing-from-tree paths stay listed as separate groups, as
>   today
> - Unit test in `packages.test.ts` and the `@inmem` deleted-marked-test
>   scenario in `tests/integration/features/declared-tests.feature` assert the
>   new wording

> ### 5. One `range.get` per declared test — TECHNICAL
>
> `requireDeclaredTests` calls `range.get(test.path)` twice per test. **Look
> each path up once** and reuse the result. Pure refactor: no behaviour or
> message change beyond concern 3.

## Answered Questions

### Should the deleted deferred review notes be folded in anyway?

No — the human removed all three sections in the sketch commit; removal is the
answer.

### Does a marked test that never existed in the tree get "restore"?

No — "restore" only when the diff shows the path deleted; otherwise it stays
under "missing from the tree".

### Does "any whitespace" before the marker include none at all?

No — at least one space or tab; `` `a.test.ts`(unchanged) `` does not mark.

### Do README.md or CONTEXT.md need changes?

No — neither states the marker's spacing, case or the refusal text.

### Should the whole `TEST_LINE` regex take the `i` flag?

No — it would make `- UNIT:` parse with a bogus level; the marker gets its own
case-insensitive regex on the line's remainder.

### Should the rejoin stay `\s+` with a blank-line check added?

No — `[ \t]+` after `\n` cannot consume a newline, so the blank-line rule falls
out of the regex with no extra branch.

### Should an unmarked deleted test also go to the "restore" group?

No — the requirement scopes "restore" to marked tests; an unmarked declared test
must be in the diff anyway, so "write them" stays its remedy.

### What replaces "not satisfied" in the header?

"declares tests this turn left unmet" — no collision with the satisfied-package
term, and each group label carries its own remedy (write / restore).

### Should concern 4 merge into Package A, since both touch the feature file?

No — concern 4's footprint is the feature file alone and it only consumes the
guard; Package A touches that file for one assertion.

### Does concern 2 need an e2e scenario?

No — prompt text is not observable through `gtd land`; the unit assertions on
the rendered prompt pin it.
