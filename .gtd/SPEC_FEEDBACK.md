# Package 3 spec feedback — warn on a missing `C` row

The channel (Task 1), the `Narrator.warn` sink (Task 3), the once-per-invocation
emit site (Task 4) and the e2e feature (Task 5) are built as specified and the
suite is green. **Task 2's rule is not the rule the spec states, and the
deviation is load-bearing, not cosmetic.**

## 1. `validateHasCRow` adds two exemptions the spec never granted

The spec: "A state warns when all three hold: it declares no `C` row, its
content kind is not `prompt`, and it is not the workflow's initial state."

`src/PatternMachine.ts:764-773` adds two more exemptions on top:

- `if (state.file !== undefined) return []` — every state declaring a steering
  file is silent.
- `edges.some(([pattern]) => pattern === "C" || pattern === "* **")` — every
  state declaring a bare `"* **"` row is silent.

**Both exemptions are unsound on their own terms.** `matchesPattern`
(`src/PatternMachine.ts:292-298`) returns `changes.some(...)` for a `diff`
pattern, so **`"* **"` never matches a clean tree** — `changes.length === 0`
only matches `kind: "clean"`, i.e. a `C` row. A state with `"* **"` and no `C`
row still no-ops on a clean tree, which is the exact case the warning exists to
surface. Same for `file:`: a `file:`-declaring state's clean tree is still a
silent no-op. The doc comment's claim that these rows "show the author DID
enumerate every case that matters" is false for the clean case.

Together the two exemptions silence **10 of `unified.yaml`'s states** —
`unwind`, `start-gate.blocked`, `review-gate.blocked`, `design.gate.answer`,
`architecture.gate.answer`, `packages.item.closing`,
`packages.item.health.escalate`, `build.health.escalate`,
`build.review.await-review`, `build.review.deciding`. Under the spec's stated
three-condition rule, all 10 warn.

Secondary: `pattern === "* **"` is raw string equality, so `"*  **"` or a
trailing-space variant that `parsePattern` accepts as the identical pattern is
not exempt. If the exemption survives, compare parsed patterns, not raw strings.

## 2. The spec's rule and its zero-warnings acceptance conflict — resolve it explicitly

Task 2 requires both the three-condition rule AND "the bundled
`src/workflows/unified.yaml` produces **zero** warnings". Those are
unsatisfiable together: the strict rule warns on the 10 states above. Broadening
the rule in code, documented only in a comment, hides that conflict instead of
resolving it.

Pick one and say so:

- Implement the rule as written and add explicit `C` rows to those 10 states in
  `src/workflows/unified.yaml`. **This is a workflow-shape change with real
  ripple** — `src/workflows/templates.test.ts` invariants plus every e2e feature
  asserting on the bundled template's shape (AGENTS.md lists them), and each new
  `C` row changes what a clean step at that state commits. The package's "Out of
  scope" section does not authorize it, so this route needs the spec amended.
- Or keep the exemptions and amend `.gtd/packages/03-warn-on-missing-c-row.md`
  to state them as product decisions, with the honest reason (they exist to keep
  `unified.yaml` silent), not the false reason currently in the code comment.

Either way the code comment must stop claiming a `"* **"` row covers the clean
case.

## 3. Confirmed regression: `--verbose` now prints `config: layer` twice

Measured, not inferred. Same repo, `gtd next --verbose`:

- at `7fd0e876` (base): 1 × `config: layer /private/tmp/.../.gtdrc`
- at the working tree: **2 ×**

Cause: `src/program.ts:1166`'s new `yield* (yield* ConfigService).load` is a
second un-memoized load, and `src/Config.ts:349` narrates one line per config
layer on every load. `tests/integration/features/narration.feature:31` only
asserts `stderr contains "config: layer"`, so nothing caught it. Get the
warnings without a second narrating load, or suppress narration on this one.

## 4. `Config.ts` hardcodes `warnings: []` on the unconfigured path

`src/Config.ts:275-278` returns `warnings: []` literally for the built-in
default fallback rather than deriving it from the compiled default definition.
Today `unified.yaml` yields none under the shipped rule, so the value is
accidentally right — but **a repo with no `workflow:` configured can never
warn**, whatever `unified.yaml` grows later. That contradicts Task 4's "every
command whose `needsOf` is `state`". Derive it from the same compile that
produces `defaultWorkflowDefinition`.

## 5. Untested acceptance criteria

Each of these is a checklist line in the spec with no assertion behind it:

- **"exactly one warning naming that state"** (Task 2, Task 5) — both
  `src/program.test.ts:255-259` and
  `tests/integration/features/missing-c-row-warning.feature:41-43` assert only
  `contains`. Nothing pins the count, which is precisely what Task 4's "once per
  invocation, not once per config load" claim rests on. Assert one occurrence.
- **"stdout is byte-identical to a run with no warnings"** (Task 4) — only
  `stdout does not contain "\"C\" row"` is asserted.
- **"`gtd visualize` and `gtd lsp` print no warning"** (Task 4) — no test at
  all. Both are correct by construction (`needsOf` `"config"`/`"none"`), so this
  is cheap to pin.
- `src/PatternConfig.test.ts` is listed in Task 1's paths and is untouched; "a
  workflow with warnings but no errors compiles successfully" is covered only
  indirectly, through `program.test.ts`.

## 6. The new stderr warning is undocumented

A warning printed on every invocation of every `needsOf: "state"` command is
user-visible behaviour. `docs/configuration.md`'s `### Validation and errors`
(line 398) is its home — it currently documents only the thrown-error path.
Nothing in `README.md` or `docs/` mentions the warning channel, and the repo
rule is that significant changes are reflected in the docs.
