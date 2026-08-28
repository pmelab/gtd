# Close the mutation-test gaps — technical plan

Three packages, in order: **make the mutation suite runnable, then add the
assertions that kill the 235 survivors, then triage the 64 lines no test
reaches.** Package 01 is a prerequisite in the strict sense — nothing below it
is measurable until it lands. Packages 02 and 03 are test-and-delete work over
nine production files that already exist; neither adds a feature, so neither
adds a cucumber scenario.

Two numbers stay stated, not softened: **1204 mutants are rejected by the
TypeScript checker and excluded from the score, so 82.81% is not "82.81% of the
code"**, and **`stryker.config.json` gains no `thresholds` block, so the score
this work lands at will decay again unnoticed between deliberate runs.** That
decay is the accepted cost of keeping a 13-minute run opt-in.

**Nothing here becomes a gate.** Line coverage lands as an on-demand `coverage`
script with no `turbo.json` task and no floor, exactly as the mutation score
does. Same accepted cost, stated twice because it now applies twice: **a new
unreached statement can land with every gate green, and nobody sees it until
someone runs `coverage` on purpose.**

## Package 01 — Make the mutation suite runnable

Primary paths: `tests/integration/support/setup-files.ts` (new),
`vitest.config.ts`, `vitest.stryker.config.ts`,
`tests/tooling/setup-files.test.ts` (new), `src/program.test.ts`, `turbo.json`.

**The dry run aborts today; both fixes that made the `main` run possible are
absent from this branch.**

**One shared setup-file list, one plain `readonly string[]`.**
`tests/integration/support/setup-files.ts` exports `SETUP_FILES` — the same 13
`"./tests/integration/support/..."` strings `vitest.config.ts` lists today, in
document order. No object, no factory: vitest resolves `setupFiles` relative to
its config's directory, both configs sit at the repository root, so one literal
list serves all three consumers (`e2e-inmem`, `e2e-live`, stryker). Each
consumer spreads it. The four missing files (`steering`, `repo-snapshot`,
`signal-exit`, `tmpdir-gitdir`) come along by construction, and the nine
scenarios that fail as undefined steps under the mutation runner start passing.

No `.fallowrc.json` change: the new module is already an entry point via the
existing `tests/integration/support/**/*.{ts,mjs}` glob.

**The pin is a `tests/tooling/` test, same class as `turbo.test.ts`.**
`tests/tooling/setup-files.test.ts` imports `SETUP_FILES` and both config
modules (vitest transforms the TS configs on import), then asserts three things:
the stryker config's `test.setupFiles` equals `SETUP_FILES`; every `e2e-*`
project in `vitest.config.ts`'s `test.projects` equals `SETUP_FILES`; and every
listed path exists on disk via `existsSync`. **The third assertion is not
redundant** — equality alone passes happily when a step-definition file is
renamed and all three consumers point at the same missing path.

**`turbo.json`'s `test:unit` inputs are under-declared for this test and must
grow three entries:** `vitest.stryker.config.ts`, `stryker.config.json`, and
`tests/integration/support/**`. Without them the new pin caches a stale green
while the stryker config drifts — the exact trap `docs/**` in the e2e inputs
exists to avoid. `turbo.test.ts` needs no edit: this adds a test, not a task.

**The dry-run blocker is `src/program.test.ts`'s `gtd lsp` test.** It hands the
real `process.stdin` to vscode-languageserver, which installs an `end`/`close`
listener that calls `process.exit(1)`; interrupting the Effect fiber does not
remove it, so it fires as an uncaught exception long after the test and Stryker
crashes stringifying it (`errorToString`: "Cannot convert object to primitive
value"). Fix: stub with a `PassThrough` from `node:stream`. `process.stdin` is a
getter, so install it with
`Object.defineProperty(process, "stdin", { value: passThrough, configurable: true })`
and restore the saved original descriptor in `afterEach`. No try/catch anywhere
— swallowing the exception would leave the listener attached, which is the
actual defect.

**Add no `thresholds` block to `stryker.config.json`, and keep `test:mutation`
out of both `npm test` and `turbo.json`.** A `break` floor would fire during
unrelated refactors and still miss real regressions, because nothing triggers a
13-minute run near the commit that caused one.

Acceptance: the tooling test fails against today's four-file drift and passes
after the extraction; `npx stryker run --dryRunOnly` completes without aborting.

## Package 02 — Pin cursor geometry, the toggle rule, and every empty render

Primary paths: `src/ReviewDoc.test.ts`, `src/OpenQuestions.test.ts`,
`src/Edge.test.ts`, `src/SteeringMode.test.ts`.

**Zero production edits — this package only adds assertions.** It merges three
concerns whose footprints are the same four test files; both merged requirements
are carried verbatim under `## Merged Concerns` below.

**Drive every site through the interface that already exists; widen no export
surface.** `chunkToggleTarget`, `reviewActions`, `reviewOutline`,
`questionsOutline` and `formatStepRefusal` are module-private and stay that way
— they are reachable through `REVIEW_FORMAT.actions` / `.outline` /
`.pointerAt`, `QA_FORMAT.*`, `parseReviewDoc`, `parseOpenQuestions`,
`toggleFilePointer`, `toggleCheckbox`, and Edge's existing command entry points,
all of which the four test files already import. A test-only export would land
in fallow's dead-export report and lie to a reader about the public API.

**Cursor geometry** (`ReviewDoc.ts:411`, `:425`, `:427`): an `it.each` table of
`[cursorLine, expectedActionTitles]` over one multi-chunk fixture, with rows for
exactly the first line, exactly the last line, and one line outside — of both a
hunk and a chunk. The table is what kills `<` for `<=`, `||` for `&&`, either
conjunct alone, and `true`. **A row one line past the chunk end is the only one
that kills the `<`/`<=` flip**; without it the whole table passes mutated.

**Fold-end clamp** (`ReviewDoc.ts:362`, `OpenQuestions.ts:299`): assert
`.outline()` ranges for the **last** chunk and the **last** question in the
document. That is the only case that exercises the `?? lines.length` fallback,
and it is what kills `Math.min`, `i - 1`, and `+ 1`.

**Chunk-toggle majority rule** (`ReviewDoc.ts:383`): three cases on a
partially-checked chunk — below half, exactly half, above half — asserting
check-all versus uncheck-all through the action title. The rule is already
settled in the function's own doc comment: an even split checks.

**Empty renders** (`Edge.ts:908`, `:1072`, `:1096`, `SteeringMode.ts:188`):
assert the **whole message string with `toBe`**, for both the populated and the
empty case. **`toContain("(none)")` is not sufficient** — it survives `join("")`
and `>=` for `>`. The populated case must carry at least two entries so the
`", "` separator is itself asserted; the `it.vars` case must use a
multi-character name so `it.vars.${r}` is distinguishable from an empty or
`undefined` mapping. `SteeringMode.ts:188` needs a format command whose output
carries trailing whitespace, which is what separates `trimEnd` from `trimStart`.

**Optional-field spreads** (`Edge.ts:532` `describe`, `:533` `action`,
`ReviewDoc.ts:106` `inlineNote`, `OpenQuestions.ts:311` `children`):
`expect(payload).not.toHaveProperty("action")` in the empty case, alongside the
existing populated assertion. **This shapes the `gtd next --json` payload — an
extra empty key is a protocol change a driver can see.**

**Line endings** (`ReviewDoc.ts:358`, `:404`, `OpenQuestions.ts:296`): parse one
LF fixture, then the same fixture through `doc.replaceAll("\n", "\r\n")`, and
assert deep-equal results. **Build the CRLF variant in the test, never commit a
CRLF fixture file** — oxfmt formats `.md` and `.ts` repository-wide and would
normalize it back to LF, silently defeating the test while it still passes.

**Regexes** (`OpenQuestions.ts:74`, `Edge.ts:1089`, `ReviewDoc.ts:196`): a
heading that is not at line start, a heading with trailing content, a
multi-character `it.vars` reference, and a multi-space separator.

**Whitespace: do not chase all 35 `MethodExpression` survivors.** Assert only
the sites where a fixture carrying leading or trailing whitespace changes an
observable output — e.g. `ReviewDoc.ts:61`, `:129`, `:221`, `:334`,
`OpenQuestions.ts:74`. The rest are defensive and killing them buys nothing a
reader can name.

No new error paths: every function here is pure and total.

Acceptance: each new case fails if you flip the corresponding operator by hand.

## Package 03 — Triage the 64 uncovered mutants

Primary paths: `src/Config.ts` (15 mutants), `src/PatternConfig.ts` (14),
`src/Lsp.ts` (11), `src/Edge.ts` (10), `src/ReviewDoc.ts` (5),
`src/PatternMachine.ts` (5), `src/SteeringMode.ts` (2), `src/OpenQuestions.ts`
(2), their sibling `*.test.ts` files, `package.json`, `vitest.config.ts`.

**These are lines no test reaches, not survivors.** `reports/mutation/` does not
exist in this checkout and AGENTS.md forbids running `test:mutation`
autonomously, so the per-site list comes from ordinary line coverage instead: an
unreached line is an unreached line, and that is the entire no-coverage subset.
No 13-minute run required.

**Coverage tooling: add `@vitest/coverage-v8` as a devDependency and configure
`provider: "v8"`.** V8, not istanbul — it is vitest's default provider and needs
no instrumentation step in a build that already runs through tsdown.
`reporter: ["text", "json-summary"]`.

**It ships as one `coverage` script and nothing else: no `turbo.json` task, no
`thresholds`, no `100`-statement floor, and no entry in the `test` script's task
list.** A floor scoped to these nine files would fire during unrelated
refactors, and `turbo.test.ts` only demands the three-part script/task/test-list
set for tasks that exist — a script with no task is legal and stays out of the
graph.

Risk, blunt: **with no floor, a newly-uncovered statement lands green and stays
invisible until the next deliberate `coverage` run.** Accepted, and it is the
same trade already accepted for the mutation score.

**Read the nine-file include list out of `stryker.config.json`'s `mutate` array
inside `vitest.config.ts`** rather than retyping it. One source of truth means
the coverage scope cannot drift from the mutation scope, and it needs no test to
hold it.

**Per site: read every caller, then decide.** Reachable-but-untested gets a test
in the module's existing `*.test.ts`, same as package 02. Unreachable gets
deleted — including the 35 string literals, because an unreached defensive error
string is dead weight faking robustness and does not get a test built to reach
it.

**Delete outright. No `never`-typed exhaustiveness assert stands in for the
removed branch** — a guard would keep a line the coverage report then counts as
unreached, defeating the acceptance criterion this package is measured by. **The
unreachability proof goes in the commit message, naming the callers that
establish it**, which is the one place a reviewer reads it.

**The scoped condition, and it is not optional: delete only where the callers
prove the branch is unreachable.** Line coverage tells you a line never
executed; it cannot tell "impossible" apart from "reachable but untested", and
those two resolve opposite ways.

**Compile-pressure rule for deletions: if removing a branch forces a new `as`
cast or `!` to typecheck, that is evidence the branch is reachable — stop and
cover it instead.** Deleting must never widen a type to keep the file compiling.

Risk in one line: **delete a branch some real path can still reach and you
convert a clear error message into a crash or a silent wrong answer.** Proving
unreachability per site is the bulk of this package, not the deleting.

Acceptance: line coverage over the nine mutated files reports zero unreached
statements, whether a site got a test or got deleted.

## Merged Concerns

Packages 01 and 03 map one-to-one onto concerns 1 and 5. Package 02 merges
concerns 2, 3 and 4: all three land purely as added assertions in the same four
test files (`ReviewDoc.test.ts`, `OpenQuestions.test.ts`, `Edge.test.ts`,
`SteeringMode.test.ts`), none of them consumes an interface another creates, and
splitting them would ship three commits that each touch the same files for the
same reason. Package 03 stays separate despite brushing the same test files: its
footprint centers on the nine **production** modules and the coverage wiring,
and package 02 touches no production file at all.

The three merged requirements, verbatim, so the per-package spec review still
covers each one independently:

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

### Do the shared setup-file list and the coverage include list live as data or as code?

Data, read from one place. The setup-file list is a plain `readonly string[]`
exported from `tests/integration/support/setup-files.ts` and spread by all three
consumers; the coverage include list is read out of `stryker.config.json`'s
existing `mutate` array. Neither gets retyped, so neither can drift.

### Are the CRLF fixtures committed files or built in the test?

Built in the test, from the LF fixture via `replaceAll("\n", "\r\n")`. A
committed CRLF `.md` or `.ts` fixture would be normalized back to LF by oxfmt,
which formats the whole repository — the test would keep passing while testing
nothing.

### Which coverage provider?

`@vitest/coverage-v8`. It is vitest's default provider and adds no
instrumentation step; istanbul would buy nothing here, since the question asked
of the report is only "did this statement ever execute".

### Do the private functions under test get exported so tests can reach them?

No. Every site in package 02 is reachable through `REVIEW_FORMAT`, `QA_FORMAT`,
the module's existing exported parsers, or Edge's command entry points — all
already imported by the four test files. A test-only export would show up in
fallow's dead-export report and misrepresent the public API.

### Does `turbo.json` change?

Yes, one task's inputs: `test:unit` gains `vitest.stryker.config.ts`,
`stryker.config.json`, and `tests/integration/support/**`, because the new
tooling test reads all three. No new task, so `turbo.test.ts` is untouched.

### Does line coverage over the nine mutated files become a gated turbo task, or an on-demand diagnostic?

On-demand diagnostic. A `coverage` script only — no `turbo.json` task, no floor.
It is consistent with the settled refusal to gate on the mutation score, and it
never fires during an unrelated refactor. The cost is that a newly-uncovered
statement lands with every gate green and stays invisible until someone runs
`coverage` on purpose.

### When triage proves a branch unreachable, does the site get deleted outright or replaced with a compile-time exhaustiveness guard?

Delete outright. It is the smallest diff, and a `never`-typed guard would leave
behind a line the coverage report counts as unreached — the exact thing this
package is measured on. The unreachability proof lives in the commit message,
naming the callers that establish it.
