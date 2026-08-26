# Package 3 spec feedback — the spec file still contradicts the shipped rule

Tasks 1, 3, 4, 5 are built as specified. `typecheck`, `test:unit`,
`test:e2e:inmem`, `lint`, `format:check` are all green. The previous round's two
unsound `C` rows (`unwind`, `build.review.deciding`) are correctly gone.

**One thing is left undone: the reconciliation the previous round asked for.
`src/PatternMachine.ts:770-772` says so itself — "the spec itself still needs
updating to match" — and it has not been updated. Two of the spec's own
statements are now false against the code, so the package cannot be closed as
satisfied.**

## 1. Task 2's rule omits the `actor: human` exclusion the code implements

Spec Task 2: "A state warns when all three hold: it declares no `C` row, its
content kind is not `prompt`, and it is not the workflow's initial state" — and
"**Both exclusions are load-bearing**", i.e. exactly two.

`validateHasCRow` (`src/PatternMachine.ts:783`) implements a third:
`if (state.actor === "human") return []`. It silences 7 bundled-template states
— `start-gate.blocked`, `review-gate.blocked`, `design.gate.answer`,
`architecture.gate.answer`, `packages.item.health.escalate`,
`build.health.escalate`, `build.review.await-review`.

The reasoning in the code comment is sound and `docs/configuration.md` and
`tests/integration/features/missing-c-row-warning.feature` already describe the
three-exclusion rule. The spec is the only artifact still describing the
two-exclusion one.

Fix: amend `.gtd/packages/03-warn-on-missing-c-row.md` Task 2 to state the
`human`-actor exclusion and its reason (a driver lands a human gate's opening
beat on every restart while a process rests there, so a `C` row there commits
before the human has acted), and add a matching checkbox. Then delete the
`NOTE:` paragraph from `validateHasCRow`'s doc comment — a spec deviation
recorded in a code comment stops being a deviation once the spec says it.

## 2. The acceptance criterion "the bundled `unified.yaml` produces **zero** warnings" is false

Measured on the working tree: the bundled template produces **two** warnings —
`unwind` and `build.review.deciding` — on every invocation. That is pinned
deliberately in three places (`src/workflows/templates.test.ts:41`,
`src/program.test.ts:286`, the second scenario of
`missing-c-row-warning.feature`) and it is the RIGHT outcome: the previous round
established that routing either state's clean case would mask a swallowed
`git revert` failure (`unwind`) or auto-approve an unreviewed round
(`deciding`).

But the spec still asserts zero, in two places: the Acceptance line ("the
bundled `unified.yaml` produces none") and Task 2's checkbox ("the bundled
`src/workflows/unified.yaml` produces **zero** warnings"). Task 5's checkbox "a
scenario using the bundled workflow observes no warning" is false for the same
reason.

Fix: amend all three to the shipped fact — the bundled template produces exactly
two warnings, `unwind` and `build.review.deciding`, both deliberately unrouted,
and that repeating noise is accepted. Do not chase zero by adding `C` rows; that
route was already rejected twice on correctness grounds.

## Note, not a defect

`packages.item.closing` keeps the `"C": $onNext` row added while chasing the
zero-warning target (`src/workflows/unified.yaml:1179`). Keep it: without it a
clean sweep leaves the process no-oping at `closing` forever. It is justified on
its own merits, not by a target that no longer exists — say that in the amended
spec if you touch the row's rationale at all.
