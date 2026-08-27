# Spec feedback — 02 Re-install detects and upgrades what is already there

Three problems. The briefing prose satisfies Tasks 2–4 in content; the defects
are one unmet Task 1 item, one test that passes by accident, and one broken line
in the emitted text.

## 1. `REINSTALL` is appended in `renderBriefing()`, not by `commandSuite()`

`src/Install.ts:521-529`. Task 1 requires "`commandSuite()` emits it after all
four command subsections", and the settled decisions repeat it: "appended by
`commandSuite()` AFTER the four command subsections". The implementation instead
concatenates `REINSTALL` as a separate term in `renderBriefing()`.

The rendered order is correct, so nothing a user sees is wrong — but the task
item as written is not done. Either move the append inside `commandSuite()`'s
returned template, or the package leaves a checkbox false.

## 2. The `gtd-loop` test passes only because of where the text wraps

`src/Install.test.ts:216-222`. The test splits the briefing on `\n`, keeps lines
containing `gtd-loop`, and asserts none of them match `/remove|delete|.../`. The
briefing's actual sentence spans two lines:

- `This check scopes to exactly the four suite paths above. \`gtd-loop\` is`
- `never read, diffed, or named as something to remove — an existing`

The word `remove` and the word `gtd-loop` land on different lines, so the filter
never hands the assertion the sentence it exists to check. Two consequences,
both real:

- **False red.** Reflowing that paragraph by one word — a hand edit, or any
  future formatter pass over the template — puts `gtd-loop` and `remove` on one
  line and fails the test while the briefing is still correct.
- **False green.** An instruction that genuinely told the agent to remove
  `gtd-loop` escapes detection whenever it breaks across a line, which is the
  normal case in this hard-wrapped prose.

Task 4 asks for "a test asserts the briefing contains no instruction to remove
`gtd-loop`". Assert over the whole string, not per line — e.g. that the briefing
contains no sentence putting a removal verb and `gtd-loop` together, checked
against the whitespace-collapsed briefing rather than its wrapped lines.

## 3. `src/Install.ts:492-494` emits a one-word line

```
A \`gtd-build\` differing only inside those markers
is
unchanged, and re-asks nothing — ...
```

`is` sits alone on its own line in the text `gtd install` prints. Rewrap the
sentence. Note the test at `src/Install.test.ts:207` matches
`/differing only.{0,60}(inside|within).{0,60}(markers|exports)/is` with the `s`
flag, so it keeps passing either way — the fix is to the emitted text, not the
assertion.

## Verified clean

- Tasks 2, 3 and 4's content requirements are all present in the section:
  read-before-write, the three-way branch, skip-the-interview on equal, the
  unreadable/directory case, both marker names, the strip-the-installed-file
  rule and its per-machine reason, the exactly-four scope, and `gtd-loop`
  surviving untouched as the human's own call.
- No new function, no filesystem read, no diffing code entered `src/Install.ts`.
  `PREREQUISITES` still renders last.
- Stripping the marker region from the installed file ONLY is correct:
  `MINIMAL_DRIVER` carries no export block, so a symmetric strip would have
  nothing to remove on the emitted side.
- `format:check`, `typecheck`, `lint` and all 1451 unit tests pass.
