# Spec feedback — 04 Positioned findings and links

Most of the package landed and the whole suite is green (`turbo run` over
format:check, typecheck, lint, test:unit, both e2e tiers: all pass). Three
things are still open.

## 1. Unanswered-question output still names only the question, not its heading line

The Requirement calls this out by name ("Unanswered-question output names the
question and not its heading line") and the finding-site task carries the
checkbox "unanswered-question output names the question's heading line". Neither
emitter changed:

- `src/program.ts:879` —
  `const errors = unansweredQuestions(content).map((q) => q.question)`
- `src/StepGuards.ts:111` — maps each unanswered question to its question text
  alone

`OpenQuestion.headingLine` exists and is populated (`src/OpenQuestions.ts:88`,
`:310`) — it is simply never read by either output.
`git diff fc72f9c..HEAD -- src/StepGuards.ts` is empty, and program.ts's only
diff hunk is `formatFinding`.

Both surfaces need the heading line in their text, and a test each pinning it
(`src/program.test.ts`'s `--open-questions` case and
`src/StepGuards.test.ts:236`'s refusal case).

## 2. The two `SteeringFinding` invariants are not pinned by any test

Task 1 asks for them explicitly, "pinned by a test, not the type":

- a range is meaningless without a `line`
- a range's start line equals `line`

No test asserts either as an invariant. What exists is 19 per-site `toEqual`
assertions across `src/OpenQuestions.test.ts`, `src/ReviewDoc.test.ts`, and
`src/Footnotes.test.ts` that happen to spell out a matching `line` and
`range.start.line` for one fixture each. A new finding site — or a new format —
can violate both invariants with the whole suite green, which is exactly the
hole the checkbox exists to close.

Wanted: one test that drives both built-in formats' `validate` over malformed
content and asserts, for every finding returned, that `range !== undefined`
implies `line !== undefined` and `range.start.line === line`.

## 3. Document links are a user-facing editor feature with no user-facing doc

`README.md:268-273` enumerates what the editor integration gives a human — live
diagnostics, review actions, the add-a-footnote code action, marker↔definition
jumps. Clickable `./path#42` hunk links belong in that list and are absent from
it; `docs/configuration.md`'s steering-format section says nothing either.

This is not `docs/cli.md` (correctly untouched, per the package's own note) —
it's the one sentence a user needs to know the feature exists.
