# Close the mutation-test gaps

`npm run test:mutation` on `main` (3226 mutants, 13m 8s) scores **82.81% total /
85.97% covered** — 1414 killed, 235 survived, 64 no-coverage, 26 timeout. The
survivors are not noise; they fall into six clusters, listed worst-first.

Weakest files: `Config.ts` 72.03%, `Lsp.ts` 73.61%, `ReviewDoc.ts` 73.97%,
`Edge.ts` 74.37%. Strongest: `PatternMachine.ts` 91.51%, `PatternConfig.ts`
89.30%.

## Prerequisite — two fixes that made the run possible are NOT on this branch

The mutation suite could not run at all before them. They are uncommitted in the
main checkout (`/Users/pmelab/Code/gtd/gtd`) and must be carried over or
re-landed before any of the work below can be measured:

- `tests/integration/support/setup-files.ts` (new) — the shared setup-file list,
  imported by both `vitest.config.ts` and `vitest.stryker.config.ts`. The
  stryker config was missing four step-definition files (`steering`,
  `repo-snapshot`, `signal-exit`, `tmpdir-gitdir`), so nine scenarios failed as
  undefined steps whenever the mutation runner drove the suite.
- `src/program.test.ts` — the `gtd lsp` unit test stubs `process.stdin` with a
  `PassThrough`. `gtd lsp` hands the real `process.stdin` to
  vscode-languageserver, which installs an `end`/`close` listener that calls
  `process.exit(1)`, and interrupting the Effect fiber does not remove it. Under
  vitest that fired as an uncaught exception long after the test; Stryker then
  crashed stringifying it (`errorToString`: "Cannot convert object to primitive
  value") and aborted the dry run. This was the actual blocker.

## 1. LSP range arithmetic is effectively untested

Highest severity: a survivor here means a user gets the wrong answer, not just a
worse message. Folding ranges, document symbols, and code actions all survive
boundary flips.

- `src/ReviewDoc.ts:427` — nine survivors on one line.
  `chunk.files.length > 0 && cursorLine >= chunk.headingLine && cursorLine <= chunkEnd`
  survives being replaced by `true`, by either conjunct alone, by `||` in place
  of `&&`, and by `<` in place of `<=`.
- `src/ReviewDoc.ts:411` — the hunk-under-cursor predicate
  `cursorLine >= file.sourceLine && cursorLine <= file.endLine` survives `true`,
  `||`, and either half alone.
- `src/ReviewDoc.ts:362` and `src/OpenQuestions.ts:299` — the fold-end clamp
  `Math.max(start, (xs[i + 1]?.headingLine ?? lines.length) - 1)` survives
  `Math.min`, `i - 1`, and `+ 1`.
- `src/ReviewDoc.ts:425` — same `i + 1` / `- 1` pair inside the code-action
  chunk-end computation.

Wanted: tests that place the cursor exactly on the first line, exactly on the
last line, and one line outside each of a hunk and a chunk, and assert which
code action is offered. Same treatment for fold ranges at the last chunk in the
document (the `?? lines.length` fallback).

## 2. The chunk-toggle majority rule has no test

- `src/ReviewDoc.ts:383` — `checkedCount * 2 <= total` survives being replaced
  by `true` and by `checkedCount / 2 <= total`.

Wanted: a partially-checked chunk toggled at below-half, exactly-half, and
above-half, asserting check-all vs uncheck-all.

## 3. Human-readable diagnostic text is unasserted

Tests assert that an error fires, never what it says. Every one of these is text
a user reads when a pattern refuses or a template variable is missing.

- `src/Edge.ts:908` —
  `refusal.patterns.length > 0 ? refusal.patterns.join(", ") : "(none)"`
  survives `true`, `>=`, `join("")`, and `""` for `"(none)"`.
- `src/Edge.ts:1072` — same shape for `declaredNames`.
- `src/Edge.ts:1096` — same shape for `it.vars` refs and `"(none found)"`;
  additionally the template-literal mapper survives mapping every ref to an
  empty string and to `undefined`:

```ts
refs.length > 0 ? refs.map((r) => `it.vars.${r}`).join(", ") : "(none found)"
```

- `src/SteeringMode.ts:188` — five survivors, covering the empty-output branch
  and `trimEnd` vs `trimStart`:

```ts
outcome.output.trim().length > 0 ? `:\n${outcome.output.trimEnd()}` : ""
```

Wanted: assert the rendered message for both the populated and the empty case.

## 4. Optional-field spreads never checked for absence

`...(x.length > 0 ? { key } : {})` survives becoming `...(true ? { key } : {})`
— nothing asserts the key is _omitted_ in the empty case. This shapes the
`gtd next --json` payload, so an extra empty key is a protocol change a driver
can see.

- `src/Edge.ts:533` (`action`), `src/Edge.ts:532` (`describe`)
- `src/ReviewDoc.ts:106` (`inlineNote`)
- `src/OpenQuestions.ts:311` (`children`)

Wanted: assert `expect(payload).not.toHaveProperty("action")` (etc.) in the
empty case, not just the populated one.

## 5. CRLF and whitespace tolerance are untested

- `content.split(/\n/)` survives becoming `split(/\r\n/)` at
  `src/ReviewDoc.ts:358`, `src/ReviewDoc.ts:404`, `src/OpenQuestions.ts:296`.
  There is no CRLF steering-file test anywhere.
- Every `.trim()` / `.trimEnd()` / `.trimStart()` call survives being swapped
  for a sibling or removed outright — 35 `MethodExpression` survivors overall,
  e.g. `src/ReviewDoc.ts:61`, `:129`, `:221`, `:334`, `src/OpenQuestions.ts:74`.

Wanted: parse the same steering file with LF and CRLF and assert identical
results; assert trailing-whitespace and leading-whitespace handling where it is
actually load-bearing.

## 6. Regex anchors and quantifiers are not pinned

- `src/OpenQuestions.ts:74` — the heading parse `/^(#{1,6})(?:\s+(.*))?$/`
  survives losing `^`, losing `$`, and `\s+` → `\s`.
- `src/Edge.ts:1089` — the `it.vars.X` scanner `/it\.vars\.(\w+)/g` survives
  `\w+` → `\w` and `\w` → `\W`, so a multi-character variable name is never
  exercised through that path.
- `src/ReviewDoc.ts:196` — `inlineSegment.split(/\s+/)` survives `\s`.

Wanted: a heading that is not at line start, a heading with trailing content, a
multi-char `it.vars` reference, and multi-space separators.

## 7. Sixty-four mutants have no coverage at all

Distinct from the survivors above: these are lines no test reaches. 35 of the 64
are string literals.

- `src/Config.ts` (15), `src/PatternConfig.ts` (14), `src/Lsp.ts` (11),
  `src/Edge.ts` (10), `src/ReviewDoc.ts` (5), `src/PatternMachine.ts` (5),
  `src/SteeringMode.ts` (2), `src/OpenQuestions.ts` (2)

Wanted: triage from `reports/mutation/mutation.html` — decide per site whether
it is dead code to delete or a real path to cover.

## Caveat on the score

1204 mutants were rejected by the TypeScript checker as uncompilable and are
excluded from the score entirely. That is normal for a typed codebase, but it is
a large fraction — the behavioral surface actually under test is smaller than
the 3226 mutant count suggests. Do not read 82.81% as "82.81% of the code".
