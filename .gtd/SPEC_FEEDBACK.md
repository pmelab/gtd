# Spec feedback — 01 Reset review checkboxes

`FILE_POINTER_TICK_RE` in `src/ReviewDoc.ts` uses `\s`, which matches newlines
and leading indentation. It therefore clears ticks on two line shapes
`FILE_POINTER_RE` rejects, breaking two Task 1 acceptance bullets. Everything
else in the package checks out: `gtd uncheck`, the `renderDecision` step, the
three workflow edits, the rewritten scenarios, and the qa regression all pass
(`npm test` green; the three `@live` features verified in isolation).

## 1. An indented `- [x] <token>` line is cleared — it is a continuation note, not a pointer

`FILE_POINTER_RE` is `/^-\s*\[([ xX])\]\s*(\S+)…/` — the `-` must be at
column 0. The tick regex opens `^(\s*-\s*\[)`, so `  - [x] ./b.ts` matches. The
parser treats that indented line as part of the PREVIOUS pointer's note, so the
reset edits the human's note text — which Task 1 bullet 1 ("every
`- [x]`/`- [X]` line that `FILE_POINTER_RE` accepts") and the Requirement ("The
human's notes … are untouched") both forbid.

Failure scenario: an indented ticked list item is already in the
`.gtd/REVIEW.md` blob committed at `build.review.reviewing`, and the human then
lands having changed nothing. The reset flips that line, the human-turn commit
records a real `.gtd/REVIEW.md` change, and `build.review.deciding` routes a
clean sign-off to `build.review.collecting` — a spurious feedback round, the
exact fabricated "the human edited something real" the spec's CRLF warning is
guarding against.

`src/ReviewDoc.test.ts`'s "preserves path, inline note, continuation lines,
indentation, chunk headings…" case pins the wrong behaviour: it asserts
`  - [x] ./src/calc.ts#1 — new add function` IS cleared. That assertion has to
flip with the fix.

## 2. `- [x]` with no pointer token is cleared when the next non-blank line has content

The lookahead `(?=\]\s*\S)` lets `\s*` cross a newline, so the `\S` it finds can
be on a later line:

```
$ node -e 'const RE=/^(\s*-\s*\[)[xX](?=\]\s*\S)/gm; console.log(JSON.stringify("- [x]\nhello\n".replace(RE,"$1 ")))'
"- [ ]\nhello\n"
```

Task 1 bullet 5 ("A `- [x]` line with no whitespace-delimited pointer token
after the box is left alone") requires it untouched — `FILE_POINTER_RE` needs
the token on the same line.

The unit test for that bullet uses `"- [x]"` with nothing after it at all, so it
passes vacuously and gives false coverage. It needs the case above (and its
mirror, `"- [x]   \n./a.ts\n"`, which also wrongly clears).

## Fix shape

Both come from horizontal-vs-vertical whitespace. Use a horizontal-only class
(`[^\S\r\n]` or `[ \t]`) everywhere the regex mirrors `FILE_POINTER_RE`'s `\s`,
and drop the leading `\s*` so the `-` is anchored at column 0 as
`FILE_POINTER_RE` requires. `FILE_POINTER_RE` gets away with `\s` only because
it is applied per-line to already-split text; a `gm` regex over the whole
document does not.

Keep the anchored-multiline-replace shape — no `split`/`join`. The CRLF and
trailing-newline behaviour is correct today and must stay correct.

## 3. Minor: `package 01` references in shipped comments will dangle

`src/workflows/unified.yaml`, `src/testing/EmittedScriptRecognizer.ts`,
`tests/shell/corpus/workflow.build.review.deciding.sh`, and the "Since package
01" paragraphs in `deciding-signoff.feature` and
`review-signoff-format-skip.feature` cite a package file that a later step
deletes. State the reason without the package number — the decision is
"`gtd uncheck` resets every tick ahead of the commit, so no `[x]` reaches it",
which stands on its own.
