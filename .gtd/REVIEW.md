# Review: 168fd41

<!-- base: aedea7c936db6196a53d0a3d3f0603609c5165b6 -->

**This range finishes #384: every caller moves to the options forms of
`buildTail` and `implement`, and `refactorBuildingPrompt` drops its
compatibility path.** The overloads themselves landed before the base, on the
refactor-first path. `.gtd/REQUIREMENTS.md` is deleted at `implement.closing`,
as the flow expects. **No risks found.** Unit suites for the four touched test
files pass (208 tests). Swapping `fixFirst`/`green` in the positional mapping
turns 2 tests red; dropping `amend` from `implement`'s positional mapping turns
1 red.

## Scenarios

**Every scenario below changes only its inline `gtd.config.ts`:
`buildTail(false, start())` becomes `buildTail(start())`, and
`buildTail(true, start())` becomes `buildTail(start(), { fixFirst: true })`.**
Each one now pins its behaviour on the options form; no step or assertion
changed.

- [ ] ./tests/integration/features/conversational-code-threads.feature#32-37 —
      Background: every code-thread scenario runs review/fix on the options form
- [ ] ./tests/integration/features/conversational-review-unwind.feature#28-33 —
      Background: re-unwind conversation scenarios run on the options form
- [ ] ./tests/integration/features/conversational-review.feature#32-37 —
      Background: same-gate question/answer scenarios run on the options form
- [ ] ./tests/integration/features/default-workflow.feature#309-314 — an
      actionable round loops back through re-unwind; the hand-edit is gone
      before triage
- [ ] ./tests/integration/features/default-workflow.feature#409-414 — re-unwind
      refuses to land while review-round paths stay un-reverted; a hand-revert
      recovers
- [ ] ./tests/integration/features/default-workflow.feature#510-515 — an
      approving remark with no code edit short-circuits to sign-off
- [ ] ./tests/integration/features/default-workflow.feature#599-604 — re-unwind
      reverts a hand-edited code line, never resurrects the review file, leaves
      the state dir alone
- [ ] ./tests/integration/features/default-workflow.feature#675-680 — a
      note-only round reverts nothing and still reaches design.triage
- [ ] ./tests/integration/features/default-workflow.feature#750-755 — a revert
      that cannot apply is refused, not swallowed
- [ ] ./tests/integration/features/default-workflow.feature#1397-1402 — a
      feedback round's reviewing base anchors at the last review round
- [ ] ./tests/integration/features/default-workflow.feature#2166-2171 —
      `gtd next` at await-review shows the sign-off vs feedback contract
- [ ] ./tests/integration/features/default-workflow.feature#2222-2227 — a code
      edit at await-review is feedback and goes to collecting
- [ ] ./tests/integration/features/judge-truncated-sections.feature#33-38 — a
      note the judge budget cuts stays an edit despite confident praise
- [ ] ./tests/integration/features/machine-memory.feature#281-286 — two
      healthGate instances never share a session
- [ ] ./tests/integration/features/machine-memory.feature#413-418 —
      build.review's session survives the closing hop into an actionable round
- [ ] ./tests/integration/features/machine-memory.feature#511-516 — each review
      round gets a fresh reviewer session
- [ ] ./tests/integration/features/machine-memory.feature#636-641 — a loop-back
      round breaks build's own run; the reviewer never resumes the old builder
- [ ] ./tests/integration/features/machine-memory.feature#766-771 — the fix
      workflow's build.fix session survives into the shared review tail
- [ ] ./tests/integration/features/prompt-diff-ranges.feature#34-39 —
      Background: prompts carry diff ranges, on the options form
- [ ] ./tests/integration/features/review-closing-signoff.feature#119-119 — an
      untouched review signs off and moves to closing
- [ ] ./tests/integration/features/review-feedback-guards.feature#115-120 — a
      note flows through capture into REQUIREMENTS.md; re-unwind re-plans it
- [ ] ./tests/integration/features/review-feedback-guards.feature#204-209 —
      collecting refuses touching anything but the requirements file
- [ ] ./tests/integration/features/review-feedback-guards.feature#275-280 —
      design.triage refuses deleting the requirements file on a loop-back lap
- [ ] ./tests/integration/features/review-tick-reset.feature#88-93 — ticks plus
      a note are feedback; the commit carries the note, no tick
- [ ] ./tests/integration/features/review-triage-signoff.feature#41-46 — praise
      only signs off with no planner turn
- [ ] ./tests/integration/features/review-triage-signoff.feature#129-134 — an
      edit note hands its capture to collecting
- [ ] ./tests/integration/features/review-triage-signoff.feature#221-226 — a
      verdict below the reviewNoteActionable floor counts as an edit
- [ ] ./tests/integration/features/review-triage-signoff.feature#309-314 — a
      note the evidence budget cuts falls back to edit
- [ ] ./tests/integration/features/review-triage-signoff.feature#396-401 —
      questions only are answered inline; the process rests at the gate again
- [ ] ./tests/integration/features/review-triage-signoff.feature#502-507 — nits
      only are fixed in one batch, then a fresh review rests
- [ ] ./tests/integration/features/review-triage-signoff.feature#616-621 —
      questions and nits: the fresh review carries each answer over
- [ ] ./tests/integration/features/review-triage-signoff.feature#735-740 — edit,
      question and nit together: answer, fix, then collect
- [ ] ./tests/integration/features/scope-access.feature#482-487 — a feature-tail
      review turn answering a src/ code thread lands with the file
- [ ] ./tests/integration/features/weakened-scenarios.feature#22-22 —
      Background: the fix tail flags a scenario that lost an assertion, on the
      options form
- [ ] ./tests/integration/features/workflow-module-reuse.feature#22-22 —
      Background: a config-built `hotfix` door composes
      `buildTail(start(), { fixFirst: true })` from the published package
- [ ] ./tests/integration/features/workflow-module-reuse.feature#79-79 — with
      the naive pass on, afterTail's feedback lap is design → implement, never
      the seam

## Deprecated positional forms stay pinned

**One test per public function proves the old positional call runs exactly what
the options call runs**, so the `@deprecated` overloads cannot rot before a
major removes them.

- [ ] ./src/workflows/feature/review.test.ts#774-802 — `lensPrompts` takes an
      optional call thunk; default is the options form with `green: true`
- [ ] ./src/workflows/feature/review.test.ts#816-873 — legacy
      `buildTail(false, "base", true, options)` yields the same lens prompts as
      the options form The mapping table covers all four `fixFirst`/`green`
      pairs on the first four step requests, and a guard asserts each flag
      changes that sequence, so a swapped mapping goes red (checked by
      mutation). Nit: the `deprecated positional mapping` block sits under
      `describe("BuildTailOptions.lensBase")`; it has nothing to do with
      `lensBase`.
- [ ] ./src/workflows/feature/review.test.ts#914-914 — the rules-less helper
      calls the options form
- [ ] ./src/workflows/feature/seam.test.ts#228-262 — `building` takes a call
      thunk; legacy `implement("abc", "low")`,
      `implement(undefined, undefined, true)` and bare `implement()` each render
      the same building prompt as the options form
- [ ] ./src/workflows/feature/feature.test.ts#134-134 — the feedback-lap config
      uses `buildTail(start())`

## `refactorBuildingPrompt` switches outright

**The internal prompt builder loses its overloads and string-detecting
dispatcher; it takes one object only.** It is not re-exported (only
`agentWithSkills` leaves `shared/text.ts`), so no compatibility path is owed.
Prompt text is unchanged; the existing text tests pin it.

- [ ] ./src/workflows/shared/text.ts#460-472 — overloads, `RefactorBuildingArgs`
      and `refactorBuildingPromptOf` collapse into one arrow with an inline arg
      type
- [ ] ./src/workflows/shared/text.test.ts#1064-1064 — test calls move to the
      object form
- [ ] ./src/workflows/shared/text.test.ts#1074-1075 — `feedback: true` replaces
      the positional `undefined, true` tail

## Public surface and authoring docs

**`BuildTailOptions` is now exported from `@pmelab/gtd/workflows`**, so config
authors can type the options they pass. Docs show only the new form.

- [ ] ./src/workflows/index.ts#27-27 — adds `type BuildTailOptions` to the
      package export FYI: `src/workflows/feature/index.ts` still exports only
      `buildTail` and `ReviewOutcome`; harmless, since the package entry is the
      published one.
- [ ] ./skills/authoring/SKILL.md#59-59 — hotfix example uses
      `buildTail(start(), { fixFirst: true })`
- [ ] ./skills/authoring/SKILL.md#241-242 — the approve-plan example now passes
      a base and checks `.verdict === "signoff"`, fixing a snippet that compared
      the outcome object to a string The next line, `await reUnwind()`, still
      does not type-check: `reUnwind` requires the feedback outcome. This was
      already broken before this change. Keep the outcome and pass it:
      `const outcome = await buildTail(start()); if (outcome.verdict === "signoff") return; await reUnwind(outcome)`.
- [ ] ./tests/integration/support/steps/review-severity.steps.ts#30-35 — the
      shared severity config moves to the options form
