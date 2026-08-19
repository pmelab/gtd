@live
Feature: the voice survives the parsers it shares a prompt with (package 03, task 3)

  Package 03 injects gtd's own terse "voice" (`vars.styleBlock`) alongside a
  structural-override variable (`vars.styleFormatContract`) into every
  machine-parsed prompt state, so an agent styling its prose can't also style
  away the `##`/`### ` headings, `- [ ]` checkbox rows, or marker lines the
  parser requires. This feature is the end-to-end proof: a HUMAN, standing in
  for the agent, writes a styled `.gtd/REQUIREMENTS.md`/`.gtd/REVIEW.md` at
  one of those resting states — voice in the prose, grammar intact — and
  `gtd land` must actually accept it through the real validator and advance,
  not just look plausible.

  Both scenarios are `@live`, not `@inmem`: the seeded `qa`/`review` validator
  renders as a literal `gtd check <mode> '<file>'` COMMAND inside the step
  script `gtd land` runs ahead of its commit (see src/SteeringFormats.ts's
  `seededValidateCommand` and src/StepGuards.ts's doc comment). Only the
  `@live` tier's PATH shim (world.ts's `pathShimDir`) makes that bare `gtd`
  resolve to THIS build under test — an `@inmem` twin would have no real
  subprocess to run it in and would have to stub the command with a scripted
  double, which proves nothing about `OpenQuestions.ts`/`ReviewDoc.ts` actually
  parsing styled prose. `steering-modes.feature` already covers the
  scripted-double shape for a custom mode; this file is only about gtd's own
  two built-in parsers surviving the voice.

  Scenario: a styled REQUIREMENTS.md passes gtd check qa and design.triage advances
    Given a test project
    And the workflow
    And a commit "gtd(check): start-gate.check → design.triage" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    # The styled file itself — bold claim up front, flat imperative sentences,
    # no padding — with the "## Open Questions" / "### <question>" / "- [ ]"
    # grammar `gtd check qa` requires still intact.
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      **Add a calculator module.** One export, `add`, no dependencies.

      Two numbers in, one number out. Keep the signature small.

      ## Open Questions

      ### Which numeric type backs the result?

      - [ ] Plain `number` — matches JS semantics, zero extra code
      - [ ] A `Decimal` wrapper — exact arithmetic, more code to carry
      - [ ] _your answer_
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.check"

  Scenario: a styled REVIEW.md passes gtd check review and build.review.reviewing advances
    Given a test project
    And the workflow
    And a commit "gtd(check): build.health.check → build.review.reviewing" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    # The styled file itself — bold claim, imperative, no padding — with the
    # "# Review: <hash>" header, the base marker, and "## <chunk>" / "- [ ]
    # ./path#line" rows `gtd check review` requires still intact.
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: a1b2c3d

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## Calculator: add()

      **New pure function, no side effects.** Confirm the signature and the
      one test that pins it.

      - [ ] ./src/calc.ts#1
        Exported `add`, two `number` params.
      - [ ] ./src/calc.test.ts#1
        Happy-path coverage only.
      """
    When I run gtd land
    Then it succeeds
    # build.review.await-review declares reviewWindow: true, so landing INTO
    # it opens the review checkout window: HEAD rewinds to the review base in
    # the SAME land command's optional script (see review-window.feature), so
    # "the last commit subject" would name the base, not this transition.
    # Assert through `gtd status`, which resolves the true rest by reading
    # THROUGH the open window, the same way review-window.feature's own
    # "The machine never sees the window" scenario does.
    And the git ref "refs/worktree/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: build.review.await-review"
