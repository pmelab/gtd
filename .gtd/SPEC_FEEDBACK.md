# Package 03 review — three problems

The warning channel itself (Tasks 1, 3, 4, 5) is correct and well covered. The
problems are all in how Task 2's "the bundled `unified.yaml` produces **zero**
warnings" checkbox was reached.

## 1. `deciding` gains `"C": $onSignoff` — a clean tree now ENDS the review as approved

`src/workflows/unified.yaml:883`. `$onSignoff` resolves through `humanReview`'s
`onSignoff: $onDone` (line 1246) to `idle` (line 1424), so a clean step at the
human review gate's classification state now commits `gtd(check): idle` and
terminates the process as APPROVED.

Before this package that case was a no-op: the loop settled, visibly, and a
human looked at it. Now the one state where a false approval is most expensive
approves by default.

The neighbouring `collecting` state's own comment states the opposite policy for
the same situation ("No `C`/`"* **"` row: a clean turn here is a fruitless
dispatch ... never a verdict"), so the template is now internally inconsistent
about what a clean turn at the review gate means.

Nothing demonstrates the clean case is reachable-and-benign: `deciding`'s script
is `rm -f .gtd/REVIEW.md`, and the diff is taken against `HEAD`, so a re-run
still yields `D .gtd/REVIEW.md`. Clean means REVIEW.md was never there — an
anomaly, not a sign-off.

Fix: do not route a clean tree at `deciding` to sign-off. Either leave the state
with no `C` row and reach zero warnings another way, or route `C` to a target
that does not end the process.

## 2. `unwind` gains `"C": start-gate` — a FAILED revert is now indistinguishable from a completed one

`src/workflows/unified.yaml:1319`. The script runs
`git revert --no-commit "$commit"` under `set +e`. A hard failure (e.g.
`fatal: ... is a merge but no -m option was given`) exits nonzero and leaves the
tree **clean and un-unwound** — a conflict is the only failure that leaves it
dirty. The new `C` row commits an empty step and advances into
`start-gate.check`.

That breaks the invariant AGENTS.md documents verbatim: "by the time
`start-gate.check` runs, the working tree already IS the baseline — one plain
suite run there is the baseline verdict." With this row, the start gate runs the
suite on a tree that still carries the human's sketch, and blames the sketch's
red on the baseline (or blesses a non-baseline green).

The added comment ("A clean revert (nothing left to undo)") only covers the
success reading; it does not cover the failure reading, which produces the
identical clean tree.

`re-unwind`'s pre-existing `"C": design` is NOT the same case and is not a
precedent — a note-only review round legitimately produces an empty patch there,
and `requireRevert: true` re-checks the tree independently. `unwind` has no such
guard.

Fix: do not advance on a clean tree at `unwind`, or make the failure case
distinguishable (fail loudly / write a marker path an `on` row matches) before
adding the row.

## 3. The `actor: human` exemption is not in the spec

`src/PatternMachine.ts`'s `validateHasCRow` skips `state.actor === "human"`. The
spec's Task 2 states the rule as exactly three conditions — "no `C` row, content
kind is not `prompt`, and it is not the workflow's initial state" — and calls
out exactly two exclusions as load-bearing. A fourth condition is a silent
narrowing: it drops the warning for four human `message` states in the bundled
template (`start-gate.blocked`, `health.escalate`, both `questionGate.answer`
instances, `await-review`).

The reasoning in the code comment is sound, and this is likely a spec gap rather
than a coding mistake — but the deviation is currently undeclared. It is also
what made `unified.yaml`'s zero-warning target reachable, so the two cannot be
judged separately.

Reconcile it explicitly: amend `.gtd/packages/03-warn-on-missing-c-row.md`'s
Task 2 to state the human exclusion and why, so the spec,
`src/PatternMachine.ts`, `docs/configuration.md`, and
`tests/integration/features/missing-c-row-warning.feature` describe one rule
instead of two.

## 4. None of the three bundled-workflow edges has a test

`src/workflows/unified.yaml` grew three new runtime edges (`deciding`,
`closing`, `unwind`). Only `unwind`'s is pinned, and only as a target COUNT
(`templates.test.ts` now expects `["start-gate.check", "start-gate.check"]`) —
nothing asserts what any of the three does at runtime.

AGENTS.md requires a bundled-template shape change to update
`src/workflows/templates.test.ts` **and** the e2e feature files that assert on
the template's shape. Whatever survives of items 1 and 2 needs a scenario
covering the clean-tree outcome at that state, not just a compiled-shape
assertion.

`closing`'s `"C": $onNext` is the benign one of the three; it still needs
coverage, but no design change.

## Not a problem

Tasks 1, 3, 4, 5 conform. `validateDefinition`'s `{errors, warnings}` shape,
`compileWorkflowConfig`'s unchanged single-thrown-error merge, `Narrator.warn`'s
ungated stderr write, the once-per-invocation emission in `runCommand` with its
scoped narration stub, the stdout-byte-identity test, and the `visualize`/`lsp`
silence tests are all correct and adequately covered. `src/PatternMachine.ts`
still imports only `src/StateFields.ts`. `npm test` is green.
