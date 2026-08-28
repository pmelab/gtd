# Close the mutation-test gaps

`npm run test:mutation` scored **82.81% total / 85.97% covered** on `main` — 235
survived, 64 no-coverage, 26 timeout out of 3226 mutants, in 13m 8s. The
survivors cluster, and the clusters are the work below.

Two facts about that number, both load-bearing and neither to be softened: 1204
mutants were rejected by the TypeScript checker as uncompilable and are excluded
from the score entirely, so **82.81% is not "82.81% of the code"** — the
behavioral surface actually under test is smaller than 3226 suggests. And **the
run cannot be reproduced on this branch at all** until concern 1 lands.

## Concerns

### 1. Make the mutation suite runnable (TECHNICAL)

**The mutation run cannot complete a dry run on this branch.** Both fixes that
made the `main` run possible are absent here; I verified both. Nothing below is
measurable until this lands, so it is first.

- **`vitest.stryker.config.ts` is missing four setup files** that
  `vitest.config.ts` lists: `steering`, `repo-snapshot`, `signal-exit`,
  `tmpdir-gitdir`. Nine scenarios fail as undefined steps whenever the mutation
  runner drives the suite. Extract the list into a single shared module
  (`tests/integration/support/setup-files.ts`) imported by both configs, so the
  two cannot drift again.
- **`src/program.test.ts`'s `gtd lsp` test hands the real `process.stdin` to
  vscode-languageserver.** That installs an `end`/`close` listener calling
  `process.exit(1)`, and interrupting the Effect fiber does not remove it. Under
  vitest it fires as an uncaught exception long after the test; Stryker then
  crashes stringifying it (`errorToString`: "Cannot convert object to primitive
  value") and **aborts the dry run**. This is the actual blocker. Stub
  `process.stdin` with a `PassThrough`.

Acceptance: a `tests/tooling/` test asserting both vitest configs resolve the
same setup-file list — it fails against today's four-file drift. Plus a clean
`npx stryker run --dryRunOnly` (or equivalent short run) that no longer aborts.

**Add no `thresholds` block to `stryker.config.json`.** The score stays a
diagnostic a person reads on purpose, never a gate that fails. Nothing runs
`test:mutation` often enough for a `break` floor to catch a regression near the
commit that caused it, and a floor would turn every future unrelated refactor
into a 13-minute argument with Stryker.

Risk, stated plainly: **with no floor, the score this work lands at will decay
again and nobody will notice until the next deliberate run.** That is the
accepted cost of keeping the task opt-in.

### 2. Pin review-document cursor geometry and the chunk-toggle rule (TECHNICAL)

Highest severity of the coverage clusters: **a survivor here means a user gets
the wrong answer, not a worse message.** Folding ranges, document symbols, and
code actions all survive boundary flips.

- `src/ReviewDoc.ts:427` — nine survivors on one line.
  `chunk.files.length > 0 && cursorLine >= chunk.headingLine && cursorLine <= chunkEnd`
  survives being replaced by `true`, by either conjunct alone, by `||` for `&&`,
  and by `<` for `<=`.
- `src/ReviewDoc.ts:411` — the hunk-under-cursor predicate
  `cursorLine >= file.sourceLine && cursorLine <= file.endLine` survives `true`,
  `||`, and either half alone.
- `src/ReviewDoc.ts:362` and `src/OpenQuestions.ts:299` — the fold-end clamp
  `Math.max(start, (xs[i + 1]?.headingLine ?? lines.length) - 1)` survives
  `Math.min`, `i - 1`, and `+ 1`.
- `src/ReviewDoc.ts:425` — the same `i + 1` / `- 1` pair inside the code-action
  chunk-end computation.
- `src/ReviewDoc.ts:383` — `checkedCount * 2 <= total` survives `true` and
  `checkedCount / 2 <= total`. The rule is already settled in the function's own
  doc comment (an even split checks rather than unchecks); nothing asserts it.

Cover it with cursor placement exactly on the first line, exactly on the last
line, and one line outside each of a hunk and a chunk, asserting which code
action is offered; fold ranges at the **last** chunk in the document, which is
the only case that exercises the `?? lines.length` fallback; and a
partially-checked chunk toggled at below-half, exactly-half, and above-half,
asserting check-all versus uncheck-all.

Acceptance: each new case fails if you flip the corresponding operator by hand.

### 3. Assert the empty case of every rendered output (TECHNICAL)

One shape unites two clusters the sketch listed apart: **every survivor here is
the empty branch of a populated-or-empty render, and the tests only ever assert
the populated one.** Tests check that an error fires, never what it says.

Diagnostic text a user reads when a pattern refuses or a template variable is
missing:

- `src/Edge.ts:908` —
  `refusal.patterns.length > 0 ? refusal.patterns.join(", ") : "(none)"`
  survives `true`, `>=`, `join("")`, and `""` for `"(none)"`.
- `src/Edge.ts:1072` — the same shape for `declaredNames`.
- `src/Edge.ts:1096` — the same shape for `it.vars` refs and `"(none found)"`.
  Additionally the mapper that prefixes each ref with `it.vars.` before joining
  on `", "` survives mapping every ref to an empty string, and survives mapping
  every ref to `undefined`.
- `src/SteeringMode.ts:188` — five survivors on the format-failure suffix, which
  appends a colon, a newline and the trimmed command output only when that
  output is non-empty. They cover the empty-output branch and `trimEnd` swapped
  for `trimStart`.

Optional-field spreads, where `...(x.length > 0 ? { key } : {})` survives
becoming `...(true ? { key } : {})` — nothing asserts the key is _omitted_.
**This one shapes the `gtd next --json` payload, so an extra empty key is a
protocol change a driver can see:**

- `src/Edge.ts:533` (`action`), `src/Edge.ts:532` (`describe`),
  `src/ReviewDoc.ts:106` (`inlineNote`), `src/OpenQuestions.ts:311`
  (`children`).

Assert the rendered string for both the populated and the empty case, and
`expect(payload).not.toHaveProperty("action")` (and so on) for each spread.

### 4. Pin steering-file parsing: line endings, whitespace, anchors (PRODUCT)

**A CRLF-authored steering file must parse identically to the same file with LF
— that is a user guarantee, not an accident**, and nothing tests it today. The
code already splits on `/\r?\n/`, so the mutant `split(/\r\n/)` survives purely
because no CRLF fixture exists anywhere in the suite. Sites:
`src/ReviewDoc.ts:358`, `src/ReviewDoc.ts:404`, `src/OpenQuestions.ts:296`.

Regex anchors and quantifiers are unpinned in the same parsers:

- `src/OpenQuestions.ts:74` — `/^(#{1,6})(?:\s+(.*))?$/` survives losing `^`,
  losing `$`, and `\s+` → `\s`.
- `src/Edge.ts:1089` — the scanner `/it\.vars\.(\w+)/g` survives `\w+` → `\w`
  and `\w` → `\W`, so **a multi-character variable name is never exercised
  through that path at all.**
- `src/ReviewDoc.ts:196` — `inlineSegment.split(/\s+/)` survives `\s`.

Cover it by parsing one fixture twice, LF and CRLF, asserting identical results;
a heading that is not at line start; a heading with trailing content; a
multi-char `it.vars` reference; and multi-space separators.

Whitespace is the sprawling part: **35 `MethodExpression` survivors** where
every `.trim()` / `.trimEnd()` / `.trimStart()` survives being swapped for a
sibling or removed outright — e.g. `src/ReviewDoc.ts:61`, `:129`, `:221`,
`:334`, `src/OpenQuestions.ts:74`. Do not chase all 35. Assert the ones where a
fixture carrying leading or trailing whitespace changes an observable output;
the rest are defensive and killing them buys nothing a reader can name.

### 5. Triage the 64 uncovered mutants (PRODUCT)

Distinct from every survivor above: **these are lines no test reaches.** Per
file: `src/Config.ts` (15), `src/PatternConfig.ts` (14), `src/Lsp.ts` (11),
`src/Edge.ts` (10), `src/ReviewDoc.ts` (5), `src/PatternMachine.ts` (5),
`src/SteeringMode.ts` (2), `src/OpenQuestions.ts` (2). Weakest files overall
line up with this: `Config.ts` 72.03%, `Lsp.ts` 73.61%, `ReviewDoc.ts` 73.97%,
`Edge.ts` 74.37%.

**`reports/mutation/` does not exist in this checkout, and AGENTS.md forbids
running `test:mutation` autonomously** — so the per-site list has to come from
somewhere else. Get it from ordinary line coverage over the nine files in
`stryker.config.json`'s `mutate` array: an unreached line is an unreached line,
and that is the entire no-coverage subset. No 13-minute run required.

**Delete unreachable branches rather than covering them.** Code no test can
reach is code no user can reach, and a message that cannot fire is dead weight
faking robustness. That applies to the 35 string literals too: an unreached
defensive error string goes, it does not get a test built to reach it.

The scoped condition that decision rests on, and it is not optional: **delete
only where you can prove from the callers that the branch is unreachable.** Line
coverage tells you a line was never executed — it cannot tell you apart
"impossible" from "reachable but untested", and those two resolve opposite ways.
A site that is merely untested gets a test, same as any concern above.

Risk in one line: **delete a branch that some real path can still reach and you
convert a clear error message into a crash or a silent wrong answer.** Proving
unreachability per site is the bulk of the work here, not the deleting.

Acceptance: line coverage over the nine mutated files reports zero unreached
statements, whether a site got a test or got deleted.

## Answered Questions

### Does `test:mutation` join `npm test` or the turbo task graph?

No. AGENTS.md names it a deliberate user action that must never run
autonomously, and 13 minutes in every gate would be intolerable regardless.

### Do the new boundary tests go in cucumber features or unit tests?

Unit tests beside each module. AGENTS.md asks for a cucumber scenario per new
_feature_; none of this adds a feature — it characterizes pure functions that
already exist, and `ReviewDoc.test.ts`, `OpenQuestions.test.ts`, `Edge.test.ts`
and `SteeringMode.test.ts` all already exist to hold it.

### How is the vitest/stryker setup-file drift kept from recurring?

One shared module both configs import, plus a `tests/tooling/` test asserting
they resolve the same list — the same class of pin as the existing
`turbo.test.ts`, and the only thing that makes the drift fail loudly instead of
silently skipping nine scenarios.

### Should the 26 timeout mutants be addressed?

Not in this work. A timeout is not a survivor — it is a mutant the runner could
not classify, and chasing them means tuning Stryker's timeout budget, which is a
different problem from missing assertions.

### Does closing these gaps come with an enforced mutation-score threshold?

No. `stryker.config.json` gains no `thresholds` block, and `test:mutation` stays
outside `npm test` and `turbo.json`. A `break` floor would fire during unrelated
refactors and still miss real regressions, because nothing triggers a 13-minute
run near the commit that caused one. The accepted cost is that the score decays
unnoticed between deliberate runs.

### When triage finds a user-facing string on an unreachable path, delete it or cover it?

Delete it. An unreachable defensive message is dead weight that fakes
robustness. The condition: delete only where the callers prove the branch cannot
be reached — line coverage cannot separate "impossible" from "reachable but
untested", and a merely-untested site gets a test instead.
