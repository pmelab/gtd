Feature: Risk-fix pass — the reviewer's marked risks are fixed before the human gate

  A pointer note opening with `Risk:` in the reviewer's `.gtd/REVIEW.md` goes to
  `build.review.fix.risks.fixing`, then `build.health.check`, then the reviewer
  writes the review again over the whole change. The pass runs once per review
  round: a risk the re-review still marks reaches the human unfixed.

  @inmem
  Scenario: a marked risk is fixed, kept green and re-reviewed before the gate
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1 — Risk: add overflows silently
      - [ ] ./src/calc.ts#2-2 — sub
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.reviewing → build.review.fix.risks.fixing"
    Given "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => Number.isSafeInteger(a + b) ? a + b : NaN
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.fix.risks.fixing → build.health.check"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1 — fixed: add now returns NaN past the safe range
      - [ ] ./src/calc.ts#2-2 — sub
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.reviewing → build.review.await-review"

  @inmem
  Scenario: a risk the re-review still marks rests at the gate with no second fix
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1 — Risk: add overflows silently
      - [ ] ./src/calc.ts#2-2 — sub
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.reviewing → build.review.fix.risks.fixing"
    Given "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b // checked
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.fix.risks.fixing → build.health.check"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1 — Risk: add still overflows silently
      - [ ] ./src/calc.ts#2-2 — sub
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.reviewing → build.review.await-review"
